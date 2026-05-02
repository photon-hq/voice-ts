/**
 * Unit tests for CallsResource.
 *
 * The gRPC client is fully mocked: tests assert that the resource builds the
 * correct proto request, threads enums through the SDK -> proto mappers, and
 * that subscribe() filters heartbeats while exposing real events.
 */

import { describe, expect, it } from "bun:test";
import {
  RejectCause as ProtoRejectCause,
  type SubscribeEventsResponse,
} from "../../src/generated/photon/voice/v1/call_service.ts";
import { CallDirection as ProtoCallDirection } from "../../src/generated/photon/voice/v1/common.ts";
import { CallsResource } from "../../src/resources/calls.ts";
import { callControlId, streamCursor } from "../../src/types/branded.ts";
import { RejectCause } from "../../src/types/enums.ts";
import type { CallEvent } from "../../src/types/events.ts";

const ccid = callControlId("ccid-1");

describe("CallsResource.dial", () => {
  it("forwards options and brands the response IDs", async () => {
    let captured: any;
    const client: any = {
      async dial(req: any) {
        captured = req;
        return {
          callControlId: "new-ccid",
          callLegId: "new-leg",
          callSessionId: "new-sess",
        };
      },
    };
    const resource = new CallsResource(client);

    const call = await resource.dial("+14155551234", {
      from: "+14155550100",
      clientState: "ctx",
      timeoutSecs: 30,
      answeringMachineDetection: true,
    });

    expect(captured).toEqual({
      to: "+14155551234",
      clientState: "ctx",
      timeoutSecs: 30,
      answeringMachineDetection: true,
      from: "+14155550100",
    });
    expect(call.callControlId).toBe("new-ccid" as any);
    expect(call.callLegId).toBe("new-leg" as any);
    expect(call.callSessionId).toBe("new-sess" as any);
  });

  it("omits optional fields when not supplied", async () => {
    let captured: any;
    const client: any = {
      async dial(req: any) {
        captured = req;
        return { callControlId: "x", callLegId: "y", callSessionId: "z" };
      },
    };
    const resource = new CallsResource(client);
    await resource.dial("+14155551234");

    expect(captured.to).toBe("+14155551234");
    expect(captured.from).toBeUndefined();
    expect(captured.clientState).toBeUndefined();
    expect(captured.timeoutSecs).toBeUndefined();
    expect(captured.answeringMachineDetection).toBeUndefined();
  });
});

describe("CallsResource.reject", () => {
  it("maps RejectCause SDK -> proto enum", async () => {
    let captured: any;
    const client: any = {
      async reject(req: any) {
        captured = req;
        return {};
      },
    };
    const resource = new CallsResource(client);
    await resource.reject(ccid, RejectCause.userBusy);

    expect(captured.callControlId).toBe(ccid);
    expect(captured.cause).toBe(ProtoRejectCause.REJECT_CAUSE_USER_BUSY);
  });
});

describe("CallsResource.sendDtmf", () => {
  it("calls the underlying sendDTMF RPC", async () => {
    let captured: any;
    const client: any = {
      async sendDTMF(req: any) {
        captured = req;
        return {};
      },
    };
    const resource = new CallsResource(client);
    await resource.sendDtmf(ccid, "1234", { durationMillis: 100 });

    expect(captured.callControlId).toBe(ccid);
    expect(captured.digits).toBe("1234");
    expect(captured.durationMillis).toBe(100);
  });
});

describe("CallsResource.subscribe", () => {
  function mockServerStream(
    events: SubscribeEventsResponse[]
  ): AsyncIterable<SubscribeEventsResponse> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) {
          yield e;
        }
      },
    };
  }

  it("filters heartbeats and yields mapped events", async () => {
    const start = new Date();
    const protos: SubscribeEventsResponse[] = [
      { cursor: { value: "c1" }, heartbeat: {} },
      {
        cursor: { value: "c2" },
        callInitiated: {
          callControlId: "ccid-1",
          callLegId: "leg-1",
          callSessionId: "sess-1",
          direction: ProtoCallDirection.CALL_DIRECTION_INCOMING,
          from: "+15550200",
          to: "+15550100",
          projectDid: "+15550100",
          endUserNumber: "+15550200",
          startTime: start,
        },
      },
      { cursor: { value: "c3" }, heartbeat: {} },
      {
        cursor: { value: "c4" },
        callHangup: {
          callControlId: "ccid-1",
          occurredAt: new Date(),
          hangupCause: "normal",
        },
      },
    ];

    const client: any = {
      subscribeEvents: () => mockServerStream(protos),
    };
    const resource = new CallsResource(client);

    const collected: CallEvent[] = [];
    for await (const e of resource.subscribe()) {
      collected.push(e);
    }

    expect(collected.length).toBe(2);
    expect(collected[0]?.type).toBe("call.initiated");
    expect(collected[1]?.type).toBe("call.hangup");
  });

  it("narrows the stream when a type is supplied", async () => {
    const protos: SubscribeEventsResponse[] = [
      {
        cursor: { value: "c1" },
        callInitiated: {
          callControlId: "ccid-1",
          callLegId: "leg-1",
          callSessionId: "sess-1",
          direction: ProtoCallDirection.CALL_DIRECTION_INCOMING,
          from: "+15550200",
          to: "+15550100",
          projectDid: "+15550100",
          endUserNumber: "+15550200",
          startTime: new Date(),
        },
      },
      {
        cursor: { value: "c2" },
        callHangup: {
          callControlId: "ccid-1",
          occurredAt: new Date(),
        },
      },
    ];
    const client: any = {
      subscribeEvents: () => mockServerStream(protos),
    };
    const resource = new CallsResource(client);

    const collected: { type: string }[] = [];
    for await (const e of resource.subscribe("call.hangup")) {
      collected.push(e);
    }
    expect(collected.length).toBe(1);
    expect(collected[0]?.type).toBe("call.hangup");
  });
});

describe("CallsResource.fetchMissed", () => {
  it("returns mapped events", async () => {
    let captured: any;
    const client: any = {
      async fetchMissedEvents(req: any) {
        captured = req;
        return {
          events: [
            {
              cursor: { value: "c1" },
              callAnswered: {
                callControlId: "ccid-1",
                occurredAt: new Date(),
              },
            },
          ],
        };
      },
    };
    const resource = new CallsResource(client);
    const events = await resource.fetchMissed(streamCursor("cursor-x"), {
      limit: 50,
    });

    expect(captured.cursor.value).toBe("cursor-x");
    expect(captured.limit).toBe(50);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("call.answered");
  });
});
