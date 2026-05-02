/**
 * Unit tests for nice-grpc client middleware:
 * - authMiddleware (covers the access_token contract)
 * - retryMiddleware
 * - timeoutMiddleware
 * - trailingMetadataCaptureMiddleware
 */

import { describe, expect, it } from "bun:test";
import {
  type CallOptions,
  ClientError,
  Metadata,
  Status,
} from "nice-grpc-common";
import {
  authMiddleware,
  retryMiddleware,
  timeoutMiddleware,
  trailingMetadataCaptureMiddleware,
} from "../../src/transport/metadata.ts";
import type { RetryOptions } from "../../src/types/common.ts";

interface MockMethodDescriptor {
  options: Record<string, unknown>;
  path: string;
  requestStream: boolean;
  responseStream: boolean;
}

const UNARY_METHOD: MockMethodDescriptor = {
  path: "/test.Service/Unary",
  requestStream: false,
  responseStream: false,
  options: {},
};

const SERVER_STREAM_METHOD: MockMethodDescriptor = {
  path: "/test.Service/ServerStream",
  requestStream: false,
  responseStream: true,
  options: {},
};

function buildCall<Req, Res>(
  method: MockMethodDescriptor,
  request: Req,
  handler: (req: Req, opts: CallOptions) => Promise<Res>
) {
  // biome-ignore lint/correctness/useYield: simulates nice-grpc async generator interface
  async function* nextFn(
    req: Req | AsyncIterable<Req>,
    opts: CallOptions
  ): AsyncGenerator<never, Res, undefined> {
    return await handler(req as Req, opts);
  }

  return {
    method,
    request,
    requestStream: method.requestStream,
    responseStream: method.responseStream,
    next: nextFn,
  };
}

async function drain<T>(
  gen: AsyncGenerator<T, T | undefined, undefined>
): Promise<T> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value as T;
}

function errorWithMetadata(
  code: number,
  details: string,
  meta: Record<string, string>
): ClientError {
  const err = new ClientError("/test.Service/Unary", code, details);
  Object.defineProperty(err, "metadata", {
    value: {
      get(key: string): unknown[] {
        return key in meta ? [meta[key]] : [];
      },
    },
    writable: true,
    configurable: true,
  });
  return err;
}

describe("authMiddleware", () => {
  it("sets the access_token metadata key with no Bearer prefix", async () => {
    const mw = authMiddleware("my-jwt");

    let captured: Metadata | undefined;
    const handler = async (_req: unknown, opts: CallOptions) => {
      captured = opts.metadata as Metadata;
      return "ok";
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});
    await drain(gen);

    expect(captured).toBeDefined();
    expect(captured?.get("access_token")).toBe("my-jwt");
    // Critical: must NOT use the standard Bearer/authorization scheme.
    expect(captured?.get("authorization")).toBeUndefined();
  });

  it("resolves async token providers per call", async () => {
    let n = 0;
    const mw = authMiddleware(() => Promise.resolve(`token-${++n}`));

    const captured: string[] = [];
    const handler = async (_req: unknown, opts: CallOptions) => {
      captured.push((opts.metadata as Metadata).get("access_token") ?? "");
      return "ok";
    };

    const call1 = buildCall(UNARY_METHOD, {}, handler);
    await drain(mw(call1 as any, {}));
    const call2 = buildCall(UNARY_METHOD, {}, handler);
    await drain(mw(call2 as any, {}));

    expect(captured).toEqual(["token-1", "token-2"]);
  });
});

describe("trailingMetadataCaptureMiddleware", () => {
  it("attaches trailing metadata to errors", async () => {
    const mw = trailingMetadataCaptureMiddleware();

    const handler = async (_req: unknown, opts: CallOptions) => {
      const trailer = Metadata();
      trailer.set("error-code", "callNotFound");
      trailer.set("x-retryable", "true");
      opts.onTrailer?.(trailer);
      throw new ClientError(
        "/test.Service/Unary",
        Status.NOT_FOUND,
        "call not found"
      );
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});

    try {
      await drain(gen);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ClientError);
      expect(err.metadata).toBeDefined();
      expect(err.metadata.get("error-code")).toEqual(["callNotFound"]);
      expect(err.metadata.get("x-retryable")).toEqual(["true"]);
      expect(err.metadata.get("nonexistent")).toEqual([]);
    }
  });

  it("preserves original onTrailer callback", async () => {
    const mw = trailingMetadataCaptureMiddleware();
    let callerTrailer: any;

    const handler = async (_req: unknown, opts: CallOptions) => {
      const trailer = Metadata();
      trailer.set("error-code", "timeout");
      opts.onTrailer?.(trailer);
      throw new ClientError(
        "/test.Service/Unary",
        Status.DEADLINE_EXCEEDED,
        "timeout"
      );
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {
      onTrailer(t) {
        callerTrailer = t;
      },
    });

    try {
      await drain(gen);
    } catch {
      // expected
    }

    expect(callerTrailer).toBeDefined();
    expect(callerTrailer.get("error-code")).toBe("timeout");
  });

  it("passes through on success without modifying response", async () => {
    const mw = trailingMetadataCaptureMiddleware();
    const handler = async () => "ok";
    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});
    const result = await drain(gen);
    expect(result).toBe("ok");
  });
});

describe("retryMiddleware", () => {
  it("retries on x-retryable errors up to maxAttempts", async () => {
    const opts: RetryOptions = { maxAttempts: 3, initialDelay: 1, maxDelay: 1 };
    const mw = retryMiddleware(opts);

    let attempts = 0;
    const handler = async () => {
      attempts++;
      if (attempts < 3) {
        throw errorWithMetadata(Status.UNAVAILABLE, "unavailable", {
          "x-retryable": "true",
        });
      }
      return "success";
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});
    const result = await drain(gen);

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    const opts: RetryOptions = { maxAttempts: 3, initialDelay: 1, maxDelay: 1 };
    const mw = retryMiddleware(opts);

    let attempts = 0;
    const handler = async () => {
      attempts++;
      throw errorWithMetadata(Status.NOT_FOUND, "not found", {});
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});

    try {
      await drain(gen);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ClientError);
      expect(err.details).toBe("not found");
    }

    expect(attempts).toBe(1);
  });

  it("throws after exhausting all attempts", async () => {
    const opts: RetryOptions = { maxAttempts: 2, initialDelay: 1, maxDelay: 1 };
    const mw = retryMiddleware(opts);

    let attempts = 0;
    const handler = async () => {
      attempts++;
      throw errorWithMetadata(Status.UNAVAILABLE, `fail ${attempts}`, {
        "x-retryable": "true",
      });
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});

    try {
      await drain(gen);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.details).toBe("fail 2");
    }

    expect(attempts).toBe(2);
  });

  it("skips retry for streaming calls", async () => {
    const opts: RetryOptions = { maxAttempts: 3, initialDelay: 1, maxDelay: 1 };
    const mw = retryMiddleware(opts);

    let attempts = 0;
    const handler = async () => {
      attempts++;
      throw errorWithMetadata(Status.UNAVAILABLE, "unavailable", {
        "x-retryable": "true",
      });
    };

    const call = buildCall(SERVER_STREAM_METHOD, {}, handler);
    const gen = mw(call as any, {});

    try {
      await drain(gen);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.details).toBe("unavailable");
    }

    expect(attempts).toBe(1);
  });

  it("uses default options when none provided", () => {
    const mw = retryMiddleware();
    expect(mw).toBeFunction();
  });
});

describe("timeoutMiddleware", () => {
  it("sets AbortSignal.timeout on calls without existing signal", async () => {
    const mw = timeoutMiddleware(5000);

    let receivedSignal: AbortSignal | undefined;
    const handler = async (_req: unknown, opts: CallOptions) => {
      receivedSignal = opts.signal;
      return "ok";
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, {});
    const result = await drain(gen);

    expect(result).toBe("ok");
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it("skips streaming calls", async () => {
    const mw = timeoutMiddleware(5000);

    let receivedSignal: AbortSignal | undefined;
    const handler = async (_req: unknown, opts: CallOptions) => {
      receivedSignal = opts.signal;
      return "ok";
    };

    const call = buildCall(SERVER_STREAM_METHOD, {}, handler);
    const gen = mw(call as any, {});
    const result = await drain(gen);

    expect(result).toBe("ok");
    expect(receivedSignal).toBeUndefined();
  });

  it("combines with existing caller signal", async () => {
    const mw = timeoutMiddleware(5000);
    const callerAbort = new AbortController();

    let receivedSignal: AbortSignal | undefined;
    const handler = async (_req: unknown, opts: CallOptions) => {
      receivedSignal = opts.signal;
      return "ok";
    };

    const call = buildCall(UNARY_METHOD, {}, handler);
    const gen = mw(call as any, { signal: callerAbort.signal });
    await drain(gen);

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).not.toBe(callerAbort.signal);
    expect(receivedSignal?.aborted).toBe(false);

    callerAbort.abort();
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe("trailingMetadataCapture + retry integration", () => {
  it("retry reads x-retryable from captured trailing metadata", async () => {
    const captureMw = trailingMetadataCaptureMiddleware();
    const retryMw = retryMiddleware({
      maxAttempts: 3,
      initialDelay: 1,
      maxDelay: 1,
    });

    let attempts = 0;

    const handler = async (_req: unknown, opts: CallOptions) => {
      attempts++;
      const trailer = Metadata();
      if (attempts < 3) {
        trailer.set("x-retryable", "true");
        trailer.set("error-code", "serviceUnavailable");
      } else {
        trailer.set("error-code", "ok");
      }
      opts.onTrailer?.(trailer);

      if (attempts < 3) {
        throw new ClientError(
          "/test.Service/Unary",
          Status.UNAVAILABLE,
          "unavailable"
        );
      }
      return "success";
    };

    const innerCall = buildCall(UNARY_METHOD, {}, handler);
    const captureGen = (_req: unknown, opts: CallOptions) =>
      captureMw(innerCall as any, opts);

    const outerCall = {
      method: UNARY_METHOD,
      request: {},
      requestStream: false,
      responseStream: false,
      next: captureGen as any,
    };

    const gen = retryMw(outerCall as any, {});
    const result = await drain(gen);

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });
});
