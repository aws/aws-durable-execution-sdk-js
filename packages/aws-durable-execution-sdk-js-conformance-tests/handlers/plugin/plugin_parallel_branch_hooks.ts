// 10-12: Plugin user-function hooks fire per parallel branch with parent linkage
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function makePlugin(): DurableInstrumentationPlugin {
  let executionArn = "";
  const emit = (rec: Record<string, unknown>): void =>
    process.stdout.write(JSON.stringify({ ...rec, durableExecutionArn: executionArn }) + "\n");

  return {
    async onInvocationStart(info): Promise<void> {
      executionArn = info.executionArn;
    },
    // wrapChildContextFn runs on the same thread as the branch function, so
    // fn-start is guaranteed to precede fn-end for a given branch. Parallel
    // branches run inside child contexts, so this hook receives them with the
    // ParallelBranch subType.
    wrapChildContextFn(info, fn) {
      if (info.subType !== "ParallelBranch") return fn();
      const parent = info.parentId ? info.parentId : "NONE";
      emit({ plugin: PLUGIN, hook: "fn-start", op: info.id, parent });
      return Promise.resolve()
        .then(() => fn())
        .then(
          (result) => {
            emit({
              plugin: PLUGIN,
              hook: "fn-end",
              op: info.id,
              parent,
              outcome: "SUCCEEDED",
            });
            return result;
          },
          (err) => {
            emit({
              plugin: PLUGIN,
              hook: "fn-end",
              op: info.id,
              parent,
              outcome: "FAILED",
            });
            throw err;
          },
        );
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    const results = await context.parallel<string>(
      "parallel",
      [
        async (_ctx: DurableContext) => "task-1",
        async (_ctx: DurableContext) => "task-2",
      ],
      { maxConcurrency: 1 },
    );
    return results.getResults();
  },
  { plugins: [makePlugin()] },
);
