// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Check the remaining callbacks covered by the SDK's user-function scopes. */

import { withRetry } from "@aws/durable-execution-sdk-js";
import { createScenarioHandler, recordUserFunctionSpan } from "./common";

export const handler = createScenarioHandler(
  "callback-function-context",
  async (_event, durable) => {
    await durable.step(
      "otel-context-retry-step",
      async (step) => {
        recordUserFunctionSpan(`retry-attempt-${step.attempt}`);
        if (step.attempt === 1) throw new Error("intentional-step-retry");
        return "retried";
      },
      {
        retryStrategy: (_error, attempt) => ({
          shouldRetry: attempt < 2,
          delay: { seconds: 1 },
        }),
      },
    );
    await durable.waitForCondition(
      "otel-context-condition",
      async (state: number) => {
        recordUserFunctionSpan(`condition-check-${state + 1}`);
        return state + 1;
      },
      {
        initialState: 0,
        waitStrategy: (state) => ({
          shouldContinue: state < 2,
          delay: { seconds: 1 },
        }),
      },
    );
    await durable.waitForCallback("otel-context-callback", async () => {
      recordUserFunctionSpan("callback-submitter");
    });
    try {
      await withRetry(
        durable,
        "otel-context-with-retry",
        async () => {
          recordUserFunctionSpan("with-retry-body");
          throw new Error("intentional-helper-failure");
        },
        {
          retryStrategy: () => {
            recordUserFunctionSpan("with-retry-strategy");
            return { shouldRetry: false };
          },
        },
      );
      throw new Error("Expected the retry helper to fail");
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      if (
        !(cause instanceof Error) ||
        cause.message !== "intentional-helper-failure"
      ) {
        throw error;
      }
    }
    await durable.runInChildContext(
      "otel-context-virtual",
      async () => {
        recordUserFunctionSpan("virtual-child");
        return "virtual";
      },
      { virtualContext: true },
    );
    return "callback-context-complete";
  },
);
