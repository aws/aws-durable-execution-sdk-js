import { useState } from "react";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Button from "@cloudscape-design/components/button";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Alert from "@cloudscape-design/components/alert";

interface Props {
  onAsk: (question: string) => void;
  loading: boolean;
  status: string;
  error: string;
}

/**
 * Inline chat composer that sits at the bottom of the conversation: a text
 * box + Send button. Enter submits; Shift+Enter inserts a newline. Clears
 * itself after sending.
 */
export function QueryPanel({ onAsk, loading, status, error }: Props) {
  const [question, setQuestion] = useState("");

  const submit = () => {
    const q = question.trim();
    if (!q || loading) return;
    onAsk(q);
    setQuestion("");
  };

  const onKeyDown = (e: {
    detail: { key: string; shiftKey: boolean };
    preventDefault: () => void;
  }) => {
    if (e.detail.key === "Enter" && !e.detail.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <SpaceBetween size="xs">
      {error && <Alert type="error">{error}</Alert>}
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <Textarea
            value={question}
            onChange={({ detail }) => setQuestion(detail.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question…  (Enter to send, Shift+Enter for a new line)"
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
