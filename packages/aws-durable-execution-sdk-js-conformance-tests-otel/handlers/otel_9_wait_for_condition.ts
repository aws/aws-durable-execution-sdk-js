// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Wait-for-condition scenario for OTel requirement otel-invocation-9. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-for-condition",
  async (_event, context) =>
    context.waitForCondition(
      "otel-condition",
      async (state: number) => state + 1,
      {
        initialState: 0,
        waitStrategy: (state) =>
          state >= 2
            ? { shouldContinue: false }
            : { shouldContinue: true, delay: { seconds: 1 } },
      },
    ),
);
