/**
 * Subtypes that `microvm` and `microvmSession` record on their durable
 * operations. Execution history and plugins can filter on them without
 * parsing operation names.
 *
 * Replay compares each subtype with the checkpoint. So a changed value is a
 * breaking change for executions in flight, and these values must stay fixed.
 *
 * @public
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MicrovmOperationSubType = {
  /** The child context of a `microvm` call. */
  MICROVM: "Microvm",
  /** The child context of a `microvmSession` call. */
  SESSION: "MicrovmSession",
  /** The child context of one `invoke` call in a session. */
  SESSION_JOB: "MicrovmSessionJob",
  /** The step that generates and checkpoints a session ID. */
  SESSION_ID: "MicrovmSessionId",
  /** The step that calls RunMicrovm. */
  LAUNCH: "MicrovmLaunch",
  /** The step that sends a job to the MicroVM by HTTP. */
  REQUEST: "MicrovmRequest",
  /** The step that calls TerminateMicrovm. */
  TERMINATE: "MicrovmTerminate",
  /** The callback that the MicroVM completes with the job result. */
  CALLBACK: "MicrovmCallback",
} as const;

/**
 * One value of {@link MicrovmOperationSubType}.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type MicrovmOperationSubType =
  (typeof MicrovmOperationSubType)[keyof typeof MicrovmOperationSubType];
