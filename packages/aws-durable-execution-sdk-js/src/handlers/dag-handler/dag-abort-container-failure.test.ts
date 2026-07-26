/**
 * Regression test for the 10-12 runIf-abort cloud defect (review finding H5).
 *
 * A non-root task whose `runIf` throws must FAIL the DAG *container*: the child
 * context must checkpoint a failure (`SubType=Dag`, `Action=FAIL`) so the
 * failure is durable and visible on the wire as `ContextFailed(SubType=Dag)`.
 * The cloud run instead saw the raw predicate error escape as
 * `Runtime.UnhandledPromiseRejection`, Lambda retry four times, and NO
 * `ContextFailed` for the DAG container — because the predicate is evaluated in
 * a `.then` continuation on the scheduler's DETACHED task promise, and a throw
 * there escaped instead of failing the container.
 *
 * The existing unit tests asserted only that `dag()`'s returned promise
 * rejects, which is NOT sufficient: in the cloud that promise's rejection and
 * the escaping raw rejection are two independent chains. This test instead
 * inspects the CONTAINER's recorded outcome, distinguishing:
 *   - "container failed": a DAG container FAIL checkpoint was recorded, versus
 *   - "error escaped": a process-level unhandled rejection.
 */
import {
  createDurableContext,
  DurableExecution,
  DurableContextImpl,
} from "../../context/durable-context/durable-context";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { TerminationManager } from "../../termination-manager/termination-manager";
import {
  ExecutionContext,
  DurableExecutionMode,
  DurableLogger,
  OperationSubType,
} from "../../types";
import { getStepData as getStepDataUtil } from "../../utils/step-id-utils/step-id-utils";
import { createDefaultLogger } from "../../utils/logger/default-logger";
import { DagPredicateError } from "../../errors/dag-errors/dag-errors";
import {
  OperationAction,
  Operation,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { EventEmitter } from "events";
import { Context } from "aws-lambda";

interface CheckpointCall {
  stepId: string;
  data: Partial<OperationUpdate>;
}

/**
 * Builds a real DurableContext whose checkpoint RECORDS every call (so we can
 * assert the container's failure was checkpointed) and resolves asynchronously
 * on a macrotask — closer to cloud timing than the synchronous jest-mock
 * checkpoint, so the abort races the same way it does on the wire.
 */
function makeRecordingContext(
  calls: CheckpointCall[],
): DurableContextImpl<DurableLogger> {
  const later = <T>(v: T): Promise<T> =>
    new Promise((r) => setTimeout(() => r(v), 2));
  const checkpoint = {
    checkpoint: (stepId: string, data: Partial<OperationUpdate>) => {
      calls.push({ stepId, data });
      return later(undefined);
    },
    forceCheckpoint: () => later(undefined),
    force: () => later(undefined),
    setTerminating: () => {},
    hasPendingAncestorCompletion: () => false,
    waitForQueueCompletion: () => later(undefined),
    markAncestorFinished: () => {},
    markOperationState: () => {},
    waitForRetryTimer: () => later(undefined),
    waitForStatusChange: () => later(undefined),
    markOperationAwaited: () => {},
    getOperationState: () => undefined,
    getAllOperations: () => new Map(),
  } as unknown as Checkpoint;

  const stepData: Record<string, Operation> = {};
  const executionContext = {
    durableExecutionClient: {
      getExecutionState: async () => ({ Operations: [] }),
      checkpoint: async () => ({ NewExecutionState: undefined }),
    },
    _stepData: stepData,
    terminationManager: new TerminationManager(),
    durableExecutionArn:
      "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
    pendingCompletions: new Set<string>(),
    getStepData: (id: string) => getStepDataUtil(stepData, id),
    isOperationUpdatedBetweenInvocation: () => false,
    requestId: "mock-request-id",
    tenantId: undefined,
  } as unknown as ExecutionContext;

  const lambdaContext = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "t",
    functionVersion: "1",
    invokedFunctionArn: "arn",
    memoryLimitInMB: "128",
    awsRequestId: "r",
    logGroupName: "g",
    logStreamName: "s",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  } as Context;

  const durableExecution = {
    checkpointManager: checkpoint,
    stepDataEmitter: new EventEmitter(),
    setTerminating: (): void => {},
    plugin: {},
  };

  return createDurableContext<DurableLogger>(
    executionContext,
    lambdaContext,
    DurableExecutionMode.ExecutionMode,
    createDefaultLogger(),
    undefined,
    durableExecution as unknown as DurableExecution,
  );
}

describe("DAG runIf-abort container failure (10-12 / H5 regression)", () => {
  it("checkpoints a DAG CONTAINER failure and does not leak an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown): void => {
      unhandled.push(r);
    };
    process.on("unhandledRejection", onUnhandled);

    const calls: CheckpointCall[] = [];
    const context = makeRecordingContext(calls);

    // External counters: the only reliable evidence of whether a body ran.
    let gateRan = 0;
    let guardedRan = 0;
    let refundRan = 0;

    let caught: unknown;
    try {
      await context.dag(
        "abortdag",
        (d) => {
          const gate = d.step("gate", [], async (): Promise<number> => {
            gateRan += 1;
            return 1;
          });
          // Non-root: runIf depends on `gate`, so it is evaluated in a `.then`
          // continuation after `gate` settles — the exact 10-12 shape.
          const guarded = d.step(
            "guarded",
            [gate],
            async (): Promise<string> => {
              guardedRan += 1;
              return "ran";
            },
            {
              runIf: (): boolean => {
                throw new Error("predicate boom");
              },
            },
          );
          d.step("refund", [], async (): Promise<string> => {
            refundRan += 1;
            return "refunded";
          })
            .after(guarded)
            .triggerRule("ALL_FAILED");
        },
        { maxConcurrency: 1 },
      );
    } catch (e) {
      caught = e;
    }

    // Flush queues so any leaked rejection is observed before asserting.
    await new Promise((r) => setTimeout(r, 30));
    process.off("unhandledRejection", onUnhandled);

    // (1) dag() rejects with the typed predicate error (message names the task
    // and its cause — the structured fields are erased by the child-context
    // boundary, so the message is the caller-visible contract).
    expect(caught).toBeInstanceOf(DagPredicateError);
    expect((caught as Error).message).toContain("guarded");
    expect((caught as Error).message).toContain("predicate boom");

    // (2) THE DISTINGUISHING ASSERTION: the DAG container recorded a FAILURE.
    // This is what the cloud run was missing (no ContextFailed for the Dag).
    const containerFail = calls.find(
      (c) =>
        c.data?.SubType === OperationSubType.DAG &&
        c.data?.Action === OperationAction.FAIL,
    );
    expect(containerFail).toBeDefined();

    // (3) the failure did NOT escape to the runtime as an unhandled rejection.
    expect(unhandled).toEqual([]);

    // (4) `gate` ran; the guarded body never ran (its predicate threw before
    // the body); and the ALL_FAILED compensation never ran — a predicate defect
    // must never drive compensation.
    expect(gateRan).toBe(1);
    expect(guardedRan).toBe(0);
    expect(refundRan).toBe(0);
  });
});
