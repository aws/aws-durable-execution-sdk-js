// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed execution scenario shared by OTel requirement 19 views. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler("execution-failure", async () => {
  throw new Error("Intentional execution failure");
});
