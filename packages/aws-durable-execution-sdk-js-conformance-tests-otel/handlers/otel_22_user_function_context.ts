// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Observe active context inside the real SDK's user-function boundaries. */

import { createScenarioHandler, recordUserFunctionSpan } from "./common";

export const handler = createScenarioHandler(
  "user-function-context",
  async (_event, durable) => {
    recordUserFunctionSpan("handler");
    await durable.step("otel-context-step", async () => {
      recordUserFunctionSpan("step");
      return "step";
    });
    await durable.runInChildContext("otel-context-child", async (child) => {
      recordUserFunctionSpan("child");
      await child.step("otel-context-child-step", async () => {
        recordUserFunctionSpan("child-step");
        return "child-step";
      });
      recordUserFunctionSpan("child-restored");
      return "child";
    });
    await durable.parallel(
      "otel-context-parallel",
      [
        {
          name: "otel-context-branch-a",
          func: async (branch) => {
            recordUserFunctionSpan("parallel-a");
            return branch.step("otel-context-branch-step-a", async () => {
              recordUserFunctionSpan("parallel-step-a");
              return "a";
            });
          },
        },
        {
          name: "otel-context-branch-b",
          func: async (branch) => {
            recordUserFunctionSpan("parallel-b");
            return branch.step("otel-context-branch-step-b", async () => {
              recordUserFunctionSpan("parallel-step-b");
              return "b";
            });
          },
        },
      ],
      { maxConcurrency: 2 },
    );
    await durable.map(
      "otel-context-map",
      [0, 1],
      async (iteration, item) => {
        recordUserFunctionSpan(`map-${item}`);
        return iteration.step(`otel-context-map-step-${item}`, async () => {
          recordUserFunctionSpan(`map-step-${item}`);
          return item;
        });
      },
      {
        itemNamer: (item) => `otel-context-iteration-${item}`,
        maxConcurrency: 2,
      },
    );
    recordUserFunctionSpan("handler-restored");
    await durable.wait("otel-context-resume", { seconds: 1 });
    recordUserFunctionSpan("handler-after-resume");
    return "context-complete";
  },
);
