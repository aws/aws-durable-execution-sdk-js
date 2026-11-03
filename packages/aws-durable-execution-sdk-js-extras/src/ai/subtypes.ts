/**
 * Subtypes that the `decider` and `llm` operations record on their durable
 * steps. Execution history and plugins can filter on them without parsing step
 * names.
 *
 * Replay compares each subtype with the checkpoint. So a changed value is a
 * breaking change for executions in flight, and these values must stay fixed.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const AiOperationSubType = {
  /** The step of `decider().check`. */
  DECIDER_CHECK: "DeciderCheck",
  /** The step of `decider().classify`. */
  DECIDER_CLASSIFY: "DeciderClassify",
  /** The step of `decider().label`. */
  DECIDER_LABEL: "DeciderLabel",
  /** The step of `decider().score`. */
  DECIDER_SCORE: "DeciderScore",
  /** The step of `llm().ask`. */
  LLM_ASK: "LlmAsk",
} as const;

/**
 * One value of {@link AiOperationSubType}.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type AiOperationSubType =
  (typeof AiOperationSubType)[keyof typeof AiOperationSubType];
