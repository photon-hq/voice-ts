/**
 * nice-grpc client middleware for authentication, retry, timeout, and
 * trailing-metadata capture.
 *
 * Each middleware is an async generator that wraps the call chain, injecting
 * metadata headers before forwarding to the next handler.
 */

import {
  type CallOptions,
  type ClientMiddleware,
  Metadata,
} from "nice-grpc-common";
import type { RetryOptions } from "../types/common.ts";
import { readMetadataValue } from "../utils/grpc-metadata.ts";
import { DEFAULT_RETRY_OPTIONS } from "../utils/retry.ts";
import { sleep } from "../utils/sleep.ts";

/**
 * Creates a nice-grpc client middleware that injects an `access_token`
 * metadata header on every call.
 *
 * IMPORTANT: spectrum-voice authenticates on the `access_token` metadata key
 * (a LightAuth-issued JWT), NOT the standard `authorization: Bearer ...`
 * header. Do not add a `Bearer ` prefix here.
 *
 * The `token` parameter can be a static string or an async function that
 * resolves a fresh token on each call (useful for rotating credentials).
 */
export function authMiddleware(
  token: string | (() => Promise<string>)
): ClientMiddleware {
  return async function* authMw(call, options) {
    const resolvedToken = typeof token === "function" ? await token() : token;

    const metadata = Metadata(options.metadata);
    metadata.set("access_token", resolvedToken);

    const nextOptions: CallOptions = {
      ...options,
      metadata,
    };

    return yield* call.next(call.request, nextOptions);
  };
}

/**
 * Creates a nice-grpc client middleware that automatically retries failed
 * unary calls when the server indicates the error is retryable (via the
 * `x-retryable` trailing metadata header).
 *
 * Uses exponential backoff with full jitter. Streaming calls are passed
 * through without retry.
 *
 * Note: Dial is not idempotent on the server. Enabling retry can result in
 * placing the same call twice if a transient `UNAVAILABLE` slips in after the
 * server has already started dialing — see `calls.dial()` JSDoc.
 */
export function retryMiddleware(opts: RetryOptions = {}): ClientMiddleware {
  const maxAttempts = Math.max(
    1,
    opts.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts
  );
  const initialDelay = opts.initialDelay ?? DEFAULT_RETRY_OPTIONS.initialDelay;
  const maxDelay = opts.maxDelay ?? DEFAULT_RETRY_OPTIONS.maxDelay;

  return async function* retryMw(call, options) {
    if (call.method.responseStream || call.method.requestStream) {
      return yield* call.next(call.request, options);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return yield* call.next(call.request, options);
      } catch (error: unknown) {
        lastError = error;

        const retryable = readMetadataValue(error, "x-retryable") === "true";

        if (!retryable || attempt >= maxAttempts - 1) {
          throw error;
        }

        const exponentialDelay = initialDelay * 2 ** attempt;
        const cappedDelay = Math.min(exponentialDelay, maxDelay);
        await sleep(Math.random() * cappedDelay, options.signal);

        if (options.signal?.aborted) {
          throw error;
        }
      }
    }

    throw lastError;
  };
}

/**
 * nice-grpc wraps `@grpc/grpc-js` errors into `ClientError`, **dropping
 * trailing metadata** in the process.  This middleware intercepts the
 * `onTrailer` callback to capture trailing metadata and re-attaches it to
 * errors in a format compatible with `readMetadataValue`.
 *
 * It should always be the **innermost** middleware so that outer middleware
 * (retry, error handlers) can read server-sent headers like `error-code`
 * and `x-retryable`.
 */
export function trailingMetadataCaptureMiddleware(): ClientMiddleware {
  return async function* trailingMetadataCaptureMw(call, options) {
    let trailer: ReturnType<typeof Metadata> | undefined;

    try {
      return yield* call.next(call.request, {
        ...options,
        onTrailer(t) {
          trailer = t;
          options.onTrailer?.(t);
        },
      });
    } catch (error) {
      // Yield one microtask so that the onTrailer handler has a chance
      // to fire in case @grpc/grpc-js delivers it via nextTick.
      await Promise.resolve();

      if (trailer && error instanceof Error) {
        const captured = trailer;
        Object.defineProperty(error, "metadata", {
          value: {
            get(key: string): unknown[] {
              const val = captured.get(key);
              return val === undefined ? [] : [val];
            },
          },
          writable: true,
          configurable: true,
        });
      }
      throw error;
    }
  };
}

/**
 * Creates a nice-grpc client middleware that sets a default timeout on
 * unary calls via `AbortSignal.timeout()`. Streaming calls are passed
 * through without a timeout to avoid killing long-lived subscriptions.
 *
 * If the caller already supplied an `AbortSignal`, the timeout signal is
 * combined with it using `AbortSignal.any()` so that either can cancel.
 */
export function timeoutMiddleware(timeoutMs: number): ClientMiddleware {
  return async function* timeoutMw(call, options) {
    if (call.method.responseStream || call.method.requestStream) {
      return yield* call.next(call.request, options);
    }

    if (options.signal) {
      const combined = AbortSignal.any([
        options.signal,
        AbortSignal.timeout(timeoutMs),
      ]);
      return yield* call.next(call.request, {
        ...options,
        signal: combined,
      });
    }

    return yield* call.next(call.request, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  };
}
