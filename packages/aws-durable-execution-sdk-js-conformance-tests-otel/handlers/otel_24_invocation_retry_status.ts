// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Trigger a real invocation retry through the public serializer contract. */

import { defaultSerdes, StepSemantics } from "@aws/durable-execution-sdk-js";
import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "invocation-retry-status",
  async (_event, durable) => {
    await durable.step("otel-before-invocation-retry", async () => "saved");
    // At-most-once START is persisted before this body. A serializer failure
    // ends the invocation; recovery observes the interrupted attempt and uses
    // the normal step retry policy to start attempt 2. No warm-process marker,
    // checkpoint edits, private SDK errors, or fabricated plugin hooks are used.
    await durable.step(
      "otel-retry-serialization",
      async (step) => step.attempt,
      {
        semantics: StepSemantics.AtMostOncePerRetry,
        retryStrategy: (_error, attempt) => ({
          shouldRetry: attempt < 2,
          delay: { seconds: 1 },
        }),
        serdes: {
          serialize(value, context) {
            if (value === 1) throw new Error("intentional-invocation-retry");
            return defaultSerdes.serialize(value, context);
          },
          async deserialize(value, context) {
            const decoded = await defaultSerdes.deserialize(value, context);
            if (typeof decoded !== "number") {
              throw new Error("Expected the persisted step attempt number");
            }
            return decoded;
          },
        },
      },
    );
    return "retry-complete";
  },
);
