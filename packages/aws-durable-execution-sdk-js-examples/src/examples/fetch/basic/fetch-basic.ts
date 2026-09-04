import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Fetch Basic",
  description:
    "Uses context.fetch() to call HTTP endpoints as durable operations, and shows " +
    "why a non-2xx response is a result to branch on rather than a failure",
  // The FETCH operation type is not in the published Lambda service model yet, so a
  // deployed function would have its checkpoint rejected. The local test covers it.
  localOnly: true,
};

interface ReserveStockEvent {
  productId: string;
  quantity: number;
}

/**
 * Reserves stock through an inventory API, using two fetches.
 *
 * Three things worth noticing, because they differ from calling `fetch` directly:
 *
 * **No step wrapper.** A fetch is already a durable operation. The service performs the
 * request while the execution is suspended, and the response is checkpointed before the
 * workflow sees it -- so on replay the recorded response comes back and the endpoint is not
 * called twice. Wrapping it in `context.step` would be wrong anyway: durable operations
 * cannot nest.
 *
 * **A non-2xx response resolves.** A 404 or a 409 is something the endpoint chose to send,
 * so `context.fetch` hands it back like any other response and the workflow decides what it
 * means. Only a request that never completed at all -- DNS failure, connection reset,
 * timeout -- rejects, with a `FetchError`. That is the opposite of the AWS SDK's convention,
 * where a 409 throws.
 *
 * **The body is a string in both directions.** Encoding the request body is the caller's
 * decision, and the response arrives exactly as the endpoint sent it. `JSON.stringify` and
 * `JSON.parse` are deterministic, so both are replay-safe outside a step.
 */
export const handler = withDurableExecution(
  async (event: ReserveStockEvent, context: DurableContext) => {
    const availability = await context.fetch(
      "check-availability",
      `https://inventory.example.com/products/${event.productId}`,
    );

    // Resolved, not thrown -- so an unavailable product is a business outcome here rather
    // than an execution failure.
    if (!availability.ok) {
      context.logger.info("Availability lookup was rejected", {
        status: availability.status,
      });
      return {
        reserved: false,
        reason: `availability lookup returned ${availability.status}`,
      };
    }

    const product = JSON.parse(availability.body) as { inStock: number };

    if (product.inStock < event.quantity) {
      return { reserved: false, reason: "insufficient stock" };
    }

    const reservation = await context.fetch(
      "reserve-stock",
      "https://inventory.example.com/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: event.productId,
          quantity: event.quantity,
        }),
        timeout: { seconds: 30 },
      },
    );

    // A specific status carrying a specific meaning, which is only expressible because the
    // response reaches the workflow intact.
    if (reservation.status === 409) {
      return { reserved: false, reason: "already reserved" };
    }

    if (!reservation.ok) {
      throw new Error(
        `Reservation failed with ${reservation.status}: ${reservation.body}`,
      );
    }

    const created = JSON.parse(reservation.body) as { id: string };
    return { reserved: true, reservationId: created.id };
  },
);
