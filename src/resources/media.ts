/**
 * MediaResource -- wraps `MediaService` (audio plane).
 *
 * `playClip` is a unary helper for one-shot playback. `openStream` returns
 * a {@link MediaSession} handle for full-duplex audio.
 */

import { fromGrpcError } from "../errors/error-handler.ts";
import {
  type MediaSession,
  type MediaSessionOptions,
  openMediaSession,
} from "../streaming/media-session.ts";
import type { MediaServiceClient } from "../transport/grpc-client.ts";
import { toProtoAudioCodec } from "../transport/mapper.ts";
import type { CallControlId } from "../types/branded.ts";
import { AudioCodec } from "../types/enums.ts";

/** Optional parameters for `media.playClip()`. */
export interface PlayClipOptions {
  /** Codec the audio is encoded in. Default `AudioCodec.pcmu8000`. */
  readonly codec?: AudioCodec;
  /**
   * If `true`, cancel any active stream/clip on this call before playing.
   * Default `false`.
   */
  readonly interrupt?: boolean;
}

export class MediaResource {
  private readonly _client: MediaServiceClient;

  constructor(client: MediaServiceClient) {
    this._client = client;
  }

  /**
   * Play a pre-encoded audio clip on a live call.
   *
   * Returns once the proxy has accepted the clip — not when audio finishes
   * playing. The `clipId` can be correlated with future media events.
   *
   * @param audio Raw codec bytes. NO container/header (no WAV, no base64).
   */
  async playClip(
    callControlId: CallControlId,
    audio: Uint8Array,
    options?: PlayClipOptions
  ): Promise<{ readonly clipId: string }> {
    try {
      const response = await this._client.playClip({
        callControlId,
        codec: toProtoAudioCodec(options?.codec ?? AudioCodec.pcmu8000),
        audio,
        interrupt: options?.interrupt ?? false,
      });
      return { clipId: response.clipId };
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /**
   * Open a full-duplex media session against the bidi `MediaStream` RPC.
   *
   * Sends `StartStream` automatically; user-facing operations (`sendFrame`,
   * `mark`, `interrupt`, `stop`) push subsequent client messages.
   *
   * Only one `MediaStream` is allowed per `callControlId` at a time. A
   * second concurrent open will surface a `ValidationError` on the first
   * read of `session.events`.
   */
  openStream(options: MediaSessionOptions): MediaSession {
    return openMediaSession(this._client, options);
  }
}
