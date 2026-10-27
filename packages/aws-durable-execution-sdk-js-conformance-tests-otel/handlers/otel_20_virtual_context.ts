// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Virtual child-context scenario for OTel requirement otel-invocation-20. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "virtual-context",
  async (_event, context) =>
    context.runInChildContext(
      "otel-virtual-context",
      async () => "virtual-complete",
      { virtualContext: true },
    ),
);
