// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed map scenario for OTel requirement otel-invocation-14. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "map-failure",
  async (_event, context) => {
    const result = await context.map(
      "otel-failed-map",
      [1],
      async () => {
        throw new Error("Intentional map iteration failure");
      },
      {
        itemNamer: (_item, index) => `otel-failed-map-iteration-${index}`,
        maxConcurrency: 1,
      },
    );
    result.throwIfError();
  },
);
