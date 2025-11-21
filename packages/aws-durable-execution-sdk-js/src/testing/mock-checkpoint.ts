import { OperationUpdate } from "@aws-sdk/client-lambda";

export interface CheckpointFunction {
  (stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  force(): Promise<void>;
  setTerminating(): void;
  hasPendingAncestorCompletion(stepId: string): boolean;
}

export const createMockCheckpoint = (
  mockImplementation?: (
    stepId: string,
    data: Partial<OperationUpdate>,
  ) => Promise<void>,
): jest.MockedFunction<CheckpointFunction> => {
  const mockFn = jest.fn(
    mockImplementation || jest.fn().mockResolvedValue(undefined),
  );
  const mockCheckpoint = Object.assign(mockFn, {
    force: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
    hasPendingAncestorCompletion: jest.fn().mockReturnValue(false),
  }) as jest.MockedFunction<CheckpointFunction>;

  return mockCheckpoint;
};
