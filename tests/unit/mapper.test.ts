/**
 * Unit tests for transport/mapper.ts.
 *
 * The mapper layer is the only place proto numeric enums and snake_case names
 * cross over into the SDK's string-literal types and branded IDs. These
 * tests pin the conversion contract so a regenerated proto can't silently
 * change wire-level behaviour.
 */

import { describe, expect, it } from "bun:test";
import {
  MachineDetectionResult as ProtoMachineDetectionResult,
  RejectCause as ProtoRejectCause,
  type SubscribeEventsResponse,
} from "../../src/generated/photon/voice/v1/call_service.ts";
import { CallDirection as ProtoCallDirection } from "../../src/generated/photon/voice/v1/common.ts";
import { AudioCodec as ProtoAudioCodec } from "../../src/generated/photon/voice/v1/media_service.ts";
import {
  mapAudioCodec,
  mapCallDirection,
  mapCallEvent,
  mapDialResponse,
  mapMachineDetectionResult,
  mapMissedEvent,
  mapRejectCause,
  toProtoAudioCodec,
  toProtoRejectCause,
} from "../../src/transport/mapper.ts";
import {
  AudioCodec,
  CallDirection,
  MachineDetectionResult,
  RejectCause,
} from "../../src/types/enums.ts";

describe("enum mappers (proto -> SDK)", () => {
  it("CallDirection", () => {
    expect(mapCallDirection(ProtoCallDirection.CALL_DIRECTION_INCOMING)).toBe(
      CallDirection.incoming
    );
    expect(mapCallDirection(ProtoCallDirection.CALL_DIRECTION_OUTGOING)).toBe(
      CallDirection.outgoing
    );
    // unspecified / unrecognized fall back to incoming
    expect(
      mapCallDirection(ProtoCallDirection.CALL_DIRECTION_UNSPECIFIED)
    ).toBe(CallDirection.incoming);
  });

  it("RejectCause", () => {
    expect(mapRejectCause(ProtoRejectCause.REJECT_CAUSE_REJECTED)).toBe(
      RejectCause.rejected
    );
    expect(mapRejectCause(ProtoRejectCause.REJECT_CAUSE_USER_BUSY)).toBe(
      RejectCause.userBusy
    );
    expect(mapRejectCause(ProtoRejectCause.REJECT_CAUSE_CALL_REJECTED)).toBe(
      RejectCause.callRejected
    );
  });

  it("MachineDetectionResult", () => {
    expect(
      mapMachineDetectionResult(
        ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_HUMAN
      )
    ).toBe(MachineDetectionResult.human);
    expect(
      mapMachineDetectionResult(
        ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_MACHINE
      )
    ).toBe(MachineDetectionResult.machine);
    expect(
      mapMachineDetectionResult(
        ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_SILENCE
      )
    ).toBe(MachineDetectionResult.silence);
  });

  it("AudioCodec", () => {
    expect(mapAudioCodec(ProtoAudioCodec.AUDIO_CODEC_PCMU_8000)).toBe(
      AudioCodec.pcmu8000
    );
    expect(mapAudioCodec(ProtoAudioCodec.AUDIO_CODEC_L16_8000)).toBe(
      AudioCodec.l16_8000
    );
    expect(mapAudioCodec(ProtoAudioCodec.AUDIO_CODEC_L16_16000)).toBe(
      AudioCodec.l16_16000
    );
  });
});

describe("enum mappers (SDK -> proto)", () => {
  it("RejectCause round-trip", () => {
    for (const cause of [
      RejectCause.rejected,
      RejectCause.userBusy,
      RejectCause.callRejected,
    ]) {
      expect(mapRejectCause(toProtoRejectCause(cause))).toBe(cause);
    }
  });

  it("AudioCodec round-trip", () => {
    for (const codec of [
      AudioCodec.pcmu8000,
      AudioCodec.l16_8000,
      AudioCodec.l16_16000,
    ]) {
      expect(mapAudioCodec(toProtoAudioCodec(codec))).toBe(codec);
    }
  });
});

describe("mapDialResponse", () => {
  it("brands all three identifiers", () => {
    const call = mapDialResponse({
      callControlId: "ccid-1",
      callLegId: "leg-1",
      callSessionId: "sess-1",
    });
    expect(call.callControlId).toBe("ccid-1" as any);
    expect(call.callLegId).toBe("leg-1" as any);
    expect(call.callSessionId).toBe("sess-1" as any);
    expect(call._raw).toEqual({
      callControlId: "ccid-1",
      callLegId: "leg-1",
      callSessionId: "sess-1",
    });
  });
});

describe("mapCallEvent", () => {
  it("returns null for heartbeats", () => {
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-1" },
      heartbeat: {},
    };
    expect(mapCallEvent(proto)).toBeNull();
  });

  it("returns null for unknown variants (none of the oneof fields set)", () => {
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-1" },
    };
    expect(mapCallEvent(proto)).toBeNull();
  });

  it("maps call.initiated", () => {
    const start = new Date("2026-04-30T10:00:00Z");
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-init" },
      callInitiated: {
        callControlId: "ccid-1",
        callLegId: "leg-1",
        callSessionId: "sess-1",
        direction: ProtoCallDirection.CALL_DIRECTION_OUTGOING,
        from: "+15550100",
        to: "+15550200",
        projectDid: "+15550100",
        endUserNumber: "+15550200",
        callerIdName: "Alice",
        startTime: start,
        clientState: "state-x",
        shakenStirAttestation: "A",
      },
    };
    const event = mapCallEvent(proto);
    expect(event?.type).toBe("call.initiated");
    if (event?.type !== "call.initiated") {
      return;
    }
    expect(event.callControlId).toBe("ccid-1" as any);
    expect(event.direction).toBe(CallDirection.outgoing);
    expect(event.from).toBe("+15550100");
    expect(event.startTime).toEqual(start);
    expect(event.clientState).toBe("state-x");
    expect(event.cursor).toBe("cur-init" as any);
  });

  it("maps call.dtmfReceived", () => {
    const at = new Date("2026-04-30T10:01:00Z");
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-dtmf" },
      callDtmfReceived: {
        callControlId: "ccid-1",
        digit: "5",
        occurredAt: at,
      },
    };
    const event = mapCallEvent(proto);
    expect(event?.type).toBe("call.dtmfReceived");
    if (event?.type !== "call.dtmfReceived") {
      return;
    }
    expect(event.digit).toBe("5");
    expect(event.occurredAt).toEqual(at);
  });

  it("maps call.machine", () => {
    const at = new Date();
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-machine" },
      callMachine: {
        callControlId: "ccid-1",
        result: ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_MACHINE,
        occurredAt: at,
      },
    };
    const event = mapCallEvent(proto);
    expect(event?.type).toBe("call.machine");
    if (event?.type !== "call.machine") {
      return;
    }
    expect(event.result).toBe(MachineDetectionResult.machine);
  });

  it("maps call.bridged with branded peer id", () => {
    const at = new Date();
    const proto: SubscribeEventsResponse = {
      cursor: { value: "cur-bridge" },
      callBridged: {
        callControlId: "ccid-1",
        peerCallControlId: "ccid-2",
        occurredAt: at,
      },
    };
    const event = mapCallEvent(proto);
    expect(event?.type).toBe("call.bridged");
    if (event?.type !== "call.bridged") {
      return;
    }
    expect(event.peerCallControlId).toBe("ccid-2" as any);
  });
});

describe("mapMissedEvent", () => {
  it("maps a missed call.hangup event", () => {
    const at = new Date();
    const event = mapMissedEvent({
      cursor: { value: "cur-h" },
      callHangup: {
        callControlId: "ccid-1",
        occurredAt: at,
        hangupCause: "normal",
      },
    });
    expect(event?.type).toBe("call.hangup");
    if (event?.type !== "call.hangup") {
      return;
    }
    expect(event.hangupCause).toBe("normal");
    expect(event.occurredAt).toEqual(at);
  });

  it("returns null for empty event payload", () => {
    expect(mapMissedEvent({ cursor: { value: "cur" } })).toBeNull();
  });
});
