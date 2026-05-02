/** biome-ignore-all lint/performance/noBarrelFile: intentional public API surface */

export type { ClientOptions, VoiceClient } from "./client.ts";
// Client
export { createClient, DEFAULT_ADDRESS } from "./client.ts";

// Errors
export {
  AuthenticationError,
  ConnectionError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  VoiceError,
} from "./errors/voice-error.ts";
// Resources
export type { CallsResource } from "./resources/calls.ts";
export type { MediaResource, PlayClipOptions } from "./resources/media.ts";
// Streaming
export { TypedEventStream } from "./streaming/event-stream.ts";
export type {
  MediaInboundEvent,
  MediaSession,
  MediaSessionOptions,
} from "./streaming/media-session.ts";
export {
  type ReconnectOptions,
  withReconnect,
} from "./streaming/reconnect.ts";
// Transport options
export type { KeepaliveOptions } from "./transport/grpc-client.ts";
export type {
  CallControlId,
  CallLegId,
  CallSessionId,
  StreamCursor,
} from "./types/branded.ts";
// Branded types + constructors
export {
  callControlId,
  callLegId,
  callSessionId,
  streamCursor,
} from "./types/branded.ts";
// Domain types
export type {
  AnswerOptions,
  Call,
  DialOptions,
  SendDtmfOptions,
  TransferOptions,
} from "./types/calls.ts";
// Common
export type { RetryOptions } from "./types/common.ts";
// Enums
export {
  AudioCodec,
  CallDirection,
  MachineDetectionResult,
  RejectCause,
} from "./types/enums.ts";
// Error codes
export { ErrorCode } from "./types/errors.ts";
// Events
export type {
  CallAnsweredEvent,
  CallBridgedEvent,
  CallDtmfReceivedEvent,
  CallEvent,
  CallHangupEvent,
  CallInitiatedEvent,
  CallMachineEvent,
  EventType,
  EventTypeMap,
} from "./types/events.ts";
