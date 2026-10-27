// The tests pass a workflow and plugins. This wrapper builds the handler that runDurable
// needs. The lite SDK is imported by relative path, because it is not linked into the
// workspace node_modules. Only the tests import it. src never does.
import { withDurableExecution } from "../../aws-durable-execution-sdk-js-lite/src/index.js";
import { runDurable as run } from "../src/index.js";

export {
  createRetryStrategy,
  withDurableExecution,
} from "../../aws-durable-execution-sdk-js-lite/src/index.js";

export const runDurable = ({ workflow, plugins, ...options }) =>
  run({
    ...options,
    createHandler: (client) =>
      withDurableExecution(workflow, { client, plugins }),
  });
