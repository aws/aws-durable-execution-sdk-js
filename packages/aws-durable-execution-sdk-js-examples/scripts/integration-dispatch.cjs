"use strict";
/**
 * The handler of each grouped integration test function. One function serves
 * the examples of one folder (see example-groups.mjs).
 *
 * The test runner sends { __example, __payload } in place of the payload.
 * This handler puts the original payload back and calls the named example.
 * A durable function receives the payload inside the EXECUTION operation of
 * InitialExecutionState, and it receives it again on every replay. A function
 * with no durable config receives the payload as the event.
 */

const EXAMPLE_NAME = /^[a-z0-9-]+$/;

/**
 * @param {any} wrapped
 * @returns {{ example: string, payload: unknown }}
 */
function unwrap(wrapped) {
  const example = wrapped?.__example;
  if (typeof example !== "string" || !EXAMPLE_NAME.test(example)) {
    throw new Error(
      "Grouped integration function needs { __example, __payload } as its payload",
    );
  }
  return { example, payload: wrapped.__payload };
}

/**
 * The example to run, and the event with the original payload put back.
 * @param {any} event
 * @returns {{ example: string, event: any }}
 */
function unwrapEvent(event) {
  const execution = event?.InitialExecutionState?.Operations?.find(
    (/** @type {any} */ operation) => operation.Type === "EXECUTION",
  );
  if (!execution) {
    const { example, payload } = unwrap(event);
    return { example, event: payload ?? {} };
  }

  const { example, payload } = unwrap(
    JSON.parse(execution.ExecutionDetails?.InputPayload ?? "{}"),
  );
  // The SDK reads a missing InputPayload as {}.
  execution.ExecutionDetails.InputPayload =
    payload === undefined ? undefined : JSON.stringify(payload);
  return { example, event };
}

exports.unwrapEvent = unwrapEvent;

exports.handler = async (
  /** @type {any} */ event,
  /** @type {any} */ context,
) => {
  const unwrapped = unwrapEvent(event);
  return require(`./${unwrapped.example}.js`).handler(unwrapped.event, context);
};
