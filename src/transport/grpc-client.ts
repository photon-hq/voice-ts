/**
 * Creates and configures the nice-grpc channel and the two service clients.
 *
 * This module is the single entry point for establishing a gRPC connection.
 * It wires up channel creation, optional keepalive, auth/retry/timeout
 * middleware, and returns typed clients for both services in the proto
 * contract.
 */

import {
  type Channel,
  ChannelCredentials,
  createChannel,
  createClientFactory,
} from "nice-grpc";
import {
  type CallServiceClient,
  CallServiceDefinition,
} from "../generated/photon/voice/v1/call_service.ts";
import {
  type MediaServiceClient,
  MediaServiceDefinition,
} from "../generated/photon/voice/v1/media_service.ts";
import type { RetryOptions } from "../types/common.ts";
import {
  authMiddleware,
  retryMiddleware,
  timeoutMiddleware,
  trailingMetadataCaptureMiddleware,
} from "./metadata.ts";

export type { CallServiceClient } from "../generated/photon/voice/v1/call_service.ts";
export type { MediaServiceClient } from "../generated/photon/voice/v1/media_service.ts";

/**
 * gRPC HTTP/2 keepalive settings. Useful for long-lived `subscribe()` and
 * `media.openStream()` RPCs that pass through NATs / L4 load balancers.
 *
 * Maps to grpc-js channel options:
 *   - `timeMs`             → `grpc.keepalive_time_ms`
 *   - `timeoutMs`          → `grpc.keepalive_timeout_ms`
 *   - `permitWithoutCalls` → `grpc.keepalive_permit_without_calls`
 */
export interface KeepaliveOptions {
  readonly permitWithoutCalls?: boolean;
  readonly timeMs?: number;
  readonly timeoutMs?: number;
}

/**
 * Container for both gRPC service clients and the underlying channel.
 *
 * The `channel` is exposed so the caller can close it when done (or use
 * the client's `AsyncDisposable` implementation).
 */
export interface GrpcClients {
  readonly calls: CallServiceClient;
  readonly channel: Channel;
  readonly media: MediaServiceClient;
}

/** Options for creating the gRPC client bundle. */
export interface GrpcClientOptions {
  /** Server address, e.g. `"spectrum-voice-grpc.photon.codes:443"`. */
  address: string;
  /** gRPC HTTP/2 keepalive. See {@link KeepaliveOptions}. */
  keepalive?: KeepaliveOptions;
  /**
   * Enable automatic retry with exponential backoff for retryable errors.
   * Pass `true` for default settings, or a `RetryOptions` object to
   * customise the behaviour.
   */
  retry?: boolean | RetryOptions;
  /**
   * Default timeout in milliseconds for unary RPC calls.
   * Sets a deadline on each call unless one is already provided.
   */
  timeout?: number;
  /**
   * Whether to use TLS. If `true`, the channel uses SSL credentials.
   * If `false`, this forces `ChannelCredentials.createInsecure()`.
   */
  tls: boolean;
  /**
   * Auth token. Static string or async resolver (LightAuth-issued JWT).
   * Sent on every call as the `access_token` metadata key (no `Bearer`
   * prefix).
   */
  token: string | (() => Promise<string>);
}

function buildChannelOptions(
  keepalive: KeepaliveOptions | undefined
): Record<string, number | string> | undefined {
  if (!keepalive) {
    return;
  }
  const opts: Record<string, number | string> = {};
  if (typeof keepalive.timeMs === "number") {
    opts["grpc.keepalive_time_ms"] = keepalive.timeMs;
  }
  if (typeof keepalive.timeoutMs === "number") {
    opts["grpc.keepalive_timeout_ms"] = keepalive.timeoutMs;
  }
  if (typeof keepalive.permitWithoutCalls === "boolean") {
    opts["grpc.keepalive_permit_without_calls"] = keepalive.permitWithoutCalls
      ? 1
      : 0;
  }
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Create a gRPC channel and both service clients with the configured
 * middleware.
 */
export function createGrpcClients(options: GrpcClientOptions): GrpcClients {
  const credentials = options.tls
    ? ChannelCredentials.createSsl()
    : ChannelCredentials.createInsecure();

  const channelOptions = buildChannelOptions(options.keepalive);

  const channel = channelOptions
    ? createChannel(options.address, credentials, channelOptions)
    : createChannel(options.address, credentials);

  // Middleware is added outermost-first: the first .use() call runs first
  // in the call chain. Desired execution order:
  //   retry → timeout → auth → trailingMetadataCapture → RPC
  let factory = createClientFactory();

  if (options.retry) {
    const retryOpts = options.retry === true ? {} : options.retry;
    factory = factory.use(retryMiddleware(retryOpts));
  }

  if (options.timeout) {
    factory = factory.use(timeoutMiddleware(options.timeout));
  }

  factory = factory.use(authMiddleware(options.token));

  // Always capture trailing metadata — nice-grpc strips it from errors,
  // but our error handler and retry middleware depend on it.
  factory = factory.use(trailingMetadataCaptureMiddleware());

  return {
    calls: factory.create(CallServiceDefinition, channel),
    media: factory.create(MediaServiceDefinition, channel),
    channel,
  };
}
