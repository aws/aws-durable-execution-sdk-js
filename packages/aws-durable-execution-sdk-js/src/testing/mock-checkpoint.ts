import { OperationUpdate } from "@aws-sdk/client-lambda";
import { Checkpoint } from "../utils/checkpoint/checkpoint-helper";

export interface CheckpointFunction extends Checkpoint {
  (stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  force(): Promise<void>;
  setTerminating(): void;
  hasPendingAncestorCompletion(stepId: string): boolean;
  waitForQueueCompletion(): Promise<void>;
  getQueueStatus(): {
    queueLength: number;
    isProcessing: boolean;
    forceCheckpointPromises: number;
  };
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
    checkpoint: mockFn, // Same function so calls are tracked together
    force: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
    hasPendingAncestorCompletion: jest.fn().mockReturnValue(false),
    waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
    getQueueStatus: jest
      .fn()
      .mockReturnValue({
        queueLength: 0,
        isProcessing: false,
        forceCheckpointPromises: 0,
      }),
  }) as jest.MockedFunction<CheckpointFunction>;

  return mockCheckpoint;
};
