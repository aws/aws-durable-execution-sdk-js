// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** A successful step must not be re-exported by the execution view on resume. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "completed-step-replay",
  async (_event, context) => {
    const before = await context.step("otel-before-wait", async () => "before");
    await context.wait("otel-replay-wait", { seconds: 1 });
    const after = await context.step("otel-after-wait", async () => "after");
    return `${before}-${after}`;
  },
);
