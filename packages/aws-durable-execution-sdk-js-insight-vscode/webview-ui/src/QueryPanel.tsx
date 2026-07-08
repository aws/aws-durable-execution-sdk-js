import { useState, useEffect } from "react";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Alert from "@cloudscape-design/components/alert";
import type { QueryMode, Favorite } from "./types";

interface Props {
  onAsk: (question: string) => void;
  mode: QueryMode;
  onModeChange: (mode: QueryMode) => void;
  starterQuery: string;
  favorites: Favorite[];
  onRunFavorite: (query: string) => void;
  loading: boolean;
  status: string;
  error: string;
}

/** Short label shown on the main Send button for each mode. */
const MODE_LABEL: Record<QueryMode, string> = {
  query: "Query",
  ask: "Ask",
  agent: "Agent",
};

/** One-line description of each mode, shown in the dropdown. */
const MODE_DESCRIPTION: Record<QueryMode, string> = {
  query: "Run your query as-is against the destination",
  ask: "Turn plain English into one query and run it",
  agent: "Let the assistant explore across queries to answer",
};

/**
 * Mode-specific composer hint. Doubles as the "default question" the user sees
 * for the active mode when the box is empty.
 */
const MODE_PLACEHOLDER: Record<QueryMode, string> = {
  query:
    "Enter a read-only query to run as-is  (e.g. SELECT * FROM workflow_insight LIMIT 50)",
  ask: "Ask in plain English — we'll write one query and run it  (e.g. show failed executions in the last hour)",
  agent:
    "Ask anything — the assistant explores across queries to answer  (e.g. why did executions slow down today?)",
};

/**
 * Inline chat composer at the bottom of the conversation: a text box + a
 * split "Send" button whose dropdown picks the query mode (query / ask /
 * agent). Enter submits in the active mode; Shift+Enter inserts a newline.
 */
export function QueryPanel({
  onAsk,
  mode,
  onModeChange,
  starterQuery,
  favorites,
  onRunFavorite,
  loading,
  status,
  error,
}: Props) {
  const [question, setQuestion] = useState("");

  // In "query" mode, prefill the box with a destination-appropriate starter
  // query so the user has a working example to edit. Only fills when the box
  // is empty (functional update, so it never clobbers text the user typed —
  // and manually clearing the box won't refill, since `question` isn't a dep).
  useEffect(() => {
    if (mode !== "query" || !starterQuery) return;
    setQuestion((prev) => (prev.trim() === "" ? starterQuery : prev));
  }, [mode, starterQuery]);

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
            placeholder={MODE_PLACEHOLDER[mode]}
            rows={2}
          />
        </div>
        <ButtonDropdown
          disabled={loading}
          items={
            favorites.length > 0
              ? favorites.map((f) => ({ id: f.id, text: f.label }))
              : [
                  {
                    id: "__none",
                    text: "No saved queries for this destination",
                    disabled: true,
                  },
                ]
          }
          onItemClick={({ detail }) => {
            const fav = favorites.find((f) => f.id === detail.id);
            if (fav) onRunFavorite(fav.query);
          }}
        >
          Favorites
        </ButtonDropdown>
        <ButtonDropdown
          variant="primary"
          loading={loading}
          mainAction={{
            text: `Send · ${MODE_LABEL[mode]}`,
            onClick: submit,
            disabled: !question.trim() || loading,
          }}
          items={(["query", "ask", "agent"] as QueryMode[]).map((m) => ({
            id: m,
            text: MODE_LABEL[m],
            description: MODE_DESCRIPTION[m],
            disabled: loading,
          }))}
          onItemClick={({ detail }) => onModeChange(detail.id as QueryMode)}
        />
      </div>
      {status && <StatusIndicator type="loading">{status}</StatusIndicator>}
    </SpaceBetween>
  );
}
