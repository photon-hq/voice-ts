/**
 * Conversion functions between proto types (numeric enums, snake_case-derived
 * camelCase fields, optional Date) and the SDK's public types (string-literal
 * enums, branded IDs, required Dates with helpful errors).
 *
 * Every gRPC response that crosses into user code passes through one of these
 * mappers. The reverse direction (SDK → proto) is used for request fields
 * whose proto type is a numeric enum.
 */

import {
  type DialResponse,
  type CallAnsweredEvent as ProtoCallAnsweredEvent,
  type CallBridgedEvent as ProtoCallBridgedEvent,
  type CallDTMFReceivedEvent as ProtoCallDtmfReceivedEvent,
  type CallHangupEvent as ProtoCallHangupEvent,
  type CallInitiatedEvent as ProtoCallInitiatedEvent,
  type CallMachineEvent as ProtoCallMachineEvent,
  type Event as ProtoEvent,
  MachineDetectionResult as ProtoMachineDetectionResult,
  RejectCause as ProtoRejectCause,
  type SubscribeEventsResponse,
} from "../generated/photon/voice/v1/call_service.ts";
import {
  CallDirection as ProtoCallDirection,
  type StreamCursor as ProtoStreamCursor,
} from "../generated/photon/voice/v1/common.ts";
import { AudioCodec as ProtoAudioCodec } from "../generated/photon/voice/v1/media_service.ts";
import {
  type CallControlId,
  callControlId,
  callLegId,
  callSessionId,
  type StreamCursor,
  streamCursor,
} from "../types/branded.ts";
import type { Call } from "../types/calls.ts";
import {
  AudioCodec,
  CallDirection,
  MachineDetectionResult,
  RejectCause,
} from "../types/enums.ts";
import type {
  CallAnsweredEvent,
  CallBridgedEvent,
  CallDtmfReceivedEvent,
  CallEvent,
  CallHangupEvent,
  CallInitiatedEvent,
  CallMachineEvent,
} from "../types/events.ts";
import { unwrap } from "../utils/unwrap.ts";

// ---------------------------------------------------------------------------
// Enum: proto → SDK
// ---------------------------------------------------------------------------

export function mapCallDirection(proto: ProtoCallDirection): CallDirection {
  if (proto === ProtoCallDirection.CALL_DIRECTION_OUTGOING) {
    return CallDirection.outgoing;
  }
  return CallDirection.incoming;
}

export function mapRejectCause(proto: ProtoRejectCause): RejectCause {
  if (proto === ProtoRejectCause.REJECT_CAUSE_USER_BUSY) {
    return RejectCause.userBusy;
  }
  if (proto === ProtoRejectCause.REJECT_CAUSE_CALL_REJECTED) {
    return RejectCause.callRejected;
  }
  return RejectCause.rejected;
}

export function mapMachineDetectionResult(
  proto: ProtoMachineDetectionResult
): MachineDetectionResult {
  if (proto === ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_MACHINE) {
    return MachineDetectionResult.machine;
  }
  if (proto === ProtoMachineDetectionResult.MACHINE_DETECTION_RESULT_SILENCE) {
    return MachineDetectionResult.silence;
  }
  return MachineDetectionResult.human;
}

export function mapAudioCodec(proto: ProtoAudioCodec): AudioCodec {
  if (proto === ProtoAudioCodec.AUDIO_CODEC_L16_8000) {
    return AudioCodec.l16_8000;
  }
  if (proto === ProtoAudioCodec.AUDIO_CODEC_L16_16000) {
    return AudioCodec.l16_16000;
  }
  return AudioCodec.pcmu8000;
}

// ---------------------------------------------------------------------------
// Enum: SDK → proto
// ---------------------------------------------------------------------------

export function toProtoRejectCause(cause: RejectCause): ProtoRejectCause {
  if (cause === RejectCause.userBusy) {
    return ProtoRejectCause.REJECT_CAUSE_USER_BUSY;
  }
  if (cause === RejectCause.callRejected) {
    return ProtoRejectCause.REJECT_CAUSE_CALL_REJECTED;
  }
  return ProtoRejectCause.REJECT_CAUSE_REJECTED;
}

export function toProtoAudioCodec(codec: AudioCodec): ProtoAudioCodec {
  if (codec === AudioCodec.l16_8000) {
    return ProtoAudioCodec.AUDIO_CODEC_L16_8000;
  }
  if (codec === AudioCodec.l16_16000) {
    return ProtoAudioCodec.AUDIO_CODEC_L16_16000;
  }
  return ProtoAudioCodec.AUDIO_CODEC_PCMU_8000;
}

// ---------------------------------------------------------------------------
// StreamCursor
// ---------------------------------------------------------------------------

export function mapStreamCursor(
  proto: ProtoStreamCursor | undefined
): StreamCursor | undefined {
  if (!proto?.value) {
    return;
  }
  return streamCursor(proto.value);
}

// ---------------------------------------------------------------------------
// Domain mappers
// ---------------------------------------------------------------------------

export function mapDialResponse(proto: DialResponse): Call {
  return {
    callControlId: callControlId(proto.callControlId),
    callLegId: callLegId(proto.callLegId),
    callSessionId: callSessionId(proto.callSessionId),
    _raw: proto,
  };
}

// ---------------------------------------------------------------------------
// Event mappers
// ---------------------------------------------------------------------------

function mapInitiated(
  proto: ProtoCallInitiatedEvent,
  cursor: StreamCursor | undefined
): CallInitiatedEvent {
  return {
    type: "call.initiated",
    callControlId: callControlId(proto.callControlId),
    callLegId: callLegId(proto.callLegId),
    callSessionId: callSessionId(proto.callSessionId),
    direction: mapCallDirection(proto.direction),
    from: proto.from,
    to: proto.to,
    projectDid: proto.projectDid,
    endUserNumber: proto.endUserNumber,
    callerIdName: proto.callerIdName,
    startTime: unwrap(proto.startTime, "startTime"),
    clientState: proto.clientState,
    shakenStirAttestation: proto.shakenStirAttestation,
    cursor,
    _raw: proto,
  };
}

function mapAnswered(
  proto: ProtoCallAnsweredEvent,
  cursor: StreamCursor | undefined
): CallAnsweredEvent {
  return {
    type: "call.answered",
    callControlId: callControlId(proto.callControlId),
    occurredAt: unwrap(proto.occurredAt, "occurredAt"),
    clientState: proto.clientState,
    cursor,
    _raw: proto,
  };
}

function mapHangup(
  proto: ProtoCallHangupEvent,
  cursor: StreamCursor | undefined
): CallHangupEvent {
  return {
    type: "call.hangup",
    callControlId: callControlId(proto.callControlId),
    occurredAt: unwrap(proto.occurredAt, "occurredAt"),
    hangupCause: proto.hangupCause,
    hangupSource: proto.hangupSource,
    sipHangupCause: proto.sipHangupCause,
    clientState: proto.clientState,
    cursor,
    _raw: proto,
  };
}

function mapBridged(
  proto: ProtoCallBridgedEvent,
  cursor: StreamCursor | undefined
): CallBridgedEvent {
  return {
    type: "call.bridged",
    callControlId: callControlId(proto.callControlId),
    peerCallControlId: callControlId(proto.peerCallControlId) as CallControlId,
    occurredAt: unwrap(proto.occurredAt, "occurredAt"),
    clientState: proto.clientState,
    cursor,
    _raw: proto,
  };
}

function mapDtmf(
  proto: ProtoCallDtmfReceivedEvent,
  cursor: StreamCursor | undefined
): CallDtmfReceivedEvent {
  return {
    type: "call.dtmfReceived",
    callControlId: callControlId(proto.callControlId),
    digit: proto.digit,
    occurredAt: unwrap(proto.occurredAt, "occurredAt"),
    clientState: proto.clientState,
    cursor,
    _raw: proto,
  };
}

function mapMachine(
  proto: ProtoCallMachineEvent,
  cursor: StreamCursor | undefined
): CallMachineEvent {
  return {
    type: "call.machine",
    callControlId: callControlId(proto.callControlId),
    result: mapMachineDetectionResult(proto.result),
    occurredAt: unwrap(proto.occurredAt, "occurredAt"),
    clientState: proto.clientState,
    cursor,
    _raw: proto,
  };
}

/**
 * Convert a `SubscribeEventsResponse` into a {@link CallEvent} (or `null` for
 * heartbeats / unknown variants).
 *
 * Heartbeats are filtered out internally so they never surface to user code.
 */
export function mapCallEvent(proto: SubscribeEventsResponse): CallEvent | null {
  if (proto.heartbeat) {
    return null;
  }
  const cursor = mapStreamCursor(proto.cursor);
  if (proto.callInitiated) {
    return mapInitiated(proto.callInitiated, cursor);
  }
  if (proto.callAnswered) {
    return mapAnswered(proto.callAnswered, cursor);
  }
  if (proto.callHangup) {
    return mapHangup(proto.callHangup, cursor);
  }
  if (proto.callBridged) {
    return mapBridged(proto.callBridged, cursor);
  }
  if (proto.callDtmfReceived) {
    return mapDtmf(proto.callDtmfReceived, cursor);
  }
  if (proto.callMachine) {
    return mapMachine(proto.callMachine, cursor);
  }
  return null;
}

/**
 * Convert a single replayed `Event` (from FetchMissedEvents) into a
 * {@link CallEvent} (or `null` for unknown variants). Replayed events never
 * carry a Heartbeat.
 */
export function mapMissedEvent(proto: ProtoEvent): CallEvent | null {
  const cursor = mapStreamCursor(proto.cursor);
  if (proto.callInitiated) {
    return mapInitiated(proto.callInitiated, cursor);
  }
  if (proto.callAnswered) {
    return mapAnswered(proto.callAnswered, cursor);
  }
  if (proto.callHangup) {
    return mapHangup(proto.callHangup, cursor);
  }
  if (proto.callBridged) {
    return mapBridged(proto.callBridged, cursor);
  }
  if (proto.callDtmfReceived) {
    return mapDtmf(proto.callDtmfReceived, cursor);
  }
  if (proto.callMachine) {
    return mapMachine(proto.callMachine, cursor);
  }
  return null;
}
