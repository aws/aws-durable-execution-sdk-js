/** Query execution mode chosen in the composer. */
export type QueryMode = "query" | "ask" | "agent";

/** A saved query the user can re-run from the composer. */
export interface Favorite {
  id: string;
  label: string;
  query: string;
  destinationType: string;
}

/** Messages from webview → extension host */
export type OutboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string; mode: QueryMode }
  | { type: "setMode"; mode: QueryMode }
  | { type: "setConsent"; version: string }
  | { type: "newSession" }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "testDestination"; settings: Record<string, string> }
  | { type: "listModels"; settings: Record<string, string> }
  | { type: "downloadModel"; localModel?: string }
  // Save the result table to a file (host shows a save dialog). The webview
  // builds the CSV/JSON text; the host just writes it.
  | {
      type: "exportData";
      format: "csv" | "json";
      content: string;
      filename: string;
    }
  // Save a query to favorites (host prompts for a name and persists it).
  | { type: "saveFavorite"; query: string; destinationType: string }
  | { type: "deleteFavorite"; id: string }
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

/** A single check within a destination connectivity test. Mirrors the
 * DestinationCheck shape produced by the host's destinationTest.ts. */
export interface DestinationCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

/** Result of a "Test connection" run, produced by the host. */
export interface DestinationTestReport {
  ok: boolean;
  summary: string;
  checks: DestinationCheck[];
}

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
  | { type: "destinationTestResult"; result: DestinationTestReport }
  | { type: "bedrockModels"; models?: string[]; error?: string }
  | { type: "downloadProgress"; percent: number; done: boolean }
  | { type: "sqsStatus"; listening: boolean }
  | { type: "sqsMessages"; messages: SqsMessageRow[] }
  | { type: "favorites"; favorites: Favorite[] };

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
  redshiftWorkgroupName: string;
  redshiftClusterIdentifier: string;
  redshiftDbUser: string;
  redshiftSecretArn: string;
  redshiftDatabase: string;
  redshiftTable: string;
  redshiftSchema: string;
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
  localServerUrl: string;
  localServerModel: string;
  agenticMaxIterations: string;
  queryMode: string;
  aiDisclosureAcceptedVersion: string;
}

/**
 * Version of the AI-usage disclosure. Bump this whenever the notice wording
 * changes so previously-consented users are re-prompted.
 * LEGAL: wording is pending review by the Legal team (see tracked ticket).
 *
 * Currently "2": "1" was the initial gate (features + generic data notice);
 * "2" added the per-provider data-flow breakdown, so early adopters on "1"
 * re-accept the fuller disclosure.
 */
export const AI_DISCLOSURE_VERSION = "2";

/**
 * Curated Bedrock models shown as suggestions by default (before/without
 * fetching the full account list). Hand-picked from an internal benchmark of
 * the agent-mode query task ("group by … in execution input") run against real
 * data on BOTH the Aurora (PostgreSQL) and S3/Athena (Trino) destinations:
 * these reliably discovered the right JSON keys and produced correct,
 * multi-dimension grouped SQL in both dialects. (Some models that did well only
 * on Aurora — e.g. Mistral Pixtral Large — were excluded because they were weak
 * on Athena.) The full account list is still available via the "List available
 * models" button. `us.` (US cross-region) inference profiles are used;
 * `global.`/`eu.` equivalents work too if you prefer.
 */
export const RECOMMENDED_BEDROCK_MODELS: {
  value: string;
  description: string;
}[] = [
  {
    value: "us.anthropic.claude-sonnet-5",
    description: "Recommended default — top accuracy on query tasks",
  },
  {
    value: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    description: "Excellent; a lower-cost alternative to Sonnet 5",
  },
  {
    value: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    description: "Fast and accurate — strong low-cost pick",
  },
  {
    value: "us.anthropic.claude-opus-4-5-20251101-v1:0",
    description: "Highest capability (slower/pricier)",
  },
  {
    value: "us.amazon.nova-pro-v1:0",
    description: "Strong non-Claude option (correct on Aurora + Athena)",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  region: "us-east-1",
  destinationType: "cloudwatch-logs-exporter",
  logGroupName: "",
  dynamodbTableName: "",
  auroraResourceArn: "",
  auroraSecretArn: "",
  auroraDatabase: "postgres",
  auroraTable: "workflow_insight",
  redshiftWorkgroupName: "",
  redshiftClusterIdentifier: "",
  redshiftDbUser: "",
  redshiftSecretArn: "",
  redshiftDatabase: "dev",
  redshiftTable: "workflow_insight",
  redshiftSchema: "public",
  sqsQueueUrl: "",
  sqsDeleteAfterRead: false,
  athenaDatabase: "",
  athenaTable: "workflow_insight",
  athenaWorkgroup: "",
  athenaOutputLocation: "",
  athenaS3Location: "",
  llmProvider: "bedrock",
  awsProfile: "",
  bedrockModelId: "us.anthropic.claude-sonnet-5",
  localModel: "llama-3-groq-8b-tool-use",
  localServerUrl: "http://localhost:11434/v1",
  localServerModel: "llama3.1",
  agenticMaxIterations: "8",
  queryMode: "agent",
  aiDisclosureAcceptedVersion: "",
};
