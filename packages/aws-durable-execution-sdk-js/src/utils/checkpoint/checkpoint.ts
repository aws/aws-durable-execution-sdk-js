// Re-export CheckpointManager and related types for backward compatibility
export { CheckpointManager, STEP_DATA_UPDATED_EVENT } from "./checkpoint-manager";

// Backward compatibility alias
export { CheckpointManager as CheckpointHandler } from "./checkpoint-manager";

// Re-export test utilities
export { createMockCheckpoint, CheckpointFunction } from "../../testing/mock-checkpoint";

// Legacy functions for backward compatibility - now no-ops
export const deleteCheckpoint = (): void => {
  // No-op for backward compatibility
};

export const setCheckpointTerminating = (): void => {
  // No-op for backward compatibility
};

export const hasPendingAncestorCompletion = (): boolean => {
  return false;
};
