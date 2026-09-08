// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Map hierarchy scenario for OTel requirement otel-invocation-7. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "map-hierarchy",
  async (_event, context) => {
    const result = await context.map(
      "otel-map",
      [1, 2],
      async (iteration, item, index) =>
        iteration.step(`otel-map-step-${index}`, async () => item * 2),
      {
        itemNamer: (_item, index) => `otel-map-iteration-${index}`,
        maxConcurrency: 1,
      },
    );
    return result.getResults();
  },
);
