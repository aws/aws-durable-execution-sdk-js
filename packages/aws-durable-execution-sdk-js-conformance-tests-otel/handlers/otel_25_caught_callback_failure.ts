// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Catch a failed callback, then replay it before returning successfully. */

import {
  CallbackExternalError,
  defaultSerdes,
  type Serdes,
} from "@aws/durable-execution-sdk-js";
import { createScenarioHandler } from "./common";

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
  "caught-callback-failure-replay",
  async (_event, context) => {
    let caught = false;
    try {
      await context.waitForCallback(
        "otel-failed-callback",
        async () => undefined,
      );
    } catch (error) {
      if (!(error instanceof CallbackExternalError)) throw error;
      caught = true;
    }
    if (!caught) throw new Error("Expected the callback to fail");

    const observed = await context.step(
      "otel-failed-callback-observed",
      async () => "caught",
    );
    const one = await context.waitForCallback<string>(
      "otel-failed-callback-barrier-one",
      async () => undefined,
      { serdes: callbackSerdes },
    );
    const two = await context.waitForCallback<string>(
      "otel-failed-callback-barrier-two",
      async () => undefined,
      { serdes: callbackSerdes },
    );
    return `${observed}/${one}/${two}`;
  },
);
