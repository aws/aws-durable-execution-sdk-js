// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Parallel hierarchy scenario for OTel requirement otel-invocation-6. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "parallel-hierarchy",
  async (_event, context) => {
    const result = await context.parallel<string>(
      "otel-parallel",
      [
        {
          name: "otel-parallel-branch-a",
          func: async (branch) =>
            branch.step("otel-parallel-step-a", async () => "a"),
        },
        {
          name: "otel-parallel-branch-b",
          func: async (branch) =>
            branch.step("otel-parallel-step-b", async () => "b"),
        },
      ],
      { maxConcurrency: 1 },
    );
    return result.getResults();
  },
);
