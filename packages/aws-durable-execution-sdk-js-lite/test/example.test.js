import assert from "node:assert/strict";
import { test } from "node:test";
import { runDurable } from "./helpers/run-durable.js";
import {
  handler,
  PAYMENT_FUNCTION,
  workflow,
} from "../examples/order-workflow.js";

const approve = () => ({
  result: JSON.stringify({ approved: true, approver: "alice" }),
});

test("the order example confirms an approved order", async (t) => {
  // The submitter logs the approval request. Keep the test output clean.
  const info = t.mock.method(console, "info", () => {});
  const charges = [];
  const run = await runDurable({
    workflow,
    input: { orderId: "o-1" },
    onCallback: approve,
    functions: {
      [PAYMENT_FUNCTION]: ({ input }) => {
        charges.push(input);
        return { paymentId: "p-1" };
      },
    },
  });

  assert.equal(run.status, "SUCCEEDED", JSON.stringify(run.error));
  assert.deepEqual(run.result, {
    orderId: "o-1",
    status: "CONFIRMED",
    approver: "alice",
    reservations: [
      { sku: "book", quantity: 2, reservationId: "r-book" },
      { sku: "lamp", quantity: 1, reservationId: "r-lamp" },
      { sku: "pen", quantity: 10, reservationId: "r-pen" },
    ],
    payment: { paymentId: "p-1" },
  });
  assert.deepEqual(charges, [{ orderId: "o-1", amount: 80 }]);
  // The submitter ran once, although the workflow ran in several invocations.
  assert.equal(info.mock.callCount(), 1);
  assert.ok(run.invocations > 1);
  assert.equal(run.getOperation("approval").Status, "SUCCEEDED");
  assert.equal(run.getOperation("reserve-lamp").SubType, "MapIteration");
  assert.equal(run.getOperation("cooling-off").Type, "WAIT");
  assert.equal(run.getOperation("charge").Type, "CHAINED_INVOKE");
  assert.equal(typeof handler, "function");
});

test("the order example stops when the approver rejects", async (t) => {
  t.mock.method(console, "info", () => {});
  const run = await runDurable({
    workflow,
    input: { orderId: "o-2" },
    onCallback: () => ({ result: JSON.stringify({ approved: false }) }),
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { orderId: "o-2", status: "REJECTED" });
  assert.equal(run.getOperation("reserve-stock"), undefined);
});
