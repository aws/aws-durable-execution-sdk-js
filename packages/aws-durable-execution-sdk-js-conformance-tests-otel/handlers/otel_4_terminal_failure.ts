// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Terminal execution failure scenario for OTel requirement otel-invocation-4. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "terminal-failure",
  async (_event, context) =>
    context.step(
      "otel-terminal-failure",
      async () => {
        throw new Error("Intentional terminal failure");
      },
      { retryStrategy: () => ({ shouldRetry: false }) },
    ),
);
