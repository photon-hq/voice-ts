/**
 * Unit tests for MediaResource.playClip.
 */

import { describe, expect, it } from "bun:test";
import { AudioCodec as ProtoAudioCodec } from "../../src/generated/photon/voice/v1/media_service.ts";
import { MediaResource } from "../../src/resources/media.ts";
import { callControlId } from "../../src/types/branded.ts";
import { AudioCodec } from "../../src/types/enums.ts";

const ccid = callControlId("ccid-1");

describe("MediaResource.playClip", () => {
  it("defaults codec to pcmu8000 and interrupt to false; passes audio bytes through", async () => {
    let captured: any;
    const client: any = {
      async playClip(req: any) {
        captured = req;
        return { clipId: "clip-1" };
      },
    };
    const resource = new MediaResource(client);

    const audio = new Uint8Array([1, 2, 3, 4]);
    const result = await resource.playClip(ccid, audio);

    expect(captured.callControlId).toBe(ccid);
    expect(captured.codec).toBe(ProtoAudioCodec.AUDIO_CODEC_PCMU_8000);
    expect(captured.interrupt).toBe(false);
    expect(captured.audio).toBe(audio);
    expect(result.clipId).toBe("clip-1");
  });

  it("honours codec and interrupt options", async () => {
    let captured: any;
    const client: any = {
      async playClip(req: any) {
        captured = req;
        return { clipId: "clip-2" };
      },
    };
    const resource = new MediaResource(client);

    await resource.playClip(ccid, new Uint8Array(), {
      codec: AudioCodec.l16_16000,
      interrupt: true,
    });

    expect(captured.codec).toBe(ProtoAudioCodec.AUDIO_CODEC_L16_16000);
    expect(captured.interrupt).toBe(true);
  });
});
