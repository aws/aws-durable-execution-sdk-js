// Base API paths
export const API_PATHS = {
  START_DURABLE_EXECUTION: "/start-durable-execution",
  START_INVOCATION: "/start-invocation",
  POLL_CHECKPOINT_DATA: "/poll-checkpoint-data",
  UPDATE_CHECKPOINT_DATA: "/update-checkpoint-data",
  GET_STATE: "/2025-12-01/durable-execution-state",
  CHECKPOINT: "/2025-12-01/durable-execution-state",
  CALLBACKS: "/2025-12-01/durable-execution-callbacks",
} as const;

// HTTP methods
export const HTTP_METHODS = {
  GET: "GET",
  POST: "POST",
};

// Utility functions to generate full paths with parameters
export function getStartInvocationPath(executionId: string): string {
  return `${API_PATHS.START_INVOCATION}/${executionId}`;
}

export function getPollCheckpointDataPath(executionId: string): string {
  return `${API_PATHS.POLL_CHECKPOINT_DATA}/${executionId}`;
}

export function getUpdateCheckpointDataPath(
  executionId: string,
  operationId: string
): string {
  return `${API_PATHS.UPDATE_CHECKPOINT_DATA}/${executionId}/${operationId}`;
}

export const CHECKPOINT_SERVER_PORT = 4126;
