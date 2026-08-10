// 10-23: Context-typed hook info field shape (canonical dump)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationInfo,
  ChildContextFnInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

// CONTEXT-typed ops only: context.parallel emits its parent and each branch as
// OperationType.CONTEXT ("CONTEXT"), distinguished by subType ("Parallel" /
// "ParallelBranch"). Filtering on the SDK's own type token, dumped honestly.
function isContext(type?: string): boolean {
  return (type || "").toUpperCase() === "CONTEXT";
}

function iso(d?: Date): string | undefined {
  return d != null ? new Date(d).toISOString() : undefined;
}

// Drops undefined/null so an unexposed field is OMITTED (missing key -> failed
// assertion -> parity signal).
function compact(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// Runtime probe: only report the children-replay indicator if the hook info
// object ACTUALLY exposes it as a boolean own field (like the 10-19 end-info
// first probe). When the info type does not declare it this returns undefined
// and the key is omitted -- the honest missing-surface signal. `isReplay` is a
// DIFFERENT value and is never substituted for it.
function probeReplayingChildren(info: object): boolean | undefined {
  const rec = info as Record<string, unknown>;
  if ("isReplayingChildren" in rec && typeof rec.isReplayingChildren === "boolean") {
    return rec.isReplayingChildren;
  }
  return undefined;
}

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(
      JSON.stringify({ ...compact(rec), durableExecutionArn: executionArn }) + "\n",
    );

  return {
    async onInvocationStart(info: InvocationInfo): Promise<void> {
      // ARN captured only for durableExecutionArn stamping (unasserted).
      executionArn = info.executionArn;
    },
    // CANONICAL DUMP of the operation-start hook's own info for CONTEXT ops
    // (the parallel parent and each branch), type token dumped as reported.
    async onOperationStart(info: OperationInfo): Promise<void> {
      if (!isContext(info.type)) return;
      emit({
        plugin: PLUGIN,
        hook: "operation-start",
        id: info.id,
        name: info.name,
        type: info.type != null ? info.type.toUpperCase() : undefined,
        subType: info.subType,
        parentId: info.parentId,
        status: info.status,
        startTimestamp: iso(info.startTimestamp),
        endTimestamp: iso(info.endTimestamp),
        isReplay: info.isReplay,
      });
    },
    // CANONICAL DUMP of the SDK's user-function start hook for the CONTEXT-type
    // branch functions. In JS that hook is wrapChildContextFn, the invoke-style
    // wrapper around a parallel branch / map item / child-context body: the
    // record is emitted on entry, then the wrapped function is invoked and its
    // result returned unchanged so execution semantics are untouched.
    // isReplayingChildren is included ONLY when the info object actually
    // exposes it (probed); omitted otherwise.
    wrapChildContextFn(
      info: ChildContextFnInfo,
      fn: () => unknown,
    ): unknown {
      if (isContext(info.type)) {
        emit({
          plugin: PLUGIN,
          hook: "fn-start",
          id: info.id,
          name: info.name,
          type: info.type != null ? info.type.toUpperCase() : undefined,
          subType: info.subType,
          parentId: info.parentId,
          startTimestamp: iso(info.startTimestamp),
          isReplay: info.isReplay,
          isReplayingChildren: probeReplayingChildren(info),
        });
      }
      return fn();
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    // Real context.parallel with two NAMED branches (branch-a / branch-b),
    // max-concurrency 1 so branch-a suspends mid-run (on its 2s wait) and
    // re-runs on replay before branch-b.
    const results = await context.parallel<string>(
      "ctx",
      [
        {
          name: "branch-a",
          func: async (ctx: DurableContext) => {
            await ctx.step("inner", async () => "x");
            await ctx.wait({ seconds: 2 });
            return "a-done";
          },
        },
        {
          name: "branch-b",
          func: async (_ctx: DurableContext) => "b-done",
        },
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
  { plugins: [makePlugin()] },
);
