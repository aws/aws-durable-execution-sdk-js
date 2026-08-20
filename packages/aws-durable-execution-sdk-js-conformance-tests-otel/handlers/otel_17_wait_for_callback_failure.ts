// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed wait-for-callback scenario for OTel requirement otel-invocation-17. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-for-callback-failure",
  async (_event, context) =>
    context.waitForCallback("otel-failed-callback", async () => undefined),
);
