// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0

import { context, isSpanContextValid, trace } from "@opentelemetry/api";

import {
  DurableContext,
  DurableExecutionHandler,
  DurableLambdaHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  ExecutionOtelPlugin,
  InvocationOtelPlugin,
} from "@aws/durable-execution-sdk-js-otel";

export interface ScenarioEvent {
  scenario: string;
  [key: string]: unknown;
}

type Workflow<TResult> = (
  event: ScenarioEvent,
  context: DurableContext,
) => Promise<TResult>;

const plugin =
  process.env.OTEL_PLUGIN_MODE === "execution"
    ? new ExecutionOtelPlugin()
    : new InvocationOtelPlugin();

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
  return withDurableExecution(handler, { plugins: [plugin] });
}

export function createTargetHandler<TResult>(
  workflow: Workflow<TResult>,
): DurableLambdaHandler {
  return withDurableExecution(workflow, { plugins: [plugin] });
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

/** Observe the context supplied by the SDK; never install or repair a parent. */
export function recordUserFunctionSpan(callback: string): void {
  const active = trace.getSpan(context.active())?.spanContext();
  if (!active || !isSpanContextValid(active)) {
    throw new Error(
      `No valid active span context in user function ${callback}`,
    );
  }
  const span = trace
    .getTracer("durable-conformance-user-functions")
    .startSpan(`conformance.${callback}`, {
      attributes: { "conformance.callback": callback },
    });
  span.end();
}
