/**
 * Canonical error codes returned by the server.
 *
 * Modelled as an `as const` object so that both the runtime values and the
 * union type are available, with full autocomplete.
 *
 * Unknown codes from the server are surfaced as `internalError`.
 */

export const ErrorCode = {
  // Authentication / authorization
  unauthenticated: "unauthenticated",
  tokenExpired: "tokenExpired",
  tokenBlocked: "tokenBlocked",
  unauthorized: "unauthorized",

  // Project state
  voicePlatformDisabled: "voicePlatformDisabled",

  // Rate limiting
  rateLimited: "rateLimited",

  // Not found
  callNotFound: "callNotFound",
  lineNotFound: "lineNotFound",

  // Call lifecycle / placement
  dialFailed: "dialFailed",
  invalidNumber: "invalidNumber",
  mediaStreamConflict: "mediaStreamConflict",

  // Validation / precondition
  invalidArgument: "invalidArgument",
  preconditionFailed: "preconditionFailed",
  operationNotSupported: "operationNotSupported",

  // Infrastructure
  serviceUnavailable: "serviceUnavailable",
  timeout: "timeout",
  internalError: "internalError",
  networkError: "networkError",
} as const;

/** Union of all known error code strings. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
