import { noNestedDurableOperations } from "./rules/no-nested-durable-operations";
import { noNonDeterministicOutsideStep } from "./rules/no-non-deterministic-outside-step";

export = {
  rules: {
    "no-nested-durable-operations": noNestedDurableOperations,
    "no-non-deterministic-outside-step": noNonDeterministicOutsideStep,
  },
  configs: {
    recommended: {
      plugins: ["@amzn/durable-functions"],
      rules: {
        "@amzn/durable-functions/no-nested-durable-operations": "error",
        "@amzn/durable-functions/no-non-deterministic-outside-step": "error",
      },
    },
  },
};
