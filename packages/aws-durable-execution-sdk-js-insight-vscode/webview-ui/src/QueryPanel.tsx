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
}

export function QueryPanel({ onAsk, loading, status, error }: Props) {
  const [question, setQuestion] = useState("");

  return (
    <Container header={<Header variant="h2">Ask</Header>}>
      <SpaceBetween size="m">
        <FormField
          label="Question"
          description="Ask in plain English. Time range is inferred from your question (defaults to last 24 hours)."
        >
          <Textarea
            value={question}
            onChange={({ detail }) => setQuestion(detail.value)}
            placeholder="e.g. show me failed executions from the last hour"
            rows={2}
          />
        </FormField>

        <SpaceBetween direction="horizontal" size="s">
          <Button
            variant="primary"
            loading={loading}
            onClick={() => onAsk(question)}
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
