import { describe, expect, it } from "bun:test";
import { ClientError, Metadata, Status } from "nice-grpc-common";
import { fromGrpcError } from "../../src/errors/error-handler.ts";
import {
  ConnectionError,
  NotFoundError,
  ValidationError,
  VoiceError,
} from "../../src/errors/voice-error.ts";

function clientError(code: Status, details: string): ClientError {
  return new ClientError("/photon.voice.v1.CallService/Dial", code, details);
}

function clientErrorWithMetadata(
  code: Status,
  details: string,
  metadata: Record<string, string>
): ClientError {
  const error = clientError(code, details);
  const trailer = Metadata();
  for (const [key, value] of Object.entries(metadata)) {
    trailer.set(key, value);
  }
  Object.defineProperty(error, "metadata", {
    value: {
      get(key: string): unknown[] {
        const value = trailer.get(key);
        return value === undefined ? [] : [value];
      },
    },
    writable: true,
    configurable: true,
  });
  return error;
}

describe("fromGrpcError", () => {
  it("uses server error-code metadata when present", () => {
    const error = fromGrpcError(
      clientErrorWithMetadata(Status.NOT_FOUND, "line missing", {
        "error-code": "lineNotFound",
      })
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.code).toBe("lineNotFound");
  });

  it("falls back from NOT_FOUND status to a notFound code", () => {
    const error = fromGrpcError(
      clientError(Status.NOT_FOUND, "no shared user record")
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.code).toBe("notFound");
  });

  it("falls back from FAILED_PRECONDITION to preconditionFailed", () => {
    const error = fromGrpcError(
      clientError(Status.FAILED_PRECONDITION, "stream already attached")
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe("preconditionFailed");
  });

  it("falls back from UNAVAILABLE to serviceUnavailable", () => {
    const error = fromGrpcError(
      clientError(Status.UNAVAILABLE, "upstream down")
    );

    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.code).toBe("serviceUnavailable");
  });

  it("keeps internalError for unknown non-gRPC failures", () => {
    const error = fromGrpcError(new Error("boom"));

    expect(error).toBeInstanceOf(VoiceError);
    expect(error.code).toBe("internalError");
  });
});
