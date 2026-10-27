// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Interrupted wait scenario shared by OTel requirement 15 views. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "wait-interrupted",
  async (_event, context) => {
    await context.wait("otel-interrupted-wait", { seconds: 30 });
  },
);
