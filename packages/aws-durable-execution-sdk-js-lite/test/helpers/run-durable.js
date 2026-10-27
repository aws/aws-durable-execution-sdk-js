// The lite SDK's tests, and the plugins' tests, pass a workflow and plugins. runDurable
// takes a createHandler function instead, because the testing package does not import the
// SDK. So this wrapper builds the handler. The testing package is imported by relative
// path, because it is not linked into the workspace node_modules.
import { runDurable as run } from "../../../aws-durable-execution-sdk-js-lite-testing/src/index.js";
import { withDurableExecution } from "../../src/index.js";

export { createInMemoryService } from "../../../aws-durable-execution-sdk-js-lite-testing/src/index.js";

export const runDurable = ({ workflow, plugins, ...options }) =>
  run({
    ...options,
    createHandler: (client) =>
      withDurableExecution(workflow, { client, plugins }),
  });
