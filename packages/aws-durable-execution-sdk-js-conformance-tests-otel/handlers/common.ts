// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0

import {
  DurableContext,
  DurableExecutionHandler,
  DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  createExecutionOtelPluginFactory,
  createInvocationOtelPluginFactory,
} from "@aws/durable-execution-sdk-js-otel";

export interface ScenarioEvent {
  scenario: string;
  [key: string]: unknown;
}

type Workflow<TResult> = (
  event: ScenarioEvent,
  context: DurableContext,
) => Promise<TResult>;

// One factory per module load, shared by every handler in the bundle: the
// tracer provider and exporter it holds belong to the execution environment,
// while the SDK calls the factory's `createPlugin` once per invocation to build
// that invocation's plugin instance.
const pluginFactory =
  process.env.OTEL_PLUGIN_MODE === "execution"
    ? createExecutionOtelPluginFactory()
    : createInvocationOtelPluginFactory();

export function createScenarioHandler<TResult>(
  expectedScenario: string,
  workflow: Workflow<TResult>,
): DurableLambdaHandler {
  const handler: DurableExecutionHandler<ScenarioEvent, TResult> = async (
    event,
    context,
  ) => {
    requireScenario(event, expectedScenario);
    return workflow(event, context);
  };
  return withDurableExecution(handler, { plugins: [pluginFactory] });
}

export function createTargetHandler<TResult>(
  workflow: Workflow<TResult>,
): DurableLambdaHandler {
  return withDurableExecution(workflow, { plugins: [pluginFactory] });
}

export function longDelaySeconds(event: ScenarioEvent): number {
  const delay = Number(event.delay_seconds);
  if (!Number.isInteger(delay) || delay < 1 || delay > 86_400) {
    throw new Error("delay_seconds must be an integer from 1 through 86400");
  }
  return delay;
}

function requireScenario(event: ScenarioEvent, expected: string): void {
  if (event.scenario !== expected) {
    throw new Error(
      `Expected scenario ${expected}, received ${String(event.scenario)}`,
    );
  }
}
