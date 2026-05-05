/**
 * Tests for the VOICE_GRPC_ADDRESS / VOICE_GRPC_TLS env override.
 *
 * The override is honored only when NODE_ENV !== "production". In production
 * the env vars are ignored to prevent accidental endpoint redirection in
 * deployed services.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_ADDRESS,
  resolveAddress,
  resolveTls,
} from "../../src/client.ts";

const ADDR_KEY = "VOICE_GRPC_ADDRESS";
const TLS_KEY = "VOICE_GRPC_TLS";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ADDR = process.env[ADDR_KEY];
const ORIGINAL_TLS = process.env[TLS_KEY];

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("resolveAddress", () => {
  beforeEach(() => {
    delete process.env[ADDR_KEY];
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    restore("NODE_ENV", ORIGINAL_NODE_ENV);
    restore(ADDR_KEY, ORIGINAL_ADDR);
  });

  it("returns DEFAULT_ADDRESS when nothing is supplied", () => {
    expect(resolveAddress(undefined)).toBe(DEFAULT_ADDRESS);
  });

  it("returns the explicit address when env is unset", () => {
    expect(resolveAddress("localhost:50051")).toBe("localhost:50051");
  });

  it("env override wins over explicit in non-production", () => {
    process.env[ADDR_KEY] = "staging.example:443";
    expect(resolveAddress("localhost:50051")).toBe("staging.example:443");
  });

  it("env override wins over default in non-production", () => {
    process.env[ADDR_KEY] = "staging.example:443";
    expect(resolveAddress(undefined)).toBe("staging.example:443");
  });

  it("env override is IGNORED in production", () => {
    process.env.NODE_ENV = "production";
    process.env[ADDR_KEY] = "staging.example:443";
    expect(resolveAddress("prod.example:443")).toBe("prod.example:443");
    expect(resolveAddress(undefined)).toBe(DEFAULT_ADDRESS);
  });

  it("empty env value falls through to explicit/default", () => {
    process.env[ADDR_KEY] = "";
    expect(resolveAddress("explicit:1")).toBe("explicit:1");
    expect(resolveAddress(undefined)).toBe(DEFAULT_ADDRESS);
  });
});

describe("resolveTls", () => {
  beforeEach(() => {
    delete process.env[TLS_KEY];
    process.env.NODE_ENV = "test";
  });
  afterEach(() => {
    restore("NODE_ENV", ORIGINAL_NODE_ENV);
    restore(TLS_KEY, ORIGINAL_TLS);
  });

  it("defaults to true when nothing is supplied", () => {
    expect(resolveTls(undefined)).toBe(true);
  });

  it("returns the explicit option when env is unset", () => {
    expect(resolveTls(false)).toBe(false);
    expect(resolveTls(true)).toBe(true);
  });

  it("env=false disables TLS in non-production", () => {
    process.env[TLS_KEY] = "false";
    expect(resolveTls(true)).toBe(false);
    process.env[TLS_KEY] = "0";
    expect(resolveTls(true)).toBe(false);
    process.env[TLS_KEY] = "FALSE";
    expect(resolveTls(true)).toBe(false);
  });

  it("env=true enables TLS in non-production", () => {
    process.env[TLS_KEY] = "true";
    expect(resolveTls(false)).toBe(true);
    process.env[TLS_KEY] = "1";
    expect(resolveTls(false)).toBe(true);
  });

  it("env override is IGNORED in production", () => {
    process.env.NODE_ENV = "production";
    process.env[TLS_KEY] = "false";
    expect(resolveTls(true)).toBe(true);
    expect(resolveTls(undefined)).toBe(true);
  });

  it("unrecognized env value falls through to explicit/default", () => {
    process.env[TLS_KEY] = "yes";
    expect(resolveTls(false)).toBe(false);
    expect(resolveTls(undefined)).toBe(true);
  });
});
