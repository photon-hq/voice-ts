/**
 * Public enum constants surfaced by the SDK.
 *
 * Each is defined as an `as const` object, so the runtime value and the union
 * type share the same identifier. Prefer these over the numeric proto enums
 * (which are kept internal to the generated code and the mapper layer).
 */

/** Audio codec negotiated for a media stream or clip. */
export const AudioCodec = {
  /** G.711 µ-law, 8 kHz, mono. 20 ms frames = 160 raw bytes. Default. */
  pcmu8000: "pcmu8000",
  /** 16-bit linear PCM, 8 kHz, mono. 20 ms frames = 320 raw bytes. */
  l16_8000: "l16_8000",
  /** 16-bit linear PCM, 16 kHz, mono. 20 ms frames = 640 raw bytes. */
  l16_16000: "l16_16000",
} as const;
export type AudioCodec = (typeof AudioCodec)[keyof typeof AudioCodec];

/** Reason supplied when rejecting an inbound call. */
export const RejectCause = {
  rejected: "rejected",
  userBusy: "userBusy",
  callRejected: "callRejected",
} as const;
export type RejectCause = (typeof RejectCause)[keyof typeof RejectCause];

/** Direction of a call, from the project's perspective. */
export const CallDirection = {
  incoming: "incoming",
  outgoing: "outgoing",
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

/** Result reported by answering-machine detection. */
export const MachineDetectionResult = {
  human: "human",
  machine: "machine",
  silence: "silence",
} as const;
export type MachineDetectionResult =
  (typeof MachineDetectionResult)[keyof typeof MachineDetectionResult];
