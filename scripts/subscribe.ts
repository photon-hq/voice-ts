/**
 * Interactive smoke-test client built on @photon-ai/voice-ts.
 *
 * Mirrors spectrum-voice/scripts/subscribe.ts but uses the SDK's `createClient`
 * + typed `voice.calls.subscribe()` instead of the raw nice-grpc client.
 *
 * Prompts for a project ID + secret, enables the voice platform on Spectrum
 * Cloud's external API, mints a LightAuth JWT (sub=<projectId>), then streams
 * call events. Place a real call into the project's DID and watch them flow.
 *
 * Usage:
 *   bun run scripts/subscribe.ts
 *
 * Env (read from .env automatically):
 *   GRPC_ADDRESS                   Default: spectrum-voice-grpc.photon.codes:443
 *   LIGHTAUTH_ENDPOINT             Required. e.g. https://lightauth.photon.codes
 *   SPECTRUM_CLOUD_EXTERNAL_URL    Default: https://staging-spectrum-cloud.photon.codes
 */

import { stdin as input, stdout as output } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { type CallEvent, createClient } from "../src/index.ts";

const INBOUND_SERVICE = "codes.photon.spectrum.voice";

// SDK reads VOICE_GRPC_ADDRESS / VOICE_GRPC_TLS itself when NODE_ENV !==
// "production". GRPC_ADDRESS here is a script-level convenience that is
// forwarded explicitly to createClient, so it works in production too.
const grpcAddress = process.env.GRPC_ADDRESS;
const lightauthEndpoint = process.env.LIGHTAUTH_ENDPOINT;
if (!lightauthEndpoint) {
  console.error("LIGHTAUTH_ENDPOINT not set (load .env or export it)");
  process.exit(1);
}
const cloudExternalUrl = (
  process.env.SPECTRUM_CLOUD_EXTERNAL_URL ??
  "https://staging-spectrum-cloud.photon.codes"
).replace(/\/$/, "");

function isLocalAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const host = address.split(":")[0] ?? "";
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

async function promptRequired(rl: Interface, label: string): Promise<string> {
  const value = (await rl.question(`${label}: `)).trim();
  if (!value) {
    console.error(`${label} is required`);
    process.exit(1);
  }
  return value;
}

async function enableVoicePlatform(
  projectId: string,
  projectSecret: string
): Promise<void> {
  const auth = `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`;
  const base = `${cloudExternalUrl}/projects/${encodeURIComponent(projectId)}/platforms`;

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

  const metadata = await fetch(`${base}/voice`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ imessage_enabled: true }),
  });
  if (!metadata.ok) {
    throw new Error(
      `set voice.imessage_enabled failed: ${metadata.status} ${await metadata.text()}`
    );
  }
}

async function issueJwt(projectId: string): Promise<string> {
  const res = await fetch(`${lightauthEndpoint}/tokens/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceName: INBOUND_SERVICE,
      subject: projectId,
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

function describeEvent(event: CallEvent): string {
  switch (event.type) {
    case "call.initiated":
      return `call.initiated direction=${event.direction} from=${event.from} to=${event.to} project_did=${event.projectDid} call=${event.callControlId}`;
    case "call.answered":
      return `call.answered call=${event.callControlId}`;
    case "call.hangup":
      return `call.hangup call=${event.callControlId} cause=${event.hangupCause ?? "?"}`;
    case "call.bridged":
      return `call.bridged call=${event.callControlId} peer=${event.peerCallControlId}`;
    case "call.dtmfReceived":
      return `call.dtmfReceived call=${event.callControlId} digit=${event.digit}`;
    case "call.machine":
      return `call.machine call=${event.callControlId} result=${event.result}`;
    default:
      return "unknown event";
  }
}

const rl = createInterface({ input, output });
const projectId = await promptRequired(rl, "project ID");
const projectSecret = await promptRequired(rl, "project secret");
rl.close();

console.log(
  `[subscribe] enabling voice + imessage_enabled via ${cloudExternalUrl} ...`
);
await enableVoicePlatform(projectId, projectSecret);
console.log("[subscribe] voice platform enabled");

console.log(`[subscribe] minting JWT via ${lightauthEndpoint} ...`);
const accessToken = await issueJwt(projectId);
console.log("[subscribe] JWT issued");

const voice = createClient({
  ...(grpcAddress ? { address: grpcAddress } : {}),
  ...(grpcAddress && isLocalAddress(grpcAddress) ? { tls: false } : {}),
  token: accessToken,
});

console.log(
  `[subscribe] connected to ${grpcAddress ?? "<sdk default>"} for project=${projectId}`
);
console.log("[subscribe] place a call to the project's DID...");

const stream = voice.calls.subscribe();
process.on("SIGINT", async () => {
  console.log("\n[subscribe] SIGINT received, closing stream");
  await stream.close();
  await voice.close();
});

try {
  for await (const event of stream) {
    console.log(
      `[subscribe] cursor=${event.cursor ?? "?"} ${describeEvent(event)}`
    );
    console.log(JSON.stringify(event, null, 2));
  }
  console.log("[subscribe] stream closed");
} catch (err) {
  console.error("[subscribe] stream error", err);
  process.exit(1);
} finally {
  await voice.close();
}
