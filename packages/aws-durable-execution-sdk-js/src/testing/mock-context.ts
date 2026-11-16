import { vi, type Mocked } from "vitest";
import { ExecutionContext, DurableExecutionMode } from "../types";
import { TerminationManager } from "../termination-manager/termination-manager";
import { getStepData as getStepDataUtil } from "../utils/step-id-utils/step-id-utils";

/**
 * Creates a mock ExecutionContext for testing purposes
 * @param overrides - Optional overrides for specific properties
 * @returns A mocked ExecutionContext
 */
export const createMockExecutionContext = (
  overrides: Partial<ExecutionContext & { mutex?: unknown }> = {},
): Mocked<ExecutionContext> => {
  const mockTerminationManager = {
    terminate: vi.fn(),
    getTerminationPromise: vi.fn(),
    isTerminationRequested: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TerminationManager>;

  const defaultMockContext: Mocked<ExecutionContext> = {
    state: {
      getStepData: vi.fn(),
      checkpoint: vi.fn(),
    },
    _stepData: {},
    _durableExecutionMode: DurableExecutionMode.ExecutionMode,
    terminationManager: mockTerminationManager,
    durableExecutionArn: "test-arn",
    requestId: "test-request-id",
    tenantId: "test-tenant-id",
    pendingCompletions: new Set<string>(),
    getStepData: vi.fn((stepId: string) => {
      return getStepDataUtil(defaultMockContext._stepData, stepId);
    }),
    isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as Mocked<ExecutionContext>;

  return defaultMockContext;
};
