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
}

const MAX_DISPLAYED_MESSAGES = 500;

/**
 * Live view for the "sqs" destination type. Unlike the other destinations,
 * SQS has no query engine — this just starts/stops a long-poll listener in
 * the extension host and appends messages as they arrive, de-duplicated by
 * messageId (the same message can be re-delivered by SQS if it isn't deleted
 * after being read — see workflowInsight.sqsDeleteAfterRead).
 */
export function SqsLiveView({ listening, messages, error, queueConfigured, onClear }: Props) {
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
        <ResultsTable columns={columns} rows={rows} />
      </SpaceBetween>
    </Container>
  );
}

function toTable(messages: SqsMessageRow[]): { columns: string[]; rows: string[][] } {
  if (messages.length === 0) return { columns: [], rows: [] };

  // Most recently received first.
  const ordered = [...messages].reverse();
  const columns = ["receivedAt", "messageId", "body"];
  const rows = ordered.map((m) => [m.receivedAt, m.messageId, m.body]);
  return { columns, rows };
}
