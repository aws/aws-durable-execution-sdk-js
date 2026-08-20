// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Wait-for-callback scenario for OTel requirement otel-invocation-10. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-for-callback",
  async (_event, context) =>
    context.waitForCallback("otel-callback", async () => undefined),
);
