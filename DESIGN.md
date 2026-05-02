# API Design

TypeScript SDK for [photon-hq/spectrum-voice](https://github.com/photon-hq/spectrum-voice). The vendored `.proto` files in `proto/photon/voice/v1/` are the single source of truth for the wire protocol.

The shape of this SDK mirrors [`@photon-ai/advanced-imessage`](https://github.com/photon-hq/advanced-imessage-ts). Same tooling, same patterns, same DX. If you've used one, the other should feel familiar.

---

## It should feel like this

```ts
import { createClient, AudioCodec } from "@photon-ai/voice-ts";

const voice = createClient({ token: process.env.VOICE_TOKEN! });

const call = await voice.calls.dial("+14155551234", { from: "+14155550100" });
```

One import, one line to connect, one line to dial. Everything else is opt-in.

---

## Principles

**TypeScript does the work, not the developer.** Branded types prevent swapping a `CallControlId` for a `CallLegId` at compile time. Discriminated unions narrow `CallEvent` automatically in `if`/`switch`. Overloaded `subscribe(type)` narrows the result. The developer writes less, the compiler catches more.

**No magic strings.** Audio codec names (`pcmu_8000`, `l16_16000`) and machine-detection results (`MACHINE_DETECTION_RESULT_HUMAN`) are hidden behind `AudioCodec.pcmu8000` and `MachineDetectionResult.human`. The developer never sees proto internals.

**Every resource is disposable.** Client, streams, sessions — all implement `Symbol.asyncDispose`. `await using` just works:

```ts
await using voice = createClient({ token });
await using session = voice.media.openStream({ ... });
```

**Strict by default.** The codebase compiles under `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`. Generated code is excluded from strict TS checking but must still type-check on its own.

**Nullable values are handled, not asserted.** Proto response fields come back as `T | undefined`. We use `unwrap(value, "fieldName")` — a typed guard that throws a clear error — instead of non-null assertions (`!`).

---

## Core Types

### Branded Identifiers

```ts
declare const Brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [Brand]: B };

export type CallControlId  = Brand<string, "CallControlId">;
export type CallLegId      = Brand<string, "CallLegId">;
export type CallSessionId  = Brand<string, "CallSessionId">;
export type StreamCursor   = Brand<string, "StreamCursor">;
```

Zero runtime cost. The only way to construct one is through `callControlId(raw)`, `callLegId(raw)`, etc. — or by receiving one from the SDK.

### Enums as `as const` Objects

```ts
export const AudioCodec = {
  pcmu8000:   "pcmu8000",   // G.711 µ-law, 8 kHz, 20 ms = 160 bytes
  l16_8000:   "l16_8000",   // 16-bit linear PCM, 8 kHz, 20 ms = 320 bytes
  l16_16000:  "l16_16000",  // 16-bit linear PCM, 16 kHz, 20 ms = 640 bytes
} as const;
export type AudioCodec = (typeof AudioCodec)[keyof typeof AudioCodec];
```

Runtime values + full autocomplete + type narrowing. No TS enums. Same pattern for `RejectCause`, `CallDirection`, `MachineDetectionResult`.

### Discriminated Event Union

```ts
type CallEvent =
  | { type: "call.initiated"; callControlId: CallControlId; ... }
  | { type: "call.answered";  callControlId: CallControlId; ... }
  | { type: "call.hangup";    callControlId: CallControlId; ... }
  | { type: "call.bridged";   callControlId: CallControlId; peerCallControlId: CallControlId; ... }
  | { type: "call.dtmfReceived"; callControlId: CallControlId; digit: string; ... }
  | { type: "call.machine";   callControlId: CallControlId; result: MachineDetectionResult; ... };
```

`if (event.type === "call.machine")` narrows the type and unlocks `event.result` with full autocomplete.

---

## Streaming

### Server-streaming (`calls.subscribe`)

```ts
for await (const event of voice.calls.subscribe()) {
  // ...
}

// Type-narrowed sub-stream:
for await (const dtmf of voice.calls.subscribe("call.dtmfReceived")) {
  console.log(dtmf.digit); // string
}

// Callback style:
const stop = voice.calls.subscribe().on(handle);
stop();
```

Heartbeats are filtered internally — they never surface to user code.

### Cursor-based catch-up

Every `CallEvent` carries an opaque `cursor`. Persist it. After a reconnect, replay the gap:

```ts
let cursor = await loadCursor();

if (cursor) {
  const missed = await voice.calls.fetchMissed(cursor);
  for (const event of missed) {
    handle(event);
    cursor = event.cursor;
  }
}

for await (const event of voice.calls.subscribe()) {
  handle(event);
  if (event.cursor) {
    cursor = event.cursor;
    await persistCursor(cursor);
  }
}
```

Or wrap the whole thing in `withReconnect()` for transparent reconnects.

### Bidi streaming (`media.openStream`)

The bidi `MediaStream` RPC is the only place voice-ts deviates from imessage's surface — imessage has no bidi RPCs to mirror.

The raw nice-grpc surface is `(AsyncIterable<ClientMsg>) -> AsyncIterable<ServerMsg>`, which forces users to write async generators by hand and interleave outbound pushes with inbound consumption. We hide that with an imperative session handle:

```ts
await using session = voice.media.openStream({
  callControlId,
  codec: AudioCodec.pcmu8000,
  sendInbound: true,
  sendDtmf: false,
});

session.events.on((evt) => {
  if (evt.type === "frame") forwardToTranscriber(evt.audio);
  if (evt.type === "dtmf")  handleDigit(evt.digit);
});

for (const chunk of myTtsAudio()) session.sendFrame(chunk);
session.mark("end-of-prompt");
// auto-stop on scope exit
```

Internally, `MediaSession` is a deferred-resolve push channel: outbound messages go into a FIFO queue, and a single replaceable promise gates the outbound generator. `sendFrame`, `mark`, `interrupt`, and `stop` all push and signal. `StartStream` is sent automatically as the first message.

Backpressure: pass `outboundCapacity: N` to drop the oldest frame when the queue exceeds `N`. Drops surface as a synthetic `{ type: "error", code: "OVERFLOW" }` event on `events`.

Server-side, only one `MediaStream` per `callControlId` is allowed. A second concurrent open returns `FAILED_PRECONDITION`, which surfaces as a `ValidationError` on the first read of `events`.

---

## Errors

Errors are an `instanceof`-based hierarchy — branch on the class, not on a `code` string:

```ts
try {
  await voice.calls.dial("+1...");
} catch (err) {
  if (err instanceof RateLimitError)      retryLater();
  if (err instanceof AuthenticationError) refreshToken();
  if (err instanceof NotFoundError)       handleMissing();
  if (err instanceof ValidationError)     fixInputs();
  if (err instanceof ConnectionError)     reconnect();
}
```

Mapping from gRPC status to SDK class:

| gRPC | SDK |
|---|---|
| `UNAUTHENTICATED`, `PERMISSION_DENIED` | `AuthenticationError` |
| `NOT_FOUND` | `NotFoundError` |
| `RESOURCE_EXHAUSTED` | `RateLimitError` |
| `INVALID_ARGUMENT`, `FAILED_PRECONDITION` | `ValidationError` |
| `UNAVAILABLE`, `DEADLINE_EXCEEDED` | `ConnectionError` |
| Everything else | `VoiceError` |

Server-supplied trailing metadata (`error-code`, `x-retryable`) is captured and surfaced as `err.code` and `err.retryable`.

---

## Auth

The auth model is simple: a LightAuth-issued JWT, sent on every call as the `access_token` gRPC metadata key (no `Bearer` prefix — that's the most likely accidental regression when porting from imessage's auth middleware).

```ts
createClient({
  token: async () => {
    const { token } = await fetchFreshJwt();
    return token;
  },
});
```

The async resolver is invoked per RPC, so each call can pull a fresh token. For long-lived `subscribe()` and `media.openStream()` calls the token is resolved once at call start; if it expires mid-stream, the server closes with `UNAUTHENTICATED` and the SDK surfaces `AuthenticationError` — wrap with `withReconnect()` to get a new token on the next attempt.

---

## Retry

Retry is **opt-in** (`retry: true` or `retry: { maxAttempts, initialDelay, maxDelay }`). The middleware retries when the server's trailing metadata says `x-retryable: true`. Streaming RPCs are skipped automatically.

⚠ **`calls.dial` is not idempotent on the server.** Enabling retry can result in duplicate calls if a transient `UNAVAILABLE` slips through after the upstream carrier accepted the dial. Prefer leaving `retry` disabled for dial-heavy workloads, or implement caller-side dedup via `client_state`.

---

## Verifying against a real server

```ts
// Local dev (run `bun run dev` in spectrum-voice)
createClient({ address: "localhost:50051", tls: false, token: "..." });

// Staging
createClient({
  address: "staging-spectrum-voice-grpc.photon.codes:443",
  token: await issueLightAuthToken(projectId),
});
```

A minimal smoke test:

```ts
const call = await voice.calls.dial("+14155551234", { from: "+14155550100" });
console.log("dialed", call.callControlId);
for await (const event of voice.calls.subscribe()) {
  console.log(event.type, event);
  if (event.type === "call.hangup") break;
}
await voice.close();
```

---

## Updating the proto

`proto/photon/voice/v1/` is a vendored copy. Updates flow downstream from `spectrum-voice/proto/`:

```bash
cp ../spectrum-voice/proto/photon/voice/v1/*.proto proto/photon/voice/v1/
bun run generate
bun run check
bun test
```

If a proto change breaks a mapper or a resource method, the typechecker will surface it. Update `src/transport/mapper.ts` and the affected resource, then add a mapper test that pins the new shape.
