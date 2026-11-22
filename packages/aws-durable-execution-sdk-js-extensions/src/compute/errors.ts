import { DurableOperationError } from "@aws/durable-execution-sdk-js";

/**
 * The base class of every error that a compute operation reports, such as
 * `MicrovmError` for the MicroVM operations.
 *
 * @remarks
 * Catch it to handle a failure of any compute type the same way. Each compute
 * type has its own subclass, and that subclass has one subclass per kind of
 * failure.
 *
 * The class has no `errorType` of its own. Each subclass records its own type
 * in the checkpoint. So adding this base changed no checkpointed type, and
 * executions in flight replay as before.
 *
 * @public
 *
 * @experimental This class is experimental and may be changed or removed in future releases.
 */
export abstract class ComputeError extends DurableOperationError {}
