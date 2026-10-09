// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** A direct external completion followed by two driver-controlled replays. */

import { defaultSerdes, type Serdes } from "@aws/durable-execution-sdk-js";
import { createScenarioHandler } from "./common";

// CallbackActions encodes every payload as JSON, including string payloads.
const callbackSerdes: Omit<Serdes<string>, "serialize"> = {
  async deserialize(value, serdesContext) {
    const decoded = await defaultSerdes.deserialize(value, serdesContext);
    if (typeof decoded !== "string") {
      throw new Error("Expected a JSON string callback result");
    }
    return decoded;
  },
};

export const handler = createScenarioHandler(
  "external-callback-completion-replay",
  async (_event, context) => {
    const [callback] = await context.createCallback<string>(
      "otel-external-target",
      { serdes: callbackSerdes },
    );
    const target = await callback;
    const observed = await context.step(
      "otel-external-target-observed",
      async () => target,
    );
    const one = await context.waitForCallback<string>(
      "otel-external-barrier-one",
      async () => undefined,
      { serdes: callbackSerdes },
    );
    const two = await context.waitForCallback<string>(
      "otel-external-barrier-two",
      async () => undefined,
      { serdes: callbackSerdes },
    );
    return `${observed}/${one}/${two}`;
  },
);
