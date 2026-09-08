// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Handled step failure scenario for OTel requirement otel-invocation-8. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "handled-failure",
  async (_event, context) => {
    try {
      await context.step(
        "otel-handled-failure",
        async () => {
          throw new Error("Intentional handled failure");
        },
        { retryStrategy: () => ({ shouldRetry: false }) },
      );
    } catch {
      // Continue into the recovery step after recording the failed operation.
    }
    return context.step("otel-recovery-step", async () => "recovered");
  },
);
