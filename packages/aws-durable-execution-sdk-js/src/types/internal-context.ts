import { StepFunc, StepConfig } from "./step";
import { CreateCallbackConfig, CreateCallbackResult } from "./callback";
import { DurablePromise } from "./durable-promise";
import { DurableLogger } from "./durable-logger";

/**
 * Internal context extension, implemented by `DurableContextImpl`, not part
 * of the public `DurableContext` contract.
 *
 * @remarks
 * Used by `waitForCallback` to label its inner CALLBACK / submitter STEP
 * spans with a plugin-only name. Never checkpointed, no effect on replay or
 * user-facing names. Not exported publicly. Exists so `waitForCallback` and
 * `DurableContextImpl` share one compiler-checked contract instead of a cast.
 *
 * @internal
 */
export interface InternalDurableContext<
  TLogger extends DurableLogger = DurableLogger,
> {
  /** `createCallback` variant that forwards a plugin-only operation name. */
  _createCallbackWithPluginOperationName<TOutput = string>(
    pluginOperationName: string | undefined,
    config?: CreateCallbackConfig<TOutput>,
  ): DurablePromise<CreateCallbackResult<TOutput>>;

  /** `step` variant that forwards a plugin-only operation name. */
  _stepWithPluginOperationName<TOutput>(
    pluginOperationName: string | undefined,
    fn: StepFunc<TOutput, TLogger>,
    config?: StepConfig<TOutput>,
  ): DurablePromise<TOutput>;
}
