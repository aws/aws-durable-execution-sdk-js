// An order workflow: load the order, wait for a person to approve it, reserve stock for
// each line item, wait out a cooling-off period, then charge the customer through a
// separate payment function.
//
// test/example.test.js runs this workflow with runDurable.

import { withDurableExecution } from "@aws/durable-execution-sdk-js-lite";

// The payment function is another durable function. Durable functions are invoked by a
// qualified name: a version, an alias or $LATEST.
export const PAYMENT_FUNCTION =
  process.env.PAYMENT_FUNCTION ?? "payment-service:live";

// The JSDoc type lets an editor check the workflow against the SDK types.
/** @type {import("@aws/durable-execution-sdk-js-lite").DurableHandler<{ orderId: string }>} */
export const workflow = async ({ event, ctx }) => {
  // I/O runs inside a step. A completed step returns its stored result on replay.
  const order = await ctx.step({
    name: "load-order",
    fn: () => loadOrder(event.orderId),
  });

  // The callback result is the raw string the approver sent. It is undefined if the
  // approver sent no result.
  const answer = await ctx.waitForCallback({
    name: "approval",
    timeoutSeconds: 24 * 60 * 60,
    submitter: ({ callbackId, logger }) =>
      requestApproval({ orderId: order.id, callbackId, logger }),
  });
  const { approved, approver } = JSON.parse(answer ?? "{}");
  if (!approved) return { orderId: order.id, status: "REJECTED" };

  // Each line item runs in its own child context. Use the item ctx inside fn.
  const reservations = await ctx.map({
    name: "reserve-stock",
    items: order.lines,
    maxConcurrency: 2,
    itemName: ({ item }) => `reserve-${item.sku}`,
    fn: ({ ctx: itemCtx, item }) =>
      itemCtx.step({ name: "reserve", fn: () => reserveStock(item) }),
  });
  // By default map stops at the first failed item. throwIfError then fails the workflow
  // with that item's error.
  reservations.throwIfError();

  await ctx.wait({ name: "cooling-off", seconds: 60 * 60 });

  // The amount is computed from step results, so it is the same in every invocation.
  const amount = order.lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const payment = await ctx.invoke({
    name: "charge",
    functionName: PAYMENT_FUNCTION,
    input: { orderId: order.id, amount },
  });

  return {
    orderId: order.id,
    status: "CONFIRMED",
    approver,
    reservations: reservations.getResults(),
    payment,
  };
};

export const handler = withDurableExecution(workflow);

// Stand-ins for real calls to a database, a notification service and a stock service.

async function loadOrder(orderId) {
  return {
    id: orderId,
    lines: [
      { sku: "book", quantity: 2, price: 15 },
      { sku: "lamp", quantity: 1, price: 40 },
      { sku: "pen", quantity: 10, price: 1 },
    ],
  };
}

async function requestApproval({ orderId, callbackId, logger }) {
  // A real system sends callbackId to the approver. The approver's system then calls
  // the Lambda API SendDurableExecutionCallbackSuccess with callbackId and the answer.
  logger.info("approval requested", { orderId, callbackId });
}

async function reserveStock({ sku, quantity }) {
  return { sku, quantity, reservationId: `r-${sku}` };
}
