import { ExecutionContext } from "../types/core";
import { getExecutionState, ExecutionState } from "../storage/storage";
import { ActiveOperationsTracker } from "../utils/termination-helper/active-operations-tracker";
import { Operation } from "@aws-sdk/client-lambda";

export function createTestExecutionContext(
  overrides: Partial<{
    stepData: Record<string, Operation>;
    durableExecutionArn: string;
    activeOperationsTracker: ActiveOperationsTracker;
    state: ExecutionState;
  }> = {},
): ExecutionContext {
  const context = new ExecutionContext(
    overrides.state || getExecutionState(),
    overrides.stepData || {},
    overrides.durableExecutionArn || "test-arn",
    overrides.activeOperationsTracker || new ActiveOperationsTracker(),
  );

  // Override state if provided (needed for testing)
  if (overrides.state) {
    Object.defineProperty(context, "state", {
      value: overrides.state,
      writable: true,
      configurable: true,
    });
  }

  return context;
}
