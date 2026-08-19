// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Wait and resume scenario shared by OTel view case 2. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-resume",
  async (_event, context) => {
    await context.wait("otel-wait", { seconds: 1 });
    return context.step("otel-after-resume", async () => "resumed");
  },
);
