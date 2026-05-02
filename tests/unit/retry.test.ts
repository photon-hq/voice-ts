/**
 * Unit tests for the withRetry utility function.
 */

import { describe, expect, it } from "bun:test";
import { VoiceError } from "../../src/errors/voice-error.ts";
import { withRetry } from "../../src/utils/retry.ts";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries retryable VoiceError up to maxAttempts", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new VoiceError("transient", {
            code: "serviceUnavailable" as any,
            retryable: true,
            grpcCode: 14,
          });
        }
        return "recovered";
      },
      { maxAttempts: 4, initialDelay: 1, maxDelay: 1 }
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("does not retry non-retryable VoiceError", async () => {
    let calls = 0;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new VoiceError("permanent", {
            code: "callNotFound" as any,
            retryable: false,
            grpcCode: 5,
          });
        },
        { maxAttempts: 3, initialDelay: 1, maxDelay: 1 }
      );
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(VoiceError);
      expect(err.message).toBe("permanent");
    }
    expect(calls).toBe(1);
  });

  it("does not retry non-VoiceError errors", async () => {
    let calls = 0;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new Error("generic");
        },
        { maxAttempts: 3, initialDelay: 1, maxDelay: 1 }
      );
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("generic");
    }
    expect(calls).toBe(1);
  });

  it("throws after exhausting all attempts", async () => {
    let calls = 0;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new VoiceError(`fail ${calls}`, {
            code: "serviceUnavailable" as any,
            retryable: true,
            grpcCode: 14,
          });
        },
        { maxAttempts: 2, initialDelay: 1, maxDelay: 1 }
      );
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("fail 2");
    }
    expect(calls).toBe(2);
  });

  it("aborts early when signal is aborted", async () => {
    const controller = new AbortController();
    let calls = 0;

    try {
      await withRetry(
        async () => {
          calls++;
          controller.abort();
          throw new VoiceError("transient", {
            code: "serviceUnavailable" as any,
            retryable: true,
            grpcCode: 14,
          });
        },
        {
          maxAttempts: 5,
          initialDelay: 1,
          maxDelay: 1,
          signal: controller.signal,
        }
      );
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(VoiceError);
    }
    expect(calls).toBe(1);
  });

  it("uses default options when none provided", async () => {
    const result = await withRetry(async () => "ok");
    expect(result).toBe("ok");
  });
});
