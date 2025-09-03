import { OperationUpdate } from "@amzn/dex-internal-sdk";

export type CheckpointFunction = {
  (stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  force(): Promise<void>;
};

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
  }) as jest.MockedFunction<CheckpointFunction>;

  return mockCheckpoint;
};
