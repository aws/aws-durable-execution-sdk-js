import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Alert from "@cloudscape-design/components/alert";
import { ResultsTable } from "./ResultsTable";
import { postMessage } from "./vscode";
import type { SqsMessageRow } from "./types";

interface Props {
  listening: boolean;
  messages: SqsMessageRow[];
  error: string;
  queueConfigured: boolean;
  onClear: () => void;
  onVisualize: () => void;
}

export const MAX_DISPLAYED_MESSAGES = 500;

// Same priority order used by the DynamoDB destination, so records look
// consistent across destinations regardless of where they were queried from.
const COLUMN_PRIORITY = [
  "pk",
  "status",
  "functionName",
  "executionName",
  "durationMs",
  "startTime",
  "endTime",
  "emittedAt",
];

// The subset of fields shown directly in the table; everything else (input,
// output, error, operationsByName, etc.) is still available — click a row to
// see the full record.
const PRIMARY_COLUMNS = [
  "receivedAt",
  "status",
  "functionName",
  "executionName",
  "durationMs",
  "startTime",
  "endTime",
];

/**
 * Live view for the "sqs" destination type. Unlike the other destinations,
 * SQS has no query engine — this just starts/stops a long-poll listener in
 * the extension host and appends messages as they arrive, de-duplicated by
 * messageId (the same message can be re-delivered by SQS if it isn't deleted
 * after being read — see workflowInsight.sqsDeleteAfterRead).
 */
export function SqsLiveView({ listening, messages, error, queueConfigured, onClear, onVisualize }: Props) {
  const handleToggle = () => {
    postMessage({ type: listening ? "stopListening" : "startListening" });
  };

  const { columns, rows } = toTable(messages.slice(-MAX_DISPLAYED_MESSAGES));

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Live messages received from the configured SQS queue."
          actions={
            <SpaceBetween direction="horizontal" size="s">
              <Button onClick={onClear} disabled={messages.length === 0}>
                Clear
              </Button>
              <Button variant="primary" onClick={handleToggle} disabled={!queueConfigured}>
                {listening ? "Stop Listening" : "Start Listening"}
              </Button>
            </SpaceBetween>
          }
        >
          SQS Live View
        </Header>
      }
    >
      <SpaceBetween size="m">
        {!queueConfigured && (
          <Alert type="warning">
            No SQS queue configured. Click ⚙ and set the Queue URL under Data Source.
          </Alert>
        )}
        {error && <Alert type="error">{error}</Alert>}
        {listening && (
          <StatusIndicator type="in-progress">
            Listening — {messages.length} message{messages.length === 1 ? "" : "s"} received
          </StatusIndicator>
        )}
        {!listening && messages.length > 0 && (
          <StatusIndicator type="stopped">
            Stopped — {messages.length} message{messages.length === 1 ? "" : "s"} received
          </StatusIndicator>
        )}
        <ResultsTable columns={columns} rows={rows} primaryColumns={PRIMARY_COLUMNS} />
        {rows.length > 0 && (
          <Button variant="primary" onClick={onVisualize}>
            Visualize →
          </Button>
        )}
      </SpaceBetween>
    </Container>
  );
}

/**
 * Flatten SQS messages into the same columns/rows shape the other
 * destinations use. Each message body is a WorkflowInsightRecord JSON string
 * (as produced by SQSExporter) — parse it and surface its fields as columns,
 * the same way runDynamoDBQuery does for DynamoDB records, so results look
 * consistent regardless of destination. Falls back to raw columns
 * (messageId/receivedAt/body) for any message whose body isn't valid JSON.
 */
export function toTable(messages: SqsMessageRow[]): { columns: string[]; rows: string[][] } {
  if (messages.length === 0) return { columns: [], rows: [] };

  // Most recently received first.
  const ordered = [...messages].reverse();

  const parsed: Array<{ receivedAt: string; fields: Record<string, unknown> | undefined }> =
    ordered.map((m) => {
      try {
        const body = JSON.parse(m.body);
        return {
          receivedAt: m.receivedAt,
          fields: typeof body === "object" && body !== null ? body : undefined,
        };
      } catch {
        return { receivedAt: m.receivedAt, fields: undefined };
      }
    });

  if (parsed.every((p) => !p.fields)) {
    // Nothing parsed as a record — fall back to raw display.
    const columns = ["receivedAt", "messageId", "body"];
    const rows = ordered.map((m) => [m.receivedAt, m.messageId, m.body]);
    return { columns, rows };
  }

  const columnSet = new Set<string>(["receivedAt"]);
  for (const p of parsed) {
    if (p.fields) for (const key of Object.keys(p.fields)) columnSet.add(key);
  }
  const columns = [
    "receivedAt",
    ...COLUMN_PRIORITY.filter((c) => columnSet.has(c)),
    ...[...columnSet]
      .filter((c) => c !== "receivedAt" && !COLUMN_PRIORITY.includes(c))
      .sort(),
  ];

  const rows = parsed.map((p) =>
    columns.map((col) => {
      if (col === "receivedAt") return p.receivedAt;
      const val = p.fields?.[col];
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    }),
  );

  return { columns, rows };
}
