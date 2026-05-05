/**
 * Interactive outbound-call placer built on @photon-ai/voice-ts.
 *
 * Mirrors spectrum-voice/scripts/dial.ts but uses the SDK's `createClient` +
 * `voice.calls.dial()` / `voice.calls.hangup()` instead of the raw nice-grpc
 * client.
 *
 * Prompts for a project ID + secret, enables the voice platform on Spectrum
 * Cloud's external API, mints a LightAuth JWT (sub=projectId), then lists the
 * project's dedicated lines, prompts you to pick a `from`, prompts for a
 * `to`, and calls `Dial`. Polls Telnyx's `speak` action until it succeeds
 * (Telnyx returns 422 while the call is still ringing — the first 200 is our
 * "answered" signal). Then it speaks a greeting via Telnyx TTS and hangs up
 * after a short linger.
 *
 * Usage:
 *   bun run scripts/dial.ts \
 *     [--grpc <host:port>] [--project <id>] [--to +1...] [--from +1...] \
 *     [--speak "..."] [--linger 8] [--no-hangup]
 *
 * Any flag can be omitted — the script will prompt. Env (read from .env):
 *   GRPC_ADDRESS                 Default: spectrum-voice-grpc.photon.codes:443
 *   LIGHTAUTH_ENDPOINT           Required. e.g. https://lightauth.photon.codes
 *   SPECTRUM_CLOUD_EXTERNAL_URL  Default: https://staging-spectrum-cloud.photon.codes
 *   SPECTRUM_CLOUD_ENDPOINT      Required for line listing.
 *   TELNYX_API_KEY               Required for the Speak greeting.
 *   TELNYX_API_BASE_URL          Default: https://api.telnyx.com/v2
 *
 * The gRPC service has no `Speak` RPC, so the greeting goes via Telnyx's
 * `POST /calls/{id}/actions/speak` directly.
 */

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../src/index.ts";

const INBOUND_SERVICE = "codes.photon.spectrum.voice";

interface Args {
  from?: string;
  grpc?: string;
  linger?: string;
  "no-hangup"?: string;
  project?: string;
  speak?: string;
  to?: string;
}

const FLAG_PREFIX = /^--/;
const BOOLEAN_FLAGS = new Set<keyof Args>(["no-hangup"]);

function parseArgs(): Args {
  const out: Partial<Args> = {};
  let i = 2;
  while (i < process.argv.length) {
    const flag = process.argv[i];
    if (!flag?.startsWith("--")) {
      i += 1;
      continue;
    }
    const key = flag.replace(FLAG_PREFIX, "") as keyof Args;
    if (BOOLEAN_FLAGS.has(key)) {
      out[key] = "true";
      i += 1;
      continue;
    }
    const value = process.argv[i + 1];
    if (value !== undefined) {
      out[key] = value;
    }
    i += 2;
  }
  return out;
}

async function ensure(
  rl: ReturnType<typeof createInterface>,
  envName: string,
  promptLabel: string
): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    return fromEnv;
  }
  const answer = (await rl.question(`${promptLabel}: `)).trim();
  if (!answer) {
    throw new Error(`${envName} is required`);
  }
  return answer;
}

async function promptRequired(
  rl: ReturnType<typeof createInterface>,
  label: string
): Promise<string> {
  const value = (await rl.question(`${label}: `)).trim();
  if (!value) {
    console.error(`${label} is required`);
    process.exit(1);
  }
  return value;
}

async function enableVoicePlatform(opts: {
  cloudExternalUrl: string;
  projectId: string;
  projectSecret: string;
}): Promise<void> {
  const auth = `Basic ${Buffer.from(`${opts.projectId}:${opts.projectSecret}`).toString("base64")}`;
  const base = `${opts.cloudExternalUrl}/projects/${encodeURIComponent(opts.projectId)}/platforms`;

  const toggle = await fetch(`${base}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ platform: "voice", enabled: true }),
  });
  if (!toggle.ok) {
    throw new Error(
      `enable voice platform failed: ${toggle.status} ${await toggle.text()}`
    );
  }

  const meta = await fetch(`${base}/voice`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ imessage_enabled: true }),
  });
  if (!meta.ok) {
    throw new Error(
      `set voice.imessage_enabled failed: ${meta.status} ${await meta.text()}`
    );
  }
}

async function issueJwt(opts: {
  lightauthEndpoint: string;
  projectId: string;
}): Promise<string> {
  const res = await fetch(`${opts.lightauthEndpoint}/tokens/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceName: INBOUND_SERVICE,
      subject: opts.projectId,
      expiresIn: 3600,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `LightAuth token issue failed: ${res.status} ${await res.text()}`
    );
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

interface LinesListResponse {
  data: {
    lines: Array<
      | {
          createdAt: string;
          id: string;
          phoneNumber: string;
          platform: "imessage";
        }
      | { platform: "whatsapp_business" }
    >;
  };
  succeed: true;
}

async function fetchProjectLines(
  cloudEndpoint: string,
  projectId: string
): Promise<string[]> {
  const url = new URL(
    `${cloudEndpoint}/projects/${encodeURIComponent(projectId)}/lines`
  );
  url.searchParams.set("platform", "imessage");
  url.searchParams.set("limit", "500");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `spectrum-cloud lines.list status=${res.status} body=${await res.text()}`
    );
  }
  const body = (await res.json()) as LinesListResponse;
  const phones: string[] = [];
  for (const line of body.data.lines) {
    if (line.platform === "imessage") {
      phones.push(line.phoneNumber);
    }
  }
  return phones;
}

async function pickFrom(
  rl: ReturnType<typeof createInterface>,
  lines: string[]
): Promise<string | undefined> {
  console.log("\nProject lines:");
  if (lines.length === 0) {
    console.log("  (none)");
  } else {
    for (const [i, phone] of lines.entries()) {
      console.log(`  [${i + 1}] ${phone}`);
    }
  }
  console.log("  [c] custom (enter manually)");
  console.log("  [s] skip — let server resolve from existing user");

  const choice = (await rl.question("\nselect from: ")).trim();
  if (choice === "s" || choice === "S") {
    return;
  }
  if (choice === "c" || choice === "C") {
    const custom = (await rl.question("from (E.164): ")).trim();
    if (!custom) {
      throw new Error("from is required");
    }
    return custom;
  }
  const idx = Number.parseInt(choice, 10);
  if (!Number.isFinite(idx) || idx < 1 || idx > lines.length) {
    throw new Error(`invalid selection: ${choice}`);
  }
  return lines[idx - 1] as string;
}

async function telnyxAction(opts: {
  apiBaseUrl: string;
  apiKey: string;
  body?: Record<string, unknown>;
  callControlId: string;
  name: string;
}): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `${opts.apiBaseUrl}/calls/${encodeURIComponent(opts.callControlId)}/actions/${opts.name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const ANSWER_TIMEOUT_MS = 90_000;
const ANSWER_POLL_MS = 1000;

async function waitForAnswerAndSpeak(opts: {
  apiBaseUrl: string;
  apiKey: string;
  callControlId: string;
  text: string;
}): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < ANSWER_TIMEOUT_MS) {
    attempt += 1;
    const result = await telnyxAction({
      apiBaseUrl: opts.apiBaseUrl,
      apiKey: opts.apiKey,
      callControlId: opts.callControlId,
      name: "speak",
      body: {
        payload: opts.text,
        voice: "Polly.Joanna",
        language: "en-US",
        payload_type: "text",
      },
    });
    if (result.ok) {
      const elapsed = Date.now() - start;
      console.log(
        `[dial] answered after ${elapsed}ms (attempt=${attempt}); speaking: "${opts.text}"`
      );
      return;
    }
    if (result.status === 422) {
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(
          `[dial] ringing... waited ${Date.now() - start}ms (attempt=${attempt})`
        );
      }
      await delay(ANSWER_POLL_MS);
      continue;
    }
    throw new Error(`telnyx speak status=${result.status} body=${result.text}`);
  }
  throw new Error(
    `timed out after ${ANSWER_TIMEOUT_MS}ms waiting for call to be answered`
  );
}

function isLocalAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const host = address.split(":")[0] ?? "";
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

const args = parseArgs();
const apiBaseUrl =
  process.env.TELNYX_API_BASE_URL ?? "https://api.telnyx.com/v2";
// SDK reads VOICE_GRPC_ADDRESS / VOICE_GRPC_TLS itself when NODE_ENV !==
// "production". --grpc and GRPC_ADDRESS here are script-level conveniences
// that are forwarded explicitly to createClient, so they work in production.
const grpcAddress = args.grpc ?? process.env.GRPC_ADDRESS;
const lightauthEndpoint = process.env.LIGHTAUTH_ENDPOINT;
if (!lightauthEndpoint) {
  console.error("LIGHTAUTH_ENDPOINT not set (load .env or export it)");
  process.exit(1);
}
const cloudExternalUrl = (
  process.env.SPECTRUM_CLOUD_EXTERNAL_URL ??
  "https://staging-spectrum-cloud.photon.codes"
).replace(/\/$/, "");

const rlIdent = createInterface({ input, output });
let cloudEndpoint: string;
let apiKey: string;
let projectId: string;
let projectSecret: string;
try {
  cloudEndpoint = await ensure(
    rlIdent,
    "SPECTRUM_CLOUD_ENDPOINT",
    "SPECTRUM_CLOUD_ENDPOINT"
  );
  apiKey = await ensure(rlIdent, "TELNYX_API_KEY", "TELNYX_API_KEY");
  projectId = args.project ?? (await promptRequired(rlIdent, "project ID"));
  projectSecret = await promptRequired(rlIdent, "project secret");
} finally {
  rlIdent.close();
}

console.log(
  `[dial] enabling voice + imessage_enabled via ${cloudExternalUrl} ...`
);
await enableVoicePlatform({ cloudExternalUrl, projectId, projectSecret });
console.log("[dial] voice platform enabled");

console.log(`[dial] minting JWT via ${lightauthEndpoint} ...`);
const accessToken = await issueJwt({ lightauthEndpoint, projectId });
console.log("[dial] JWT issued");

const lines = await fetchProjectLines(cloudEndpoint, projectId);

const rl = createInterface({ input, output });
let from: string | undefined;
let to: string;
try {
  from = args.from ?? (await pickFrom(rl, lines));
  to = args.to ?? (await rl.question("to (E.164): ")).trim();
} finally {
  rl.close();
}
if (!to) {
  throw new Error("to is required");
}

const speakText = args.speak ?? "Hello from Spectrum.";
const lingerSecs = args.linger ? Number.parseInt(args.linger, 10) : 8;
if (!Number.isFinite(lingerSecs) || lingerSecs < 0) {
  throw new Error(`invalid --linger: ${args.linger}`);
}
const shouldHangup = args["no-hangup"] !== "true";

console.log(
  `\n[dial] grpc=${grpcAddress ?? "<sdk default>"} project=${projectId} from=${from ?? "<server-resolved>"} to=${to}`
);

const voice = createClient({
  ...(grpcAddress ? { address: grpcAddress } : {}),
  ...(grpcAddress && isLocalAddress(grpcAddress) ? { tls: false } : {}),
  token: accessToken,
});

const call = await voice.calls.dial(to, from ? { from } : undefined);
console.log(
  `[dial] placed call_control_id=${call.callControlId} leg=${call.callLegId} session=${call.callSessionId}`
);

let hungUp = false;
const hangupViaSdk = async () => {
  try {
    await voice.calls.hangup(call.callControlId);
  } catch (err) {
    console.error("[dial] hangup failed:", err);
  }
};
process.on("SIGINT", async () => {
  if (hungUp) {
    return;
  }
  hungUp = true;
  console.log("\n[dial] SIGINT — hanging up");
  await hangupViaSdk();
  await voice.close();
  process.exit(0);
});

await waitForAnswerAndSpeak({
  apiBaseUrl,
  apiKey,
  callControlId: call.callControlId,
  text: speakText,
});

if (lingerSecs > 0) {
  console.log(`[dial] lingering ${lingerSecs}s before hangup`);
  await delay(lingerSecs * 1000);
}

if (shouldHangup && !hungUp) {
  hungUp = true;
  await hangupViaSdk();
  console.log("[dial] hangup ok");
}

await voice.close();
