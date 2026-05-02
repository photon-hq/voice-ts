/**
 * CallsResource -- wraps `CallService` (every RPC except media-plane operations).
 *
 * Each method maps SDK arguments to the proto request, awaits the gRPC call,
 * normalises the response through the mapper, and converts any gRPC error
 * into a typed {@link VoiceError} subclass.
 */

import { fromGrpcError } from "../errors/error-handler.ts";
import { TypedEventStream } from "../streaming/event-stream.ts";
import type { CallServiceClient } from "../transport/grpc-client.ts";
import {
  mapCallEvent,
  mapDialResponse,
  mapMissedEvent,
  toProtoRejectCause,
} from "../transport/mapper.ts";
import type { CallControlId, StreamCursor } from "../types/branded.ts";
import type {
  AnswerOptions,
  Call,
  DialOptions,
  SendDtmfOptions,
  TransferOptions,
} from "../types/calls.ts";
import type { RejectCause } from "../types/enums.ts";
import type { CallEvent } from "../types/events.ts";

export class CallsResource {
  private readonly _client: CallServiceClient;

  constructor(client: CallServiceClient) {
    this._client = client;
  }

  /**
   * Place an outbound call.
   *
   * @param to E.164 destination number.
   *
   * NOTE: Dial is not idempotent on the server. If you enable
   * `retry` on the client, a transient `UNAVAILABLE` may cause the same call
   * to be placed twice. Prefer leaving `retry` disabled for calls that must
   * not be duplicated, or implement caller-side dedup via `client_state`.
   */
  async dial(to: string, options?: DialOptions): Promise<Call> {
    try {
      const response = await this._client.dial({
        to,
        clientState: options?.clientState,
        timeoutSecs: options?.timeoutSecs,
        answeringMachineDetection: options?.answeringMachineDetection,
        from: options?.from,
      });
      return mapDialResponse(response);
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /** Answer an inbound call. */
  async answer(
    callControlId: CallControlId,
    options?: AnswerOptions
  ): Promise<void> {
    try {
      await this._client.answer({
        callControlId,
        clientState: options?.clientState,
      });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /** Hang up a call. */
  async hangup(callControlId: CallControlId): Promise<void> {
    try {
      await this._client.hangup({ callControlId });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /** Reject an inbound call before answering. */
  async reject(
    callControlId: CallControlId,
    cause: RejectCause
  ): Promise<void> {
    try {
      await this._client.reject({
        callControlId,
        cause: toProtoRejectCause(cause),
      });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /** Bridge two existing calls together. */
  async bridge(
    callControlId: CallControlId,
    otherCallControlId: CallControlId
  ): Promise<void> {
    try {
      await this._client.bridge({ callControlId, otherCallControlId });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /**
   * Transfer an answered call to another destination.
   *
   * @param to E.164 destination.
   */
  async transfer(
    callControlId: CallControlId,
    to: string,
    options?: TransferOptions
  ): Promise<void> {
    try {
      await this._client.transfer({
        callControlId,
        to,
        clientState: options?.clientState,
      });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /**
   * Send DTMF digits on an active call.
   *
   * @param digits A string of digits (`0-9`, `*`, `#`, `A-D`).
   */
  async sendDtmf(
    callControlId: CallControlId,
    digits: string,
    options?: SendDtmfOptions
  ): Promise<void> {
    try {
      await this._client.sendDTMF({
        callControlId,
        digits,
        durationMillis: options?.durationMillis,
      });
    } catch (err) {
      throw fromGrpcError(err);
    }
  }

  /** Subscribe to all call events for the authenticated project. */
  subscribe(): TypedEventStream<CallEvent>;
  /**
   * Subscribe to a specific type of call event. The returned stream is
   * narrowed to only that event type.
   */
  subscribe<T extends CallEvent["type"]>(
    type: T
  ): TypedEventStream<Extract<CallEvent, { type: T }>>;
  subscribe(type?: CallEvent["type"]): TypedEventStream<CallEvent> {
    const rpcStream = this._client.subscribeEvents({});

    async function* mapEvents(): AsyncGenerator<CallEvent> {
      try {
        for await (const proto of rpcStream) {
          const event = mapCallEvent(proto);
          if (event !== null) {
            yield event;
          }
        }
      } catch (err) {
        throw fromGrpcError(err);
      }
    }

    const stream = new TypedEventStream<CallEvent>(mapEvents());

    if (type) {
      return stream.filter(
        (e): e is Extract<CallEvent, { type: typeof type }> => e.type === type
      );
    }

    return stream;
  }

  /**
   * Catch up on events missed during a disconnect.
   *
   * Pass the cursor from the last event you processed before the
   * disconnection. The server returns up to `limit` events that occurred
   * after that cursor.
   */
  async fetchMissed(
    cursor: StreamCursor,
    options?: { readonly limit?: number }
  ): Promise<readonly CallEvent[]> {
    try {
      const response = await this._client.fetchMissedEvents({
        cursor: { value: cursor },
        limit: options?.limit,
      });
      const events: CallEvent[] = [];
      for (const proto of response.events) {
        const event = mapMissedEvent(proto);
        if (event !== null) {
          events.push(event);
        }
      }
      return events;
    } catch (err) {
      throw fromGrpcError(err);
    }
  }
}
