// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import checkpointModule from "../packages/aws-durable-execution-sdk-js/src/utils/checkpoint/checkpoint-manager.ts";
import terminationModule from "../packages/aws-durable-execution-sdk-js/src/termination-manager/termination-manager.ts";

const { CheckpointManager } = checkpointModule;
const { TerminationManager } = terminationModule;

export function manager(client, token = "closed") {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new CheckpointManager(
    `arn:${token}`,
    {},
    client,
    new TerminationManager(),
    token,
    new EventEmitter(),
    logger,
    new Set(),
    {},
    token,
    () => 60000,
  );
}

export function preparePoll(checkpointManager) {
  // First registration requires metadata even when the test only observes timers.
  // Keep a sibling executing so this fixture cannot suspend before the poll.
  checkpointManager.markOperationState("1", "EXECUTING", {
    metadata: { stepId: "1", name: "busy", type: "STEP", subType: "Step" },
  });
  checkpointManager.markOperationState("2", "IDLE_NOT_AWAITED", {
    metadata: { stepId: "2", name: "waiting", type: "WAIT", subType: "Wait" },
  });
  return checkpointManager.getAllOperations().get("2");
}
