import { CallsResource } from "./resources/calls.ts";
import { MediaResource } from "./resources/media.ts";
import {
  createGrpcClients,
  type KeepaliveOptions,
} from "./transport/grpc-client.ts";
import type { RetryOptions } from "./types/common.ts";

/** Default production gRPC endpoint for Photon Spectrum Voice. */
export const DEFAULT_ADDRESS = "spectrum-voice-grpc.photon.codes:443";

/** Options for configuring the Voice client. */
export interface ClientOptions {
  /**
   * Server address to connect to.
   * Default `"spectrum-voice-grpc.photon.codes:443"`.
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
  /** When `true`, uses a TLS-encrypted connection to the server. Default `true`. */
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
    address: options.address ?? DEFAULT_ADDRESS,
    tls: options.tls ?? true,
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
