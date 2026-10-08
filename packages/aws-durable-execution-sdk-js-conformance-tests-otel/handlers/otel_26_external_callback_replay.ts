// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** A direct external completion followed by two driver-controlled replays. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "external-callback-completion-replay",
  async (_event, context) => {
    const [callback] = await context.createCallback<string>(
      "otel-external-target",
    );
    const target = await callback;
    const observed = await context.step(
      "otel-external-target-observed",
      async () => target,
    );
    const one = await context.waitForCallback<string>(
      "otel-external-barrier-one",
      async () => undefined,
    );
    const two = await context.waitForCallback<string>(
      "otel-external-barrier-two",
      async () => undefined,
    );
    return `${observed}/${one}/${two}`;
  },
);
