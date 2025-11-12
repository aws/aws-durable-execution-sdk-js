import { noNestedDurableOperations } from "./rules/no-nested-durable-operations/no-nested-durable-operations";
import { noNonDeterministicOutsideStep } from "./rules/no-non-deterministic-outside-step/no-non-deterministic-outside-step";
import { noClosureInDurableOperations } from "./rules/no-closure-in-durable-operations/no-closure-in-durable-operations";

export = {
  rules: {
    "no-nested-durable-operations": noNestedDurableOperations,
    "no-non-deterministic-outside-step": noNonDeterministicOutsideStep,
    "no-closure-in-durable-operations": noClosureInDurableOperations,
  },
  configs: {
    recommended: {
      plugins: ["@aws/durable-functions"],
      rules: {
        "@aws/durable-functions/no-nested-durable-operations": "error",
        "@aws/durable-functions/no-non-deterministic-outside-step": "error",
        "@aws/durable-functions/no-closure-in-durable-operations": "error",
      },
    },
  },
};
