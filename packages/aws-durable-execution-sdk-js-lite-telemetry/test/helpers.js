// Shared test helpers. The lite SDK is imported by relative path, because it is not
// installed in node_modules.

export {
  createInMemoryService,
  runDurable,
} from "../../aws-durable-execution-sdk-js-lite/src/testing/index.js";
export { createRetryStrategy } from "../../aws-durable-execution-sdk-js-lite/src/index.js";

// The ARN of the in-memory service.
export const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST/durable-execution/local/run";

// The in-memory service starts its clock at this time, in epoch seconds.
export const START_SECONDS = 1_700_000_000;

// An exporter that keeps every record it receives.
export function fakeExporter(extra = {}) {
  const records = [];
  return {
    records,
    async export(record) {
      records.push(structuredClone(record));
    },
    ...extra,
  };
}

// A client with send(command) that records each command. respond(command) returns the
// response or throws.
export function fakeClient(respond = () => ({})) {
  const commands = [];
  return {
    commands,
    async send(command) {
      commands.push(command);
      return respond(command);
    },
  };
}
