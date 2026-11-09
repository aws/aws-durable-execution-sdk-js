import { vi, type MockedFunction } from "vitest";
import { OperationUpdate } from "../types/wire";
import { Checkpoint } from "../utils/checkpoint/checkpoint-helper";

export interface CheckpointFunction extends Checkpoint {
  (stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  force(): Promise<void>;
  setTerminating(): void;
  hasPendingAncestorCompletion(stepId: string): boolean;
  waitForQueueCompletion(): Promise<void>;
  markAncestorFinished(stepId: string): void;
}

export const createMockCheckpoint = (
  mockImplementation?: (
    stepId: string,
    data: Partial<OperationUpdate>,
  ) => Promise<void>,
): MockedFunction<CheckpointFunction> => {
  const mockFn = vi.fn(
    mockImplementation || vi.fn().mockResolvedValue(undefined),
  );

  const mockCheckpoint = Object.assign(mockFn, {
    checkpoint: mockFn, // Same function so calls are tracked together
    force: vi.fn().mockResolvedValue(undefined),
    setTerminating: vi.fn(),
    hasPendingAncestorCompletion: vi.fn().mockReturnValue(false),
    waitForQueueCompletion: vi.fn().mockResolvedValue(undefined),
    markAncestorFinished: vi.fn(),
    // New lifecycle methods (stubs)
    markOperationState: vi.fn(),
    waitForRetryTimer: vi.fn().mockResolvedValue(undefined),
    waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    markOperationAwaited: vi.fn(),
    getOperationState: vi.fn().mockReturnValue(undefined),
    getAllOperations: vi.fn().mockReturnValue(new Map()),
  }) as MockedFunction<CheckpointFunction>;

  return mockCheckpoint;
};
