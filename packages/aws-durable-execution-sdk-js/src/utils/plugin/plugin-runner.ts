import {
  DurableInstrumentationPlugin,
  AttemptEndInfo,
  AttemptInfo,
  InvocationEndInfo,
  InvocationInfo,
  OperationChangeInfo,
  PropagationInput,
  OperationEndInfo,
  OperationInfo,
  CustomerFnResult,
  CustomerFn,
} from "../../types/plugin";
import { DurableExecutionInvocationOutput } from "../../types/core";
import { collectPropagationMetadata } from "./propagation-metadata";
import util from "node:util";

type CallbackResult = unknown;
type CallbackOutcome =
  | { asynchronous: false; value: CallbackResult }
  | { asynchronous: true; promise: Promise<CallbackResult> };
type CallbackFn = () => CallbackOutcome;
const nativePromiseThen = Promise.prototype.then;

// Call only inside the boundary that owns this value: getting or invoking `then`
// can execute customer code. Capture the method once and preserve its receiver.
function observeCallbackResult(value: CallbackResult): CallbackOutcome {
  const then = value == null ? undefined : (value as { then?: unknown }).then;
  if (typeof then !== "function") {
    // Native promises remain asynchronous when their own `then` is replaced.
    // Lightweight runtimes can omit util.types; retain a same-realm fallback.
    const isPromise =
      typeof util.types?.isPromise === "function"
        ? util.types.isPromise(value)
        : value instanceof Promise;
    if (!isPromise) return { asynchronous: false, value };
  }
  const method = typeof then === "function" ? then : nativePromiseThen;
  return {
    asynchronous: true,
    promise: new Promise((resolve, reject) => {
      Reflect.apply(method, value, [resolve, reject]);
    }),
  };
}

// Recovery must reuse the inner chain, including its original synchronous error.
// Mark entry before invoking it so even a reentrant call cannot execute it twice.
function memoizeCallback(callback: CallbackFn): CallbackFn {
  let called = false;
  let outcome: CallbackOutcome = { asynchronous: false, value: undefined };
  let failure: { error: unknown } | undefined;
  return () => {
    if (!called) {
      called = true;
      try {
        outcome = callback();
      } catch (error) {
        failure = { error };
      }
    }
    if (failure) throw failure.error;
    return outcome;
  };
}

type PluginInfo =
  | OperationInfo
  | OperationEndInfo
  | InvocationInfo
  | InvocationEndInfo
  | AttemptEndInfo
  | AttemptInfo
  | OperationChangeInfo
  | PropagationInput
  | undefined;
type PluginWrapperHookFn = (
  info: PluginInfo,
  fn: CustomerFnResult,
) => CallbackResult;
type PluginHookFn = (info: PluginInfo) => CallbackResult;

/**
 * Creates a composite plugin runner that dispatches lifecycle events to all registered plugins.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function createPluginRunner(
  plugins: DurableInstrumentationPlugin[],
): DurableInstrumentationPlugin {
  if (plugins.length === 0) return {};

  const runAsCallback = <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
    fn: CustomerFn,
  ): CustomerFnResult => {
    let fnError: { error: unknown } | undefined;
    const guardedFn = memoizeCallback(() => {
      try {
        const outcome = observeCallbackResult(fn());
        if (outcome.asynchronous) {
          const promise = outcome.promise.catch((error: unknown) => {
            fnError = { error };
            throw error;
          });
          // A wrapper may start next() and return its own result without waiting.
          // Retain the callback failure even if that wrapper ignores its promise.
          void promise.catch(() => undefined);
          return { asynchronous: true, promise };
        }
        return outcome;
      } catch (error) {
        fnError = { error };
        throw error;
      }
    });

    const chain = plugins.reduceRight<CallbackFn>((next, plugin) => {
      const nextOnce = memoizeCallback(next);
      let exposedPromise: Promise<CallbackResult> | undefined;
      const callNext: CustomerFn = () => {
        const outcome = nextOnce();
        if (!outcome.asynchronous) return outcome.value;
        if (!exposedPromise) {
          // Keep the observed promise private. A wrapper can redefine `then`
          // or `constructor` on the promise it receives without corrupting the
          // cached outcome that recovery and the final error check rely on.
          exposedPromise = outcome.promise.then((value) => value);
          void exposedPromise.catch(() => undefined);
        }
        return exposedPromise;
      };
      return () => {
        try {
          const hook = plugin[method] as PluginWrapperHookFn;
          if (!hook) return nextOnce();
          const result = hook.call(plugin, info, callNext);
          // Returning next's native promise preserves its cached asynchronous
          // outcome even if the wrapper replaced its `then` property.
          if (exposedPromise !== undefined && result === exposedPromise) {
            return nextOnce();
          }
          const outcome = observeCallbackResult(result);
          if (!outcome.asynchronous) return outcome;
          return {
            asynchronous: true,
            promise: outcome.promise.catch(() => {
              // The wrapper rejected; run or reuse the inner chain.
              const fallback = nextOnce();
              return fallback.asynchronous ? fallback.promise : fallback.value;
            }),
          };
        } catch {
          // Getter, call and result-validation failures belong to this wrapper.
          // Continue through healthy inner wrappers, or reuse their outcome if
          // the failed wrapper already called next().
          return nextOnce();
        }
      };
    }, guardedFn);

    const checkCallback = (value: CallbackResult): CustomerFnResult => {
      // Preserve wrapper settlement timing, including a deadline race or a
      // synchronous override after next(). Only an already-observed callback
      // failure wins here; later rejections remain observed without delaying it.
      if (fnError) throw fnError.error;
      return value;
    };
    const outcome = chain();
    return outcome.asynchronous
      ? outcome.promise.then(checkCallback)
      : checkCallback(outcome.value);
  };

  /**
   * Invokes `method` on every plugin and awaits any promises they return, so
   * the SDK can guarantee the hook has completed before proceeding past the
   * corresponding lifecycle point (e.g. before running the next operation or
   * returning the Lambda response). Plugin errors — synchronous or
   * asynchronous — are swallowed so a misbehaving plugin never affects SDK
   * execution. Hooks are invoked on all plugins concurrently and the runner
   * waits for all of them to settle.
   *
   * Plugins that want fire-and-forget behaviour can start their work and
   * return without awaiting it; see {@link DurableInstrumentationPlugin} for
   * the caveats of doing so in Lambda.
   */
  const run = async <K extends keyof DurableInstrumentationPlugin>(
    method: K,
    info: Parameters<NonNullable<DurableInstrumentationPlugin[K]>>[0],
  ): Promise<void> => {
    await Promise.allSettled(
      plugins.map(async (p) => {
        const result = (p[method] as PluginHookFn)?.(info as PluginInfo);
        if (
          result != null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          await result;
        }
      }),
    );
  };

  return {
    providePropagationMetadata: (input) =>
      collectPropagationMetadata(plugins, input),
    onInvocationStart: (info: InvocationInfo): Promise<void> =>
      run("onInvocationStart", info),
    wrapInvocation: (
      info: InvocationInfo,
      fn: () => Promise<DurableExecutionInvocationOutput>,
    ): Promise<DurableExecutionInvocationOutput> =>
      runAsCallback(
        "wrapInvocation",
        info,
        fn,
      ) as Promise<DurableExecutionInvocationOutput>,
    onInvocationEnd: (info: InvocationEndInfo): Promise<void> =>
      run("onInvocationEnd", info),
    onOperationStart: (info: OperationInfo): Promise<void> =>
      run("onOperationStart", info),
    wrapChildContextFn: (
      info: OperationInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapChildContextFn", info, fn),
    onOperationEnd: (info: OperationEndInfo): Promise<void> =>
      run("onOperationEnd", info),
    onOperationAttemptStart: (info: AttemptInfo): Promise<void> =>
      run("onOperationAttemptStart", info),
    wrapOperationAttemptFn: (
      info: AttemptInfo,
      fn: CustomerFn,
    ): CustomerFnResult => runAsCallback("wrapOperationAttemptFn", info, fn),
    onOperationAttemptEnd: (info: AttemptEndInfo): Promise<void> =>
      run("onOperationAttemptEnd", info),
    onOperationChange: (info: OperationChangeInfo): Promise<void> =>
      run("onOperationChange", info),
    enrichLogContext: () =>
      plugins.reduce(
        (acc, p) => {
          try {
            return { ...acc, ...p.enrichLogContext?.() };
          } catch {
            return acc;
          }
        },
        {} as Record<string, string | number | boolean>,
      ),
  };
}
