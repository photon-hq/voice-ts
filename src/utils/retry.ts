/**
 * Retry utility for transient gRPC errors.
 *
 * Uses exponential backoff with jitter, only retrying when the caught error
 * is a {@link VoiceError} with `retryable: true`.
 */

import { VoiceError } from "../errors/voice-error.ts";
import type { RetryOptions } from "../types/common.ts";
import { sleep } from "./sleep.ts";

export type { RetryOptions } from "../types/common.ts";

/** Sensible defaults for retry options. */
export const DEFAULT_RETRY_OPTIONS: Required<
  Pick<RetryOptions, "initialDelay" | "maxAttempts" | "maxDelay">
> = {
  maxAttempts: 4,
  initialDelay: 200,
  maxDelay: 5000,
};

/**
 * Execute `fn` with automatic retry on retryable errors.
 *
 * The function is invoked immediately. If it throws a {@link VoiceError}
 * whose `retryable` flag is `true`, the call is retried up to
 * `maxAttempts - 1` times with exponential backoff and full jitter.
 *
 * Non-retryable errors are re-thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions & { readonly signal?: AbortSignal } = {}
): Promise<T> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts
  );
  const initialDelay =
    options.initialDelay ?? DEFAULT_RETRY_OPTIONS.initialDelay;
  const maxDelay = options.maxDelay ?? DEFAULT_RETRY_OPTIONS.maxDelay;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      const isRetryable = error instanceof VoiceError && error.retryable;

      if (!isRetryable || attempt >= maxAttempts - 1) {
        throw error;
      }

      if (options.signal?.aborted) {
        throw error;
      }

      const exponentialDelay = initialDelay * 2 ** attempt;
      const cappedDelay = Math.min(exponentialDelay, maxDelay);
      const jitteredDelay = Math.random() * cappedDelay;

      await sleep(jitteredDelay, options.signal);
    }
  }

  throw lastError;
}
