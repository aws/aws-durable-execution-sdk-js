/** Messages from webview → extension host */
export type OutboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string }
  | { type: "newSession" }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "downloadModel"; localModel?: string }
  // NOTE: keep this `visualize` shape in sync with the InboundMessage union in
  // src/extension.ts (host and webview message types are, as existing debt,
  // declared separately in each project's own `src`).
  | {
      type: "visualize";
      columns: string[];
      numericColumns: string[];
      chartType?: string;
      description: string;
      requestId: number;
    }
  | { type: "startListening" }
  | { type: "stopListening" }
  | {
      type: "fetchDetail";
      idColumn: string;
      idValue: string;
      year?: string;
      month?: string;
      day?: string;
    };

/** A single SQS message, normalized for display. */
export interface SqsMessageRow {
  messageId: string;
  receivedAt: string;
  body: string;
  attributes: Record<string, string>;
}

/** Messages from extension host → webview */
export type InboundMessage =
  | { type: "config"; settings: Settings; modelDownloaded?: boolean }
  | { type: "status"; text: string }
  | {
      type: "results";
      columns: string[];
      rows: string[][];
      count: number;
      /**
       * True if the extension host capped this result at its row ceiling
       * (MAX_SQL_ROWS). More rows matched than are shown, so `count`/`rows`
       * are a bounded prefix — the UI says so and the model is told not to
       * treat it as the complete result.
       */
      truncated?: boolean;
      explanation?: string;
      finalQuery?: string;
      suggestedCharts?: string[];
      /**
       * The column (if any) result rows carry a stable per-execution
       * identifier under, added by the extension host's identifier
       * injection (see queryShape.ts). Omitted for aggregate query results
       * (GROUP BY, bare COUNT/SUM/etc.) — there is no single execution a
       * summary row corresponds to, so no row-detail drill-down is offered
       * for those results.
       */
      idColumn?: string;
      /**
       * For the S3+Athena destination: the actual result-column names (if
       * present) carrying the row's year/month/day partition values, added
       * alongside idColumn so the row-detail fetch can prune to a single
       * partition instead of scanning the whole table on every click. Each
       * field is undefined if that partition column isn't in this result
       * set (e.g. an aggregate query, or a non-S3 destination).
       */
      partitionColumns?: { year?: string; month?: string; day?: string };
      /**
       * Columns the extension host injected purely so the row-detail fetch
       * has something to key/prune on (idColumn itself, plus S3+Athena's
       * year/month/day partition columns) — not because the user's question
       * asked for them. The UI hides these from the rendered table (they'd
       * otherwise show up as extra columns the user never asked to see) while
       * still keeping their values available on each row for the fetch.
       * Never includes a column the query already had for its own reasons —
       * only ones the host had to add.
       */
      hiddenColumns?: string[];
    }
  | { type: "detailResult"; fields: Record<string, string> }
  | { type: "chartSpec"; spec: Record<string, unknown>; requestId: number }
  | { type: "chartSpecError"; message: string; requestId: number }
  | {
      /**
       * One completed iteration of the run→verify→refine loop, streamed so
       * the webview can show the assistant's progress.
       */
      type: "agentStep";
      iteration: number;
      query: string;
      rowCount?: number;
      outcome:
        | "satisfied"
        | "unsatisfied"
        | "error"
        | "analyzed"
        | "ran"
        | "script";
      detail?: string;
    }
  | {
      /**
       * The final natural-language answer for a turn (from the tool loop's
       * finish, or the verify/refine path's analyze step). Shown above the
       * results table.
       */
      type: "agentAnswer";
      text: string;
    }
  | { type: "error"; message: string }
  | { type: "sessionCleared" }
  | { type: "settingsSaved" }
  | { type: "downloadProgress"; percent: number; done: boolean }
  | { type: "sqsStatus"; listening: boolean }
  | { type: "sqsMessages"; messages: SqsMessageRow[] };

/**
 * One completed iteration of the advanced (agentic) run→verify→refine loop,
 * accumulated by the webview to render a progress transcript.
 */
export interface AgentStep {
  iteration: number;
  query: string;
  rowCount?: number;
  outcome:
    | "satisfied"
    | "unsatisfied"
    | "error"
    | "analyzed"
    | "ran"
    | "script";
  detail?: string;
}

export interface Settings {
  region: string;
  destinationType: string;
  logGroupName: string;
  dynamodbTableName: string;
  auroraResourceArn: string;
  auroraSecretArn: string;
  auroraDatabase: string;
  auroraTable: string;
  sqsQueueUrl: string;
  sqsDeleteAfterRead: boolean;
  athenaDatabase: string;
  athenaTable: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
  athenaS3Location: string;
  llmProvider: string;
  awsProfile: string;
  bedrockModelId: string;
  localModel: string;
  agenticMaxIterations: string;
}

export const DEFAULT_SETTINGS: Settings = {
  region: "us-east-1",
  destinationType: "cloudwatch-logs-exporter",
  logGroupName: "",
  dynamodbTableName: "",
  auroraResourceArn: "",
  auroraSecretArn: "",
  auroraDatabase: "postgres",
  auroraTable: "workflow_insight",
  sqsQueueUrl: "",
  sqsDeleteAfterRead: false,
  athenaDatabase: "",
  athenaTable: "workflow_insight",
  athenaWorkgroup: "",
  athenaOutputLocation: "",
  athenaS3Location: "",
  llmProvider: "bedrock",
  awsProfile: "",
  bedrockModelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
  localModel: "llama-3-groq-8b-tool-use",
  agenticMaxIterations: "8",
};
