/**
 * Event types for the voice call event stream.
 *
 * All events are modelled as discriminated unions with `readonly` properties
 * so that TypeScript narrows the type automatically in `if`/`switch` blocks.
 *
 * The {@link EventTypeMap} provides a mapping from event-type string literal
 * to the concrete event shape, enabling type-safe `subscribe()` overloads.
 */

import type {
  CallControlId,
  CallLegId,
  CallSessionId,
  StreamCursor,
} from "./branded.ts";
import type { CallDirection, MachineDetectionResult } from "./enums.ts";

/**
 * First event emitted for any call. For incoming calls `from` is the end
 * user and `to` is the project DID; for outgoing calls these are reversed.
 */
export interface CallInitiatedEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly callerIdName?: string;
  readonly callLegId: CallLegId;
  readonly callSessionId: CallSessionId;
  /** Application state echoed from `dial()` or set on the inbound DID config. */
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly direction: CallDirection;
  /** End customer's number (caller for incoming, callee for outgoing). */
  readonly endUserNumber: string;
  /** Caller's number, E.164. */
  readonly from: string;
  /** Project's public-facing DID for this call. */
  readonly projectDid: string;
  readonly shakenStirAttestation?: string;
  readonly startTime: Date;
  /** Callee's number, E.164. */
  readonly to: string;
  readonly type: "call.initiated";
}

/** The remote side answered. */
export interface CallAnsweredEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly occurredAt: Date;
  readonly type: "call.answered";
}

/** The call ended. */
export interface CallHangupEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly hangupCause?: string;
  readonly hangupSource?: string;
  readonly occurredAt: Date;
  readonly sipHangupCause?: string;
  readonly type: "call.hangup";
}

/** Two legs were bridged together. */
export interface CallBridgedEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly occurredAt: Date;
  readonly peerCallControlId: CallControlId;
  readonly type: "call.bridged";
}

/** A DTMF digit was received from the remote side. */
export interface CallDtmfReceivedEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly digit: string;
  readonly occurredAt: Date;
  readonly type: "call.dtmfReceived";
}

/** Answering-machine detection produced a result. */
export interface CallMachineEvent {
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly clientState?: string;
  readonly cursor?: StreamCursor;
  readonly occurredAt: Date;
  readonly result: MachineDetectionResult;
  readonly type: "call.machine";
}

/** Union of every event emitted on the call event stream. */
export type CallEvent =
  | CallInitiatedEvent
  | CallAnsweredEvent
  | CallHangupEvent
  | CallBridgedEvent
  | CallDtmfReceivedEvent
  | CallMachineEvent;

/**
 * Maps each event-type string literal to its concrete event shape.
 *
 * Used by `subscribe()` overloads to narrow the returned event type when a
 * specific event type string is provided.
 */
export interface EventTypeMap {
  "call.answered": CallAnsweredEvent;
  "call.bridged": CallBridgedEvent;
  "call.dtmfReceived": CallDtmfReceivedEvent;
  "call.hangup": CallHangupEvent;
  "call.initiated": CallInitiatedEvent;
  "call.machine": CallMachineEvent;
}

/** Union of all known event-type string literals. */
export type EventType = keyof EventTypeMap;
