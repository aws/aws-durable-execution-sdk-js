// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Long durable wait for OTel requirement otel-long-running-1. */

import { createScenarioHandler, longDelaySeconds } from "./common";

export const handler = createScenarioHandler(
  "long-wait",
  async (event, context) => {
    await context.wait("otel-long-wait", {
      seconds: longDelaySeconds(event),
    });
    return context.step("otel-after-long-wait", async () => "resumed");
  },
);
