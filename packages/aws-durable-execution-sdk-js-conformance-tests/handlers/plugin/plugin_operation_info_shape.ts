// 10-20: Operation hook info field shape (canonical dump)
import {
  DurableContext,
  withDurableExecution,
  DurableInstrumentationPlugin,
  InvocationInfo,
  OperationInfo,
  OperationEndInfo,
} from "@aws/durable-execution-sdk-js";

const PLUGIN = "CONFPLUGIN";

function isStep(type?: string): boolean {
  return (type || "").toUpperCase() === "STEP";
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

// CANONICAL DUMP of the CURRENT hook's own operation info: every field mapped
// one-to-one to its canonical camelCase name; type upper-cased; timestamps as
// ISO-8601 strings; result as the raw serialized string; error as its message.
function dumpOperation(hook: string, info: OperationInfo): Record<string, unknown> {
  return {
    plugin: PLUGIN,
    hook,
    id: info.id,
    name: info.name,
    type: info.type != null ? info.type.toUpperCase() : undefined,
    subType: info.subType,
    parentId: info.parentId,
    status: info.status,
    startTimestamp: iso(info.startTimestamp),
    endTimestamp: iso(info.endTimestamp),
    result: info.result,
    error: info.error != null ? info.error.message : undefined,
    attempt: info.attempt,
    isReplay: info.isReplay,
  };
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
    async onOperationStart(info: OperationInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit(dumpOperation("operation-start", info));
    },
    async onOperationEnd(info: OperationEndInfo): Promise<void> {
      if (!isStep(info.type)) return;
      emit(dumpOperation("operation-end", info));
    },
  };
}

export const handler = withDurableExecution(
  async (_event: any, context: DurableContext) => {
    return await context.step("greet", async () => "task-a");
  },
  { plugins: [makePlugin()] },
);
