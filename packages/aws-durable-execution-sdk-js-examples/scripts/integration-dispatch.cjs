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
 *
 * A very large input (such as 6 MB) is not in InitialExecutionState. Then
 * this handler cannot find the example, so such an example sets
 * `ownFunction: true` in its config.
 */

// generate-sam-template.ts lists the examples of this function.
const GROUP_EXAMPLES = (process.env.GROUP_EXAMPLES ?? "")
  .split(",")
  .filter(Boolean);

// Load the group's examples now, in the init phase. Init runs with more CPU
// than an invocation at 128 MB. Loading the bundle in the first invocation
// took about 2.4 s there, against about 150 ms in init, and made the tests
// time out.
for (const example of GROUP_EXAMPLES) require(`./${example}.js`);

/**
 * @param {any} wrapped
 * @param {string[]} groupExamples
 * @returns {{ example: string, payload: unknown }}
 */
function unwrap(wrapped, groupExamples) {
  const example = wrapped?.__example;
  if (example === undefined) {
    throw new Error(
      "The payload has no __example, so this grouped function cannot pick an " +
        "example. createTests wraps the payload. If another example invokes " +
        "this one by function name, or its test builds its own " +
        "CloudDurableTestRunner, set ownFunction: true in its config.",
    );
  }
  if (!groupExamples.includes(example)) {
    throw new Error(
      `Example "${example}" is not in this function. Its examples are: ` +
        `${groupExamples.join(", ")}.`,
    );
  }
  return { example, payload: wrapped.__payload };
}

/**
 * The example to run, and the event with the original payload put back.
 * @param {any} event
 * @param {string[]} groupExamples the examples this function serves
 * @returns {{ example: string, event: any }}
 */
function unwrapEvent(event, groupExamples) {
  const execution = event?.InitialExecutionState?.Operations?.find(
    (/** @type {any} */ operation) => operation.Type === "EXECUTION",
  );
  if (!execution) {
    const { example, payload } = unwrap(event, groupExamples);
    return { example, event: payload ?? {} };
  }

  const { example, payload } = unwrap(
    JSON.parse(execution.ExecutionDetails?.InputPayload ?? "{}"),
    groupExamples,
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
  const unwrapped = unwrapEvent(event, GROUP_EXAMPLES);
  // The examples of a group share one log group. This line names the example
  // of each invocation, so its logs can be found by that name.
  console.log(`integration-dispatch example=${unwrapped.example}`);
  return require(`./${unwrapped.example}.js`).handler(unwrapped.event, context);
};
