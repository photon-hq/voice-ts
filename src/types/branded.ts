/**
 * Branded types for compile-time safety.
 *
 * A branded type is a primitive (string or number) with an invisible tag that
 * prevents accidental mixing of identifiers at compile time. There is zero
 * runtime cost -- the brand exists only in the type system.
 *
 * The only way to create a branded value is through the constructor functions
 * exported below.
 */

declare const Brand: unique symbol;

/**
 * Utility type that attaches an invisible brand `B` to base type `T`.
 */
export type Brand<T, B extends string> = T & { readonly [Brand]: B };

/** Identifier for a single call leg from the proxy's perspective. */
export type CallControlId = Brand<string, "CallControlId">;

/** Identifier for a call leg as exposed by the upstream carrier. */
export type CallLegId = Brand<string, "CallLegId">;

/** Identifier for the call session that groups one or more legs. */
export type CallSessionId = Brand<string, "CallSessionId">;

/**
 * Opaque cursor value for resumable event streams.
 *
 * Treat as a black box -- its only contract is "pass it back to
 * `calls.fetchMissed()` to catch up on missed events".
 */
export type StreamCursor = Brand<string, "StreamCursor">;

/** Brand a raw string as a `CallControlId`. */
export function callControlId(raw: string): CallControlId {
  return raw as CallControlId;
}

/** Brand a raw string as a `CallLegId`. */
export function callLegId(raw: string): CallLegId {
  return raw as CallLegId;
}

/** Brand a raw string as a `CallSessionId`. */
export function callSessionId(raw: string): CallSessionId {
  return raw as CallSessionId;
}

/** Brand a raw string as a `StreamCursor`. */
export function streamCursor(raw: string): StreamCursor {
  return raw as StreamCursor;
}
