/**
 * MediaSession -- imperative handle around the bidi `MediaService.MediaStream`
 * RPC.
 *
 * The raw gRPC surface for bidi streaming is `(AsyncIterable<ClientMsg>) ->
 * AsyncIterable<ServerMsg>`, which forces users to write async generators by
 * hand and interleave outbound pushes with inbound consumption. MediaSession
 * hides that with imperative methods (`sendFrame`, `mark`, `interrupt`, `stop`)
 * and an `events` stream for inbound. The `StartStream` opener is sent
 * automatically as the first outbound message.
 *
 * Internally the outbound side is a deferred-resolve push channel: a FIFO
 * queue plus a single replaceable promise that user-facing methods resolve
 * to wake the outbound generator.
 */

import { fromGrpcError } from "../errors/error-handler.ts";
import type {
  MediaClientMessage,
  MediaServerMessage,
  MediaServiceClient,
} from "../generated/photon/voice/v1/media_service.ts";
import { mapAudioCodec, toProtoAudioCodec } from "../transport/mapper.ts";
import type { CallControlId } from "../types/branded.ts";
import type { AudioCodec } from "../types/enums.ts";
import { TypedEventStream } from "./event-stream.ts";

/** A single inbound message from the media stream, in SDK form. */
export type MediaInboundEvent =
  | { readonly type: "ready"; readonly codec: AudioCodec }
  | {
      readonly type: "frame";
      readonly audio: Uint8Array;
      readonly seq: number;
      readonly tsMs: number;
    }
  | { readonly type: "dtmf"; readonly digit: string; readonly tsMs: number }
  | { readonly type: "mark"; readonly name: string }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
    }
  | { readonly type: "closed"; readonly reason: string };

/** Options for opening a media session via `media.openStream`. */
export interface MediaSessionOptions {
  readonly callControlId: CallControlId;
  /** Codec to negotiate. Outbound frames must match this codec. */
  readonly codec: AudioCodec;
  /**
   * Maximum number of outbound frames buffered before the oldest is
   * dropped (and an `OVERFLOW` error event is emitted). Default unbounded.
   */
  readonly outboundCapacity?: number;
  /**
   * Surface DTMF digits on `events`. Default `false` (DTMF events are also
   * available on `calls.subscribe()`).
   */
  readonly sendDtmf?: boolean;
  /** Surface inbound caller audio frames on `events`. Default `true`. */
  readonly sendInbound?: boolean;
  /** Optional abort signal to cancel the session externally. */
  readonly signal?: AbortSignal;
}

/** Live media session handle. */
export interface MediaSession extends AsyncDisposable {
  /** Inbound events from the server. Has a single consumer per session. */
  readonly events: TypedEventStream<MediaInboundEvent>;
  /** Flush any queued outbound audio (barge-in). */
  interrupt(): void;
  /**
   * Send a `Mark`. The server echoes a `{type:"mark"}` event back when the
   * corresponding outbound audio actually plays out to the caller.
   */
  mark(name: string): void;
  /**
   * Push an outbound audio frame. `audio` must match the negotiated codec
   * (one or more 20 ms frames).
   */
  sendFrame(audio: Uint8Array, seq?: number): void;
  /**
   * Send `StopStream` and close gracefully. Idempotent — subsequent calls
   * return the same resolved promise.
   */
  stop(): Promise<void>;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function makeDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mapServerMessage(msg: MediaServerMessage): MediaInboundEvent | null {
  if (msg.ready) {
    return { type: "ready", codec: mapAudioCodec(msg.ready.codec) };
  }
  if (msg.frame) {
    return {
      type: "frame",
      audio: msg.frame.audio,
      seq: msg.frame.seq,
      tsMs: msg.frame.tsMs,
    };
  }
  if (msg.dtmf) {
    return { type: "dtmf", digit: msg.dtmf.digit, tsMs: msg.dtmf.tsMs };
  }
  if (msg.mark) {
    return { type: "mark", name: msg.mark.name };
  }
  if (msg.error) {
    return { type: "error", code: msg.error.code, message: msg.error.message };
  }
  if (msg.closed) {
    return { type: "closed", reason: msg.closed.reason };
  }
  return null;
}

/**
 * Open a {@link MediaSession} against the bidi `MediaStream` RPC.
 *
 * Sends a `StartStream` message automatically as the first outbound message.
 * Subsequent outbound traffic is driven by `sendFrame`/`mark`/`interrupt`/
 * `stop` on the returned session.
 *
 * Server-side, only one MediaStream is allowed per `callControlId`. A second
 * concurrent open returns `FAILED_PRECONDITION`, which surfaces as a
 * `ValidationError` on the first read of `events`.
 */
export function openMediaSession(
  client: MediaServiceClient,
  options: MediaSessionOptions
): MediaSession {
  const queue: MediaClientMessage[] = [];
  let signal = makeDeferred();
  let closed = false;
  let stopPromise: Promise<void> | null = null;

  // Synthetic events injected when the outbound queue overflows. Surfaced on
  // the inbound stream so users observe backpressure in one place.
  const syntheticInbound: MediaInboundEvent[] = [];

  function pushOutbound(msg: MediaClientMessage): void {
    if (closed) {
      return;
    }
    if (
      typeof options.outboundCapacity === "number" &&
      queue.length >= options.outboundCapacity
    ) {
      queue.shift();
      syntheticInbound.push({
        type: "error",
        code: "OVERFLOW",
        message: `outbound queue exceeded capacity ${options.outboundCapacity}; dropping oldest frame`,
      });
    }
    queue.push(msg);
    signal.resolve();
  }

  async function* outbound(): AsyncIterable<MediaClientMessage> {
    yield {
      start: {
        callControlId: options.callControlId,
        codec: toProtoAudioCodec(options.codec),
        sendInbound: options.sendInbound ?? true,
        sendDtmf: options.sendDtmf ?? false,
      },
    };

    while (true) {
      while (queue.length > 0) {
        const msg = queue.shift();
        if (msg !== undefined) {
          yield msg;
        }
      }
      if (closed) {
        return;
      }
      await signal.promise;
      signal = makeDeferred();
    }
  }

  if (options.signal) {
    if (options.signal.aborted) {
      closed = true;
      signal.resolve();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          signal.resolve();
        },
        { once: true }
      );
    }
  }

  const serverIterable = client.mediaStream(outbound(), {
    signal: options.signal,
  });

  async function* inbound(): AsyncGenerator<MediaInboundEvent> {
    const iter = serverIterable[Symbol.asyncIterator]();
    try {
      for (;;) {
        while (syntheticInbound.length > 0) {
          const evt = syntheticInbound.shift();
          if (evt !== undefined) {
            yield evt;
          }
        }

        const next = await iter.next();
        if (next.done) {
          break;
        }
        const evt = mapServerMessage(next.value);
        if (evt !== null) {
          yield evt;
        }
      }
    } catch (err) {
      throw fromGrpcError(err);
    } finally {
      // Server iterable ended (gracefully or via error) -- release the
      // outbound generator so the bidi call cleans up.
      closed = true;
      signal.resolve();
      await iter.return?.(undefined);
    }
  }

  function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = (async () => {
      pushOutbound({ stop: {} });
      // Allow the outbound generator one tick to drain the queued StopStream
      // before we mark the channel closed (otherwise the generator may exit
      // before yielding it).
      await Promise.resolve();
      closed = true;
      signal.resolve();
    })();
    return stopPromise;
  }

  const events = new TypedEventStream<MediaInboundEvent>(inbound(), () =>
    stop()
  );

  return {
    events,
    sendFrame(audio, seq) {
      pushOutbound({ frame: { audio, seq: seq ?? 0 } });
    },
    mark(name) {
      pushOutbound({ mark: { name } });
    },
    interrupt() {
      pushOutbound({ interrupt: {} });
    },
    stop,
    async [Symbol.asyncDispose]() {
      await stop();
    },
  };
}
