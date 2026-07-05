import { useState } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Textarea from "@cloudscape-design/components/textarea";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Alert from "@cloudscape-design/components/alert";

interface Props {
  onAsk: (question: string) => void;
  loading: boolean;
  status: string;
  error: string;
  /**
   * Compact chat composer: a bare input row (no Container/label), meant to sit
   * inside the conversation as the message box. When false (default), renders
   * the full "Ask" panel used by basic mode.
   */
  compact?: boolean;
}

export function QueryPanel({ onAsk, loading, status, error, compact }: Props) {
  const [question, setQuestion] = useState("");

  const submit = () => {
    const q = question.trim();
    if (!q || loading) return;
    onAsk(q);
    setQuestion("");
  };

  // Enter submits; Shift+Enter inserts a newline (standard chat behavior).
  const onKeyDown = (e: {
    detail: { key: string; shiftKey: boolean };
    preventDefault: () => void;
  }) => {
    if (e.detail.key === "Enter" && !e.detail.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  if (compact) {
    return (
      <SpaceBetween size="xs">
        {error && <Alert type="error">{error}</Alert>}
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <Textarea
              value={question}
              onChange={({ detail }) => setQuestion(detail.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a follow-up…  (Enter to send, Shift+Enter for a new line)"
              rows={2}
            />
          </div>
          <Button
            variant="primary"
            loading={loading}
            onClick={submit}
            disabled={!question.trim()}
          >
            Send
          </Button>
        </div>
        {status && <StatusIndicator type="loading">{status}</StatusIndicator>}
      </SpaceBetween>
    );
  }

  return (
    <Container header={<Header variant="h2">Ask</Header>}>
      <SpaceBetween size="m">
        <FormField
          label="Question"
          description="Ask in plain English. Time range is inferred from your question (defaults to last 24 hours). Press Enter to submit, Shift+Enter for a new line."
        >
          <Textarea
            value={question}
            onChange={({ detail }) => setQuestion(detail.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. show me failed executions from the last hour"
            rows={2}
          />
        </FormField>

        <SpaceBetween direction="horizontal" size="s">
          <Button
            variant="primary"
            loading={loading}
            onClick={submit}
            disabled={!question.trim()}
          >
            Ask
          </Button>
          {status && <StatusIndicator type="loading">{status}</StatusIndicator>}
        </SpaceBetween>

        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
