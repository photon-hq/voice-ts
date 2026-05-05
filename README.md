# @photon-ai/voice-ts

TypeScript SDK for **Photon Spectrum Voice** — call control + media plane over gRPC.

```bash
bun add @photon-ai/voice-ts
```

```ts
import { createClient, AudioCodec } from "@photon-ai/voice-ts";

const voice = createClient({ token: process.env.VOICE_TOKEN! });

const call = await voice.calls.dial("+14155551234", { from: "+14155550100" });

for await (const event of voice.calls.subscribe()) {
  if (event.type === "call.answered" && event.callControlId === call.callControlId) {
    await using session = voice.media.openStream({
      callControlId: call.callControlId,
      codec: AudioCodec.pcmu8000,
      sendInbound: true,
    });
    session.events.on((e) => {
      if (e.type === "frame") transcribe(e.audio);
    });
    for (const chunk of myTtsAudio()) session.sendFrame(chunk);
  }
  if (event.type === "call.hangup") break;
}

await voice.close();
```

## Auth

`token` is a LightAuth-issued JWT. Pass a string or an async resolver
(`() => Promise<string>`) to refresh it on each call. The SDK sends it as the
`access_token` gRPC metadata key — **not** `authorization: Bearer …`.

### Keepalive

For long-lived `subscribe()` and `media.openStream()` calls passing through
NATs / load balancers, set keepalive:

```ts
createClient({
  token,
  keepalive: { timeMs: 30_000, timeoutMs: 10_000, permitWithoutCalls: true },
});
```

## Design

See [DESIGN.md](./DESIGN.md) for the full design rationale. Highlights:

- **Resources mirror proto services**: `voice.calls.*` (CallService) and
  `voice.media.*` (MediaService).
- **Branded IDs** (`CallControlId`, `CallLegId`, `CallSessionId`,
  `StreamCursor`) prevent accidental mixing of identifiers at compile time.
- **Discriminated event union** (`CallEvent`) — `subscribe()` yields a
  TypeScript-narrowable `{ type: "call.initiated" | … }`.
- **`MediaSession`** is an imperative handle over the bidi `MediaStream` RPC.
  Open it, push frames, listen on `events`, dispose to close.
- **Errors** are an `instanceof`-based hierarchy (`VoiceError`,
  `AuthenticationError`, `NotFoundError`, `RateLimitError`, `ValidationError`,
  `ConnectionError`).
- **Cursor-based catch-up**: persist `event.cursor` from the live stream;
  call `voice.calls.fetchMissed(cursor)` after a reconnect.
- **`AsyncDisposable` everywhere** — `await using voice = createClient(...)`.

## Development

```bash
bun install
bun run generate      # regenerate src/generated/ from proto/
bun run check         # tsc --noEmit
bun run lint          # biome
bun test
bun run build         # buf generate + tsup
```
