// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Delayed callback for OTel requirement otel-long-running-3. */

import { createScenarioHandler, longDelaySeconds } from "./common";

export const handler = createScenarioHandler(
  "long-callback",
  async (event, context) => {
    longDelaySeconds(event);
    return context.waitForCallback("otel-long-callback", async () => undefined);
  },
);
