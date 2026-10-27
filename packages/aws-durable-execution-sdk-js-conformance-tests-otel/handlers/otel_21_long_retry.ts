// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Long retry delay for OTel requirement otel-long-running-2. */

import { createScenarioHandler, longDelaySeconds } from "./common";

export const handler = createScenarioHandler(
  "long-retry",
  async (event, context) =>
    context.step(
      "otel-long-retry",
      async (stepContext) => {
        if (stepContext.attempt === 1) {
          throw new Error("Intentional first-attempt failure");
        }
        return "retried";
      },
      {
        retryStrategy: (_error, attempt) =>
          attempt < 2
            ? {
                shouldRetry: true,
                delay: { seconds: longDelaySeconds(event) },
              }
            : { shouldRetry: false },
      },
    ),
);
