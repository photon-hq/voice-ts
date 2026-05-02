/**
 * Public types for the `calls` resource.
 */

import type { CallControlId, CallLegId, CallSessionId } from "./branded.ts";

/**
 * Identifiers returned by `calls.dial()`.
 *
 * The server returns three IDs because a single Dial creates a fresh leg
 * (`callLegId`), wrapped in a session (`callSessionId`), exposed for control
 * via `callControlId`. Most call-control operations accept the
 * `callControlId`.
 */
export interface Call {
  /** Raw protobuf response, escape hatch for fields not yet typed. */
  readonly _raw?: unknown;
  readonly callControlId: CallControlId;
  readonly callLegId: CallLegId;
  readonly callSessionId: CallSessionId;
}

/** Optional parameters for `calls.dial()`. */
export interface DialOptions {
  /** Enable answering-machine detection. */
  readonly answeringMachineDetection?: boolean;
  /**
   * Application state echoed back on every event for this call.
   * Useful for correlating calls with your own request IDs.
   */
  readonly clientState?: string;
  /**
   * Caller-ID number to dial from (E.164). Must be one of the project's
   * dedicated lines. If omitted, the proxy resolves the line from the
   * project's routing table.
   */
  readonly from?: string;
  /** Override the no-answer timeout (in seconds). */
  readonly timeoutSecs?: number;
}

/** Optional parameters for `calls.answer()`. */
export interface AnswerOptions {
  /** Application state echoed on subsequent events for this call. */
  readonly clientState?: string;
}

/** Optional parameters for `calls.transfer()`. */
export interface TransferOptions {
  /** Application state echoed on subsequent events for this call. */
  readonly clientState?: string;
}

/** Optional parameters for `calls.sendDtmf()`. */
export interface SendDtmfOptions {
  /** Per-digit duration in milliseconds. */
  readonly durationMillis?: number;
}
