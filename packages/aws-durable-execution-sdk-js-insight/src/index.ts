import type { Operation } from "@aws-sdk/client-lambda";
import type { WorkflowInsightConfig } from "./types";

export type {
  InsightExporter,
  WorkflowInsightConfig,
  WorkflowInsightRecord,
  OperationRecord,
  ContentConfig,
  OperationOverride,
} from "./types";

/**
 * Minimal plugin interface types matching @aws/durable-execution-sdk-js.
 * These will be replaced by direct imports once the SDK publishes its types.
 */
interface InvocationInfo {
  requestId: string;
  executionArn: string;
  isFirstInvocation: boolean;
}

interface InvocationEndInfo extends InvocationInfo {
  status: string;
  executionResult?: unknown;
  executionError?: Error;
  executionInput: unknown;
  operations: Record<string, Operation>;
}

interface OperationChangeInfo {
  requestId: string;
  executionArn: string;
  updatedOperations: Record<string, Operation>;
  operations: Record<string, Operation>;
}

interface DurableInstrumentationPlugin {
  onInvocationStart?(info: InvocationInfo): void;
  onInvocationEnd?(info: InvocationEndInfo): void;
  onOperationChange?(info: OperationChangeInfo): void;
}

/**
 * Creates a Workflow Insight plugin that listens to execution lifecycle events.
 * @experimental This function is experimental and may change in future releases.
 */
export function workflowInsight(
  _config: WorkflowInsightConfig,
): DurableInstrumentationPlugin {
  return {
    onInvocationStart(_info: InvocationInfo): void {
      // TODO: initialize record state, apply sampling decision
    },

    onInvocationEnd(_info: InvocationEndInfo): void {
      // TODO: build final record, call exporters
    },

    onOperationChange(_info: OperationChangeInfo): void {
      // TODO: update record state, emit if in-progress mode
    },
  };
}
