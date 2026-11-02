/**
 * Subtypes that the `llm` operations record on their durable steps. Execution
 * history and plugins can filter on them without parsing step names.
 *
 * The subtype names the operation, not the model that answered. So a later
 * model keeps the same subtype.
 *
 * Replay compares each subtype with the checkpoint. So a changed value is a
 * breaking change for executions in flight, and these values must stay fixed.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const LlmOperationSubType = {
  /** The step of `ask`. */
  ASK: "LlmAsk",
  /** The step of `check`. */
  CHECK: "LlmCheck",
  /** The step of `classify`. */
  CLASSIFY: "LlmClassify",
  /** The step of `label`. */
  LABEL: "LlmLabel",
  /** The step of `score`. */
  SCORE: "LlmScore",
} as const;

/**
 * One value of {@link LlmOperationSubType}.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type LlmOperationSubType =
  (typeof LlmOperationSubType)[keyof typeof LlmOperationSubType];
