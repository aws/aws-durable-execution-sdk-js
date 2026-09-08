// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed wait-for-condition scenario for OTel requirement otel-invocation-16. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-for-condition-failure",
  async (_event, context) =>
    context.waitForCondition(
      "otel-failed-condition",
      async (_state: number) => {
        throw new Error("Intentional condition check failure");
      },
      {
        initialState: 0,
        waitStrategy: () => ({
          shouldContinue: true,
          delay: { seconds: 1 },
        }),
      },
    ),
);
