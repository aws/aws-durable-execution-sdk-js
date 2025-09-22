export const TEST_CONSTANTS = {
  // Step IDs
  STEP_ID: "test-step-id",
  STEP_ID_1: "step-1",
  CALLBACK_ID: "test-callback-id",
  STEP: "test-step",

  // Execution context
  TASK_TOKEN: "test-task-token",
  CHECKPOINT_TOKEN: "test-checkpoint-token",
  DURABLE_EXECUTION_ARN: "test-durable-execution-arn",

  // Names
  CALLBACK_NAME: "test-callback",
  STEP_NAME: "test-step",

  // Results
  RESULT: "test-result",

  // Child context constants
  CHILD_CONTEXT_ID: "test-child-context-id",
  CHILD_CONTEXT_NAME: "test-child-context",
  CHILD_CONTEXT_RESULT: "child-context-result",

  // Default configs
  DEFAULT_MAP_CONFIG: {
    iterationSubType: "MapIteration",
    maxConcurrency: undefined,
    topLevelSubType: "Map",
  },
  DEFAULT_PARALLEL_CONFIG: {
    iterationSubType: "ParallelBranch",
    maxConcurrency: undefined,
    topLevelSubType: "Parallel",
  },

  // Default step checkpoint templates (using string values to match actual usage)
  DEFAULT_STEP_START_CHECKPOINT: {
    Id: "test-step-id",
    ParentId: undefined,
    Action: "START",
    SubType: "Step",
    Type: "STEP",
    Name: "test-step",
  },
  DEFAULT_STEP_SUCCEED_CHECKPOINT: {
    Id: "test-step-id",
    ParentId: undefined,
    Action: "SUCCEED",
    SubType: "Step",
    Type: "STEP",
    Name: "test-step",
  },
  DEFAULT_STEP_FAIL_CHECKPOINT: {
    Id: "test-step-id",
    ParentId: undefined,
    Action: "FAIL",
    SubType: "Step",
    Type: "STEP",
    Name: "test-step",
  },
  DEFAULT_STEP_RETRY_CHECKPOINT: {
    Id: "test-step-id",
    ParentId: undefined,
    Action: "RETRY",
    SubType: "Step",
    Type: "STEP",
    Name: "test-step",
  },
} as const;
