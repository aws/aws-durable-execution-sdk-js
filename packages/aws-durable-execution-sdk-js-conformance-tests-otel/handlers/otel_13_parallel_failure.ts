// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed parallel scenario for OTel requirement otel-invocation-13. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "parallel-failure",
  async (_event, context) => {
    const result = await context.parallel<void>(
      "otel-failed-parallel",
      [
        {
          name: "otel-failed-parallel-branch",
          func: async () => {
            throw new Error("Intentional parallel branch failure");
          },
        },
      ],
      { maxConcurrency: 1 },
    );
    result.throwIfError();
  },
);
