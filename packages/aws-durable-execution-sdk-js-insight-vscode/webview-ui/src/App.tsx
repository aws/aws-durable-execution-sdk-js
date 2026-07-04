import { useState, useEffect, useCallback, useRef } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import { postMessage } from "./vscode";
import { QueryPanel } from "./QueryPanel";
import { ResultsTable } from "./ResultsTable";
import { VisualizePage } from "./VisualizePage";
import { SettingsModal } from "./SettingsModal";
import { AgentTranscript } from "./AgentTranscript";
import { SqsLiveView, toTable as sqsToTable, MAX_DISPLAYED_MESSAGES } from "./SqsLiveView";
import type { InboundMessage, Settings, SqsMessageRow, AgentStep } from "./types";
import { DEFAULT_SETTINGS } from "./types";

applyMode(Mode.Dark);

type Page = "data" | "visualize";

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<{
    columns: string[];
    rows: string[][];
    suggestedCharts?: string[];
    idColumn?: string;
    partitionColumns?: { year?: string; month?: string; day?: string };
    hiddenColumns?: string[];
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [page, setPage] = useState<Page>("data");
  const [explanation, setExplanation] = useState("");
  const [sqsMessages, setSqsMessages] = useState<SqsMessageRow[]>([]);
  const [sqsListening, setSqsListening] = useState(false);
  const [detailFields, setDetailFields] = useState<Record<string, string> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [chat, setChat] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  // Whether the current turn already produced a prose answer, so a following
  // "results" message doesn't add a duplicate/placeholder assistant bubble.
  const answeredRef = useRef(false);

  const handleMessage = useCallback((event: MessageEvent<InboundMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case "config":
        setSettings(msg.settings);
        if (msg.modelDownloaded !== undefined) setModelDownloaded(msg.modelDownloaded);
        break;
      case "status":
        setStatus(msg.text);
        setError("");
        break;
      case "downloadProgress":
        setDownloadPercent(msg.percent);
        if (msg.done) setModelDownloaded(true);
        break;
      case "results":
        setResults({ columns: msg.columns, rows: msg.rows, suggestedCharts: msg.suggestedCharts, idColumn: msg.idColumn, partitionColumns: msg.partitionColumns, hiddenColumns: msg.hiddenColumns });
        setExplanation(msg.explanation ?? "");
        setStatus("");
        setLoading(false);
        // If this turn produced no prose answer, add a placeholder assistant
        // bubble so the conversation still shows a reply for it.
        if (!answeredRef.current) {
          setChat((prev) => [
            ...prev,
            { role: "assistant", text: "Here are the results (see the table below)." },
          ]);
          answeredRef.current = true;
        }
        // A fresh result set invalidates any detail view left over from the
        // previous one (different rows, possibly a different idColumn).
        setDetailFields(null);
        setDetailLoading(false);
        break;
      case "detailResult":
        setDetailFields(msg.fields);
        setDetailLoading(false);
        break;
      case "agentStep":
        setAgentSteps((prev) => [
          ...prev,
          {
            iteration: msg.iteration,
            query: msg.query,
            rowCount: msg.rowCount,
            outcome: msg.outcome,
            detail: msg.detail,
          },
        ]);
        break;
      case "agentAnswer":
        setChat((prev) => [...prev, { role: "assistant", text: msg.text }]);
        answeredRef.current = true;
        break;
      case "sessionCleared":
        setChat([]);
        setResults(null);
        setAgentSteps([]);
        setExplanation("");
        setDetailFields(null);
        break;
      case "error":
        setError(msg.message);
        setStatus("");
        setLoading(false);
        setDetailLoading(false);
        break;
      case "settingsSaved":
        setSettingsOpen(false);
        break;
      case "sqsStatus":
        setSqsListening(msg.listening);
        break;
      case "sqsMessages":
        setSqsMessages((prev) => {
          // De-dupe by messageId: in peek-only mode (sqsDeleteAfterRead=false)
          // the same message can be re-delivered after its visibility timeout.
          const seen = new Set(prev.map((m) => m.messageId));
          const next = msg.messages.filter((m) => !seen.has(m.messageId));
          if (next.length === 0) return prev;
          // Cap at MAX_DISPLAYED_MESSAGES so a long-running listener session
          // doesn't grow this state (and the seen-set rebuild above) without
          // bound — only the most recent messages are ever shown anyway.
          const combined = [...prev, ...next];
          return combined.length > MAX_DISPLAYED_MESSAGES
            ? combined.slice(-MAX_DISPLAYED_MESSAGES)
            : combined;
        });
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const handleAsk = (question: string) => {
    setLoading(true);
    setError("");
    setResults(null);
    setAgentSteps([]);
    setPage("data");
    // Keep the chat history (this is a conversation); append the new question.
    setChat((prev) => [...prev, { role: "user", text: question }]);
    answeredRef.current = false;
    postMessage({ type: "generate", question });
  };

  const handleNewSession = () => {
    setChat([]);
    setResults(null);
    setAgentSteps([]);
    setExplanation("");
    setDetailFields(null);
    setError("");
    answeredRef.current = false;
    postMessage({ type: "newSession" });
  };

  const handleSave = (s: Settings) => {
    // The wire contract for saveSettings is all-string (matches every VS Code
    // setting key it writes through 1:1); sqsDeleteAfterRead is the only
    // boolean field in Settings, so serialize it here at the boundary.
    const wire: Record<string, string> = Object.fromEntries(
      Object.entries(s).map(([key, value]) => [key, String(value)]),
    );
    postMessage({ type: "saveSettings", settings: wire });
  };

  return (
    <div style={{ padding: "16px" }}>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {settings.agenticMode === "advanced" &&
                settings.destinationType !== "sqs" &&
                chat.length > 0 && (
                  <Button iconName="add-plus" onClick={handleNewSession}>
                    New session
                  </Button>
                )}
              <Button iconName="settings" variant="icon" onClick={() => setSettingsOpen(true)} />
            </SpaceBetween>
          }
          description={
            settings.logGroupName || settings.dynamodbTableName || settings.auroraTable || settings.sqsQueueUrl
              ? `${settings.region} · ${settings.destinationType}`
              : "Click ⚙ to configure"
          }
        >
          Workflow Insight Explorer
        </Header>

        {settings.destinationType === "sqs" ? (
          <>
            {page === "data" && (
              <SqsLiveView
                listening={sqsListening}
                messages={sqsMessages}
                error={error}
                queueConfigured={!!settings.sqsQueueUrl}
                onClear={() => setSqsMessages([])}
                onVisualize={() => setPage("visualize")}
              />
            )}

            {page === "visualize" &&
              (() => {
                const { columns, rows } = sqsToTable(
                  sqsMessages.slice(-MAX_DISPLAYED_MESSAGES),
                );
                return (
                  <VisualizePage
                    columns={columns}
                    rows={rows}
                    onBack={() => setPage("data")}
                  />
                );
              })()}
          </>
        ) : (
          <>
            {page === "data" && (
              <>
                {/* Basic mode keeps the composer at the top (single-shot Q→A). */}
                {settings.agenticMode !== "advanced" && (
                  <QueryPanel
                    onAsk={handleAsk}
                    loading={loading}
                    status={status}
                    error={error}
                  />
                )}

                {/* Advanced mode is a conversation: the history flows from the
                    top down to the composer anchored at the bottom. */}
                {settings.agenticMode === "advanced" && chat.length > 0 && (
                  <Container header={<Header variant="h3">Conversation</Header>}>
                    <SpaceBetween size="s">
                      {chat.map((turn, i) => (
                        <Box key={i}>
                          <Box
                            fontWeight="bold"
                            color={
                              turn.role === "user"
                                ? "text-status-info"
                                : "text-status-success"
                            }
                            fontSize="body-s"
                          >
                            {turn.role === "user" ? "You" : "Assistant"}
                          </Box>
                          <div style={{ whiteSpace: "pre-wrap" }}>{turn.text}</div>
                        </Box>
                      ))}
                    </SpaceBetween>
                  </Container>
                )}

                <AgentTranscript steps={agentSteps} running={loading} />

                {results && (
                  <SpaceBetween size="m">
                    <ResultsTable
                      columns={results.columns}
                      rows={results.rows}
                      explanation={explanation}
                      idColumn={results.idColumn}
                      partitionColumns={results.partitionColumns}
                      hiddenColumns={results.hiddenColumns}
                      detailFields={detailFields}
                      detailLoading={detailLoading}
                      onDetailFetchStart={() => setDetailLoading(true)}
                      onDetailDismiss={() => setDetailFields(null)}
                    />
                    <Button variant="primary" onClick={() => setPage("visualize")}>
                      Visualize →
                    </Button>
                  </SpaceBetween>
                )}

                {/* Advanced mode: composer anchored at the bottom, chat-style,
                    so asking a follow-up continues the conversation above. */}
                {settings.agenticMode === "advanced" && (
                  <QueryPanel
                    onAsk={handleAsk}
                    loading={loading}
                    status={status}
                    error={error}
                  />
                )}
              </>
            )}

            {page === "visualize" && results && (
              <VisualizePage
                columns={results.columns}
                rows={results.rows}
                suggestedCharts={results.suggestedCharts}
                onBack={() => setPage("data")}
              />
            )}
          </>
        )}

        <SettingsModal
          visible={settingsOpen}
          settings={settings}
          modelDownloaded={modelDownloaded}
          downloadPercent={downloadPercent}
          onDismiss={() => setSettingsOpen(false)}
          onSave={handleSave}
        />
      </SpaceBetween>
    </div>
  );
}
