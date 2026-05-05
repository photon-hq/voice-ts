import { CallsResource } from "./resources/calls.ts";
import { MediaResource } from "./resources/media.ts";
import {
  createGrpcClients,
  type KeepaliveOptions,
} from "./transport/grpc-client.ts";
import type { RetryOptions } from "./types/common.ts";

/** Default production gRPC endpoint for Photon Spectrum Voice. */
export const DEFAULT_ADDRESS = "spectrum-voice-grpc.photon.codes:443";

/**
 * Env var that overrides the gRPC address. Honored only when
 * `NODE_ENV !== "production"` to keep production deployments locked to their
 * configured endpoint. See {@link createClient} for full semantics.
 */
export const VOICE_GRPC_ADDRESS_ENV = "VOICE_GRPC_ADDRESS";

/**
 * Env var that overrides the TLS setting. Set to `"false"` or `"0"` to
 * disable TLS. Honored only when `NODE_ENV !== "production"`.
 */
export const VOICE_GRPC_TLS_ENV = "VOICE_GRPC_TLS";

function isProduction(): boolean {
  // Read from globalThis to avoid a hard dependency on `process` (so the
  // SDK still imports cleanly in non-Node runtimes).
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return env?.NODE_ENV === "production";
}

function readEnv(name: string): string | undefined {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return env?.[name];
}

/**
 * Resolve the effective gRPC address.
 *
 * In non-production: `VOICE_GRPC_ADDRESS`, if set, wins over the explicit
 * option. In production the env var is ignored entirely. Falls back to
 * {@link DEFAULT_ADDRESS} when neither is supplied.
 *
 * Exported for tests; not part of the documented public API.
 */
export function resolveAddress(explicit: string | undefined): string {
  if (!isProduction()) {
    const fromEnv = readEnv(VOICE_GRPC_ADDRESS_ENV);
    if (fromEnv) {
      return fromEnv;
    }
  }
  return explicit ?? DEFAULT_ADDRESS;
}

/**
 * Resolve the effective TLS setting.
 *
 * In non-production: `VOICE_GRPC_TLS=false|0` disables TLS, `true|1` enables
 * it. In production the env var is ignored. Falls back to the explicit
 * option, then to `true`.
 *
 * Exported for tests; not part of the documented public API.
 */
export function resolveTls(explicit: boolean | undefined): boolean {
  if (!isProduction()) {
    const fromEnv = readEnv(VOICE_GRPC_TLS_ENV);
    if (fromEnv !== undefined) {
      const lowered = fromEnv.toLowerCase();
      if (lowered === "false" || lowered === "0") {
        return false;
      }
      if (lowered === "true" || lowered === "1") {
        return true;
      }
    }
  }
  return explicit ?? true;
}

/** Options for configuring the Voice client. */
export interface ClientOptions {
  /**
   * Server address to connect to.
   * Default `"spectrum-voice-grpc.photon.codes:443"`.
   *
   * In non-production environments (`NODE_ENV !== "production"`), the
   * `VOICE_GRPC_ADDRESS` env var, if set, overrides this option. In
   * production the env var is ignored to prevent accidental misconfig.
   */
  readonly address?: string;
  /**
   * gRPC HTTP/2 keepalive. Useful for long-lived `subscribe()` and
   * `media.openStream()` RPCs through NATs / L4 load balancers. Maps to
   * grpc-js channel options. Defaults to grpc-js defaults when unset.
   */
  readonly keepalive?: KeepaliveOptions;
  /**
   * When `true`, enables automatic retries on `x-retryable` errors.
   * Accepts a {@link RetryOptions} object for fine-grained control.
   * Default `false`.
   *
   * NOTE: `calls.dial` is not idempotent on the server. Enabling retry can
   * result in duplicate calls if a transient `UNAVAILABLE` slips through.
   */
  readonly retry?: boolean | RetryOptions;
  /** Request timeout in milliseconds for unary calls. Default `30000`. */
  readonly timeout?: number;
  /**
   * When `true`, uses a TLS-encrypted connection to the server. Default `true`.
   *
   * In non-production environments (`NODE_ENV !== "production"`), the
   * `VOICE_GRPC_TLS` env var, if set to `"false"` or `"0"`, disables TLS.
   * In production the env var is ignored.
   */
  readonly tls?: boolean;
  /**
   * Authentication token. Pass a function that returns `Promise<string>` to
   * resolve a fresh token on each call (useful for rotating credentials).
   *
   * The token is sent on every call as the `access_token` metadata key
   * (LightAuth-issued JWT). No `Bearer` prefix.
   */
  readonly token: string | (() => Promise<string>);
}

/** Voice client surface. Use {@link createClient} to build one. */
export interface VoiceClient extends AsyncDisposable {
  readonly calls: CallsResource;
  /** Close the underlying gRPC channel. Idempotent. */
  close(): Promise<void>;
  readonly media: MediaResource;
}

/**
 * Create a Voice client with access to call control and media-plane resources.
 *
 * @example
 * ```ts
 * const voice = createClient({ token: process.env.VOICE_TOKEN! });
 * const call = await voice.calls.dial("+14155551234", { from: "+14155550100" });
 * for await (const event of voice.calls.subscribe()) {
 *   if (event.type === "call.hangup") break;
 * }
 * await voice.close();
 * ```
 */
export function createClient(options: ClientOptions): VoiceClient {
  const clients = createGrpcClients({
    address: resolveAddress(options.address),
    tls: resolveTls(options.tls),
    token: options.token,
    timeout: options.timeout,
    retry: options.retry,
    keepalive: options.keepalive,
  });

  const calls = new CallsResource(clients.calls);
  const media = new MediaResource(clients.media);

  function close(): Promise<void> {
    clients.channel.close();
    return Promise.resolve();
  }

  return {
    calls,
    media,
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}
