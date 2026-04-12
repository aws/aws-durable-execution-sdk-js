# Execution Summary Plugin (CloudWatch Logs)

## Overview

The Execution Summary plugin writes a structured JSON record to CloudWatch Logs at the end of each durable execution. This record captures the execution's input, output, status, duration, and operation breakdown — enabling operators to query and filter executions using CloudWatch Logs Insights.

This plugin implements `DurableInstrumentationPlugin` and requires no OTel dependency.

---

## The Problem It Solves

The durable execution service provides APIs to query execution status and history for a known execution ARN. However, there is no built-in way to answer questions like:

- Show me all executions that failed in the last 24 hours
- Show me all executions that took longer than 10 minutes
- Show me all executions where the `process-claim` step was retried more than twice

By writing a structured summary to CloudWatch Logs, operators can answer these questions using CloudWatch Logs Insights queries.

---

## Plugin Design

```typescript
interface ExecutionSummaryPluginConfig {
  /** Include the execution input in the summary (default: false) */
  includeInput?: boolean;
  /** Include the execution result in the summary (default: false) */
  includeResult?: boolean;
  /** Include the error message when execution fails (default: true) */
  includeError?: boolean;
  /** Transform the input before logging — use to redact PII. Only called when includeInput is true. */
  transformInput?: (input: unknown) => unknown;
  /** Transform the result before logging — use to redact PII. Only called when includeResult is true. */
  transformResult?: (result: unknown) => unknown;
  /** Only log summaries that match this condition. Default: log all executions. */
  filter?: (info: ExecutionEndInfo) => boolean;
}
```

---

## Example Usage

```typescript
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { ExecutionSummaryPlugin } from "@aws/durable-execution-sdk-js-cloudwatch";

export const handler = withDurableExecution(myHandler, {
  plugins: [
    new ExecutionSummaryPlugin({
      includeInput: true,
      includeResult: true,
      includeError: true,
      transformInput: (input: any) => ({
        ...input,
        ssn: undefined,
        creditCardNumber: undefined,
      }),
      filter: (info) =>
        info.status === "FAILED" || info.getSummary().durationMs > 60_000,
    }),
  ],
});
```

---

## Example CloudWatch Logs Insights Queries

```sql
-- Failed executions in the last 24 hours
fields @timestamp, executionArn, error, durationMs
| filter type = "DURABLE_EXECUTION_SUMMARY"
| filter status = "FAILED"
| filter @timestamp > ago(24h)
| sort @timestamp desc
```

```sql
-- Executions with high retry counts
fields @timestamp, executionArn, retriedOperations, totalAttempts
| filter type = "DURABLE_EXECUTION_SUMMARY"
| filter retriedOperations > 2
| sort retriedOperations desc
```

```sql
-- Average execution duration by day
filter type = "DURABLE_EXECUTION_SUMMARY"
| stats avg(durationMs) as avgDuration by bin(1d)
```

---

## Implementation Sketch

```typescript
export class ExecutionSummaryPlugin implements DurableInstrumentationPlugin {
  constructor(private readonly config: ExecutionSummaryPluginConfig = {}) {}

  onExecutionEnd(info: ExecutionEndInfo) {
    if (this.config.filter && !this.config.filter(info)) return;

    const summary = info.getSummary();

    const record: Record<string, unknown> = {
      type: "DURABLE_EXECUTION_SUMMARY",
      executionArn: info.executionArn,
      status: info.status,
      startTime: new Date(Date.now() - summary.durationMs).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: summary.durationMs,
      totalOperations: summary.totalOperations,
      totalAttempts: summary.totalAttempts,
      failedOperations: summary.failedOperations,
      retriedOperations: summary.retriedOperations,
      operationsByType: summary.operationsByType,
    };

    if (this.config.includeInput) {
      record.input = this.config.transformInput
        ? this.config.transformInput(info.executionInput)
        : info.executionInput;
    }

    if (this.config.includeResult && info.executionResult !== undefined) {
      record.result = this.config.transformResult
        ? this.config.transformResult(info.executionResult)
        : info.executionResult;
    }

    if (this.config.includeError !== false && info.executionError) {
      record.error = info.executionError.message;
    }

    // Write to stdout — Lambda runtime forwards to CloudWatch Logs
    console.log(JSON.stringify(record));
  }
}
```

---

## Design Notes

**stdout is sufficient:** Lambda automatically forwards `console.log` output to CloudWatch Logs. No CloudWatch SDK calls are needed — zero IAM requirements and zero cold start overhead.

**`type` field for filtering:** The `type: 'DURABLE_EXECUTION_SUMMARY'` field makes it easy to filter summary records from regular application logs.

**`onExecutionEnd` is called once:** Unlike `onInvocationStart/End` which fire on every Lambda invocation, `onExecutionEnd` fires exactly once when the execution reaches a terminal state.

---

## Package

Shipped in the same package as the CloudWatch emitter: `@aws/durable-execution-sdk-js-cloudwatch`.
