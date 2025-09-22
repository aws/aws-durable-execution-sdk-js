import { ExecutionContext } from "../types";
import { TerminationManager } from "../termination-manager/termination-manager";
import { getStepData as getStepDataUtil } from "../utils/step-id-utils/step-id-utils";

/**
 * Creates a mock ExecutionContext for testing purposes
 * @param overrides Optional overrides for specific properties
 * @returns A mocked ExecutionContext
 */
export const createMockExecutionContext = (
  overrides: Partial<ExecutionContext & { mutex?: any }> = {},
): jest.Mocked<ExecutionContext> => {
  const mockTerminationManager = {
    terminate: jest.fn(),
    getTerminationPromise: jest.fn(),
  } as unknown as jest.Mocked<TerminationManager>;

  const defaultMockContext: jest.Mocked<ExecutionContext> = {
    executionContextId: "test-execution-id",
    customerHandlerEvent: "test-event",
    state: {
      getStepData: jest.fn(),
      checkpoint: jest.fn(),
    },
    _stepData: {},
    terminationManager: mockTerminationManager,
    isLocalMode: false,
    isVerbose: false,
    durableExecutionArn: "test-arn",
    getStepData: jest.fn((stepId: string) => {
      return getStepDataUtil(defaultMockContext._stepData, stepId);
    }),
    ...overrides,
  } as unknown as jest.Mocked<ExecutionContext>;

  return defaultMockContext;
};
