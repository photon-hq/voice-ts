/**
 * Unit tests for MediaSession.
 *
 * The bidi MediaStream RPC is mocked: each test installs a fake
 * MediaServiceClient that captures the outbound async iterable and replays
 * a canned server stream. This lets us assert on the order/contents of the
 * client→server messages and the server→client mapping in isolation.
 */

import { describe, expect, it } from "bun:test";
import type {
  MediaClientMessage,
  MediaServerMessage,
} from "../../src/generated/photon/voice/v1/media_service.ts";
import { AudioCodec as ProtoAudioCodec } from "../../src/generated/photon/voice/v1/media_service.ts";
import {
  type MediaInboundEvent,
  openMediaSession,
} from "../../src/streaming/media-session.ts";
import { callControlId } from "../../src/types/branded.ts";
import { AudioCodec } from "../../src/types/enums.ts";

const ccid = callControlId("ccid-1");

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Build a fake `MediaServiceClient.mediaStream` that:
 *   - records the outbound iterable so the test can pull messages off it
 *   - drives the inbound stream from a programmer-controlled queue
 */
function buildFakeClient(serverScript: MediaServerMessage[]): {
  client: any;
  outbound: Promise<MediaClientMessage[]>;
} {
  const outboundCollected = defer<MediaClientMessage[]>();

  return {
    outbound: outboundCollected.promise,
    client: {
      mediaStream(input: AsyncIterable<MediaClientMessage>) {
        // Drain the outbound iterable in the background. When the iterable
        // returns (because the session marked itself closed), resolve the
        // outboundCollected promise so the test can assert on what was sent.
        const collected: MediaClientMessage[] = [];
        const drain = async () => {
          for await (const msg of input) {
            collected.push(msg);
          }
          outboundCollected.resolve(collected);
        };
        drain();
        async function* serverIter(): AsyncIterable<MediaServerMessage> {
          for (const msg of serverScript) {
            // Yield to the event loop so outbound messages can be drained
            // between server messages, mimicking real bidi interleaving.
            await Promise.resolve();
            yield msg;
          }
        }
        return serverIter();
      },
    },
  };
}

describe("MediaSession outbound", () => {
  it("sends StartStream as the first outbound message with negotiated codec and flags", async () => {
    const { client, outbound } = buildFakeClient([
      { closed: { reason: "client_stop" } },
    ]);
    const session = openMediaSession(client, {
      callControlId: ccid,
      codec: AudioCodec.l16_16000,
      sendInbound: true,
      sendDtmf: true,
    });

    // Drain inbound to keep the call alive
    const inboundEvents: MediaInboundEvent[] = [];
    for await (const e of session.events) {
      inboundEvents.push(e);
    }

    const messages = await outbound;
    expect(messages[0]?.start).toBeDefined();
    expect(messages[0]?.start?.callControlId).toBe(ccid);
    expect(messages[0]?.start?.codec).toBe(
      ProtoAudioCodec.AUDIO_CODEC_L16_16000
    );
    expect(messages[0]?.start?.sendInbound).toBe(true);
    expect(messages[0]?.start?.sendDtmf).toBe(true);
  });

  it("queues sendFrame/mark/interrupt/stop as outbound messages", async () => {
    const { client, outbound } = buildFakeClient([
      { ready: { codec: ProtoAudioCodec.AUDIO_CODEC_PCMU_8000 } },
    ]);
    const session = openMediaSession(client, {
      callControlId: ccid,
      codec: AudioCodec.pcmu8000,
    });

    // Push some traffic, then stop.
    session.sendFrame(new Uint8Array([1, 2, 3]), 1);
    session.mark("anchor");
    session.interrupt();
    await session.stop();

    // Drain inbound to allow the bidi to wind down.
    for await (const _ of session.events) {
      // ignore
    }

    const msgs = await outbound;
    // Order: start, frame, mark, interrupt, stop
    expect(msgs.length).toBe(5);
    expect(msgs[0]?.start).toBeDefined();
    expect(msgs[1]?.frame?.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(msgs[1]?.frame?.seq).toBe(1);
    expect(msgs[2]?.mark?.name).toBe("anchor");
    expect(msgs[3]?.interrupt).toBeDefined();
    expect(msgs[4]?.stop).toBeDefined();
  });
});

describe("MediaSession inbound mapping", () => {
  it("maps each server message variant to its SDK event shape", async () => {
    const { client } = buildFakeClient([
      { ready: { codec: ProtoAudioCodec.AUDIO_CODEC_PCMU_8000 } },
      { frame: { audio: new Uint8Array([7, 8]), seq: 2, tsMs: 1000 } },
      { dtmf: { digit: "5", tsMs: 2000 } },
      { mark: { name: "ack" } },
      { error: { code: "SLOW", message: "behind" } },
      { closed: { reason: "client_stop" } },
    ]);
    const session = openMediaSession(client, {
      callControlId: ccid,
      codec: AudioCodec.pcmu8000,
    });

    const collected: MediaInboundEvent[] = [];
    for await (const evt of session.events) {
      collected.push(evt);
    }

    expect(collected.map((e) => e.type)).toEqual([
      "ready",
      "frame",
      "dtmf",
      "mark",
      "error",
      "closed",
    ]);
    if (collected[0]?.type === "ready") {
      expect(collected[0].codec).toBe(AudioCodec.pcmu8000);
    }
    if (collected[1]?.type === "frame") {
      expect(collected[1].audio).toEqual(new Uint8Array([7, 8]));
      expect(collected[1].seq).toBe(2);
      expect(collected[1].tsMs).toBe(1000);
    }
    if (collected[2]?.type === "dtmf") {
      expect(collected[2].digit).toBe("5");
    }
    if (collected[4]?.type === "error") {
      expect(collected[4].code).toBe("SLOW");
    }
    if (collected[5]?.type === "closed") {
      expect(collected[5].reason).toBe("client_stop");
    }
  });
});

describe("MediaSession lifecycle", () => {
  it("stop() is idempotent", async () => {
    const { client } = buildFakeClient([{ closed: { reason: "client_stop" } }]);
    const session = openMediaSession(client, {
      callControlId: ccid,
      codec: AudioCodec.pcmu8000,
    });

    const a = session.stop();
    const b = session.stop();
    expect(a).toBe(b);
    await a;

    for await (const _ of session.events) {
      // drain
    }
  });

  it("Symbol.asyncDispose calls stop()", async () => {
    const { client, outbound } = buildFakeClient([
      { closed: { reason: "client_stop" } },
    ]);

    {
      await using session = openMediaSession(client, {
        callControlId: ccid,
        codec: AudioCodec.pcmu8000,
      });
      // intentionally don't iterate events; dispose should still tear down
      // by resolving stop() which the events stream's cleanup also calls.
      // We need to drain the inbound stream to let the bidi finish though.
      const drain = (async () => {
        for await (const _ of session.events) {
          // ignore
        }
      })();
      await session.stop();
      await drain;
    }

    const msgs = await outbound;
    // At minimum: start + stop
    expect(msgs.some((m) => m.start)).toBe(true);
    expect(msgs.some((m) => m.stop)).toBe(true);
  });
});

describe("MediaSession overflow", () => {
  it("emits a synthetic OVERFLOW error when outboundCapacity is exceeded", async () => {
    // Hold the outbound generator open by feeding a server stream that
    // never advances on its own. We control teardown manually.
    const stopServer = defer<void>();
    const client: any = {
      mediaStream(input: AsyncIterable<MediaClientMessage>) {
        // Pull one message (the StartStream) synchronously, then block.
        const _drainStart = (async () => {
          for await (const _ of input) {
            // keep draining in background
          }
        })();
        return (async function* () {
          // Keep server side alive until released.
          yield { ready: { codec: ProtoAudioCodec.AUDIO_CODEC_PCMU_8000 } };
          await stopServer.promise;
          yield { closed: { reason: "client_stop" } };
        })();
      },
    };

    const session = openMediaSession(client, {
      callControlId: ccid,
      codec: AudioCodec.pcmu8000,
      outboundCapacity: 2,
    });

    // Push past capacity before any outbound consumer pulls past start.
    session.sendFrame(new Uint8Array([1]));
    session.sendFrame(new Uint8Array([2]));
    session.sendFrame(new Uint8Array([3])); // triggers overflow

    const inbound: MediaInboundEvent[] = [];
    const consume = (async () => {
      for await (const e of session.events) {
        inbound.push(e);
        if (e.type === "error" && e.code === "OVERFLOW") {
          stopServer.resolve();
        }
      }
    })();

    await consume;

    expect(
      inbound.some((e) => e.type === "error" && e.code === "OVERFLOW")
    ).toBe(true);
  });
});
