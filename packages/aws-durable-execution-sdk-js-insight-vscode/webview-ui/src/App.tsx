import { useState, useEffect, useCallback, useRef } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
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

interface ResultsPayload {
  columns: string[];
  rows: string[][];
  suggestedCharts?: string[];
  idColumn?: string;
  partitionColumns?: { year?: string; month?: string; day?: string };
  hiddenColumns?: string[];
  explanation?: string;
}

/**
 * A single conversation turn. Assistant turns carry the result table and agent
 * steps that were produced *for that turn*, so the conversation keeps a full
 * history — each answer shows its own table, and a follow-up question adds a
 * new turn with its own table below.
 */
type ChatTurn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      results?: ResultsPayload;
      steps?: AgentStep[];
    };

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
  const [sqsMessages, setSqsMessages] = useState<SqsMessageRow[]>([]);
  const [sqsListening, setSqsListening] = useState(false);
  const [detailFields, setDetailFields] = useState<Record<string, string> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  // Whether the current turn already produced a prose answer, so a following
  // "results" message doesn't add a duplicate/placeholder assistant bubble.
  const answeredRef = useRef(false);
  // Steps accumulated for the in-flight turn, so they can be attached to the
  // assistant turn when it completes (state alone would be stale in the
  // message handler's [] closure).
  const stepsRef = useRef<AgentStep[]>([]);

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
      case "results": {
        const payload: ResultsPayload = {
          columns: msg.columns,
          rows: msg.rows,
          suggestedCharts: msg.suggestedCharts,
          idColumn: msg.idColumn,
          partitionColumns: msg.partitionColumns,
          hiddenColumns: msg.hiddenColumns,
          explanation: msg.explanation ?? "",
        };
        // Top-level results still drive the Visualize page.
        setResults(payload);
        setStatus("");
        setLoading(false);
        // Advanced mode: attach this table (and the steps that produced it) to
        // the turn it belongs to, so the conversation keeps every result.
        const turnSteps = stepsRef.current;
        setChat((prev) => {
          if (answeredRef.current) {
            // A prose answer already created the assistant turn this turn —
            // attach the table/steps to it (the most recent assistant turn).
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              const t = copy[i];
              if (t.role === "assistant") {
                copy[i] = { ...t, results: payload, steps: turnSteps };
                break;
              }
            }
            return copy;
          }
          // No prose answer arrived: still record the turn so its table is kept.
          return [
            ...prev,
            {
              role: "assistant",
              text: "Here are the results.",
              results: payload,
              steps: turnSteps,
            },
          ];
        });
        answeredRef.current = true;
        // Steps now live on the turn; clear the live transcript + buffer.
        stepsRef.current = [];
        setAgentSteps([]);
        // A fresh result set invalidates any detail view left over from the
        // previous one (different rows, possibly a different idColumn).
        setDetailFields(null);
        setDetailLoading(false);
        break;
      }
      case "detailResult":
        setDetailFields(msg.fields);
        setDetailLoading(false);
        break;
      case "agentStep":
        {
          const step = {
            iteration: msg.iteration,
            query: msg.query,
            rowCount: msg.rowCount,
            outcome: msg.outcome,
            detail: msg.detail,
          };
          stepsRef.current = [...stepsRef.current, step];
          setAgentSteps((prev) => [...prev, step]);
        }
        break;
      case "agentAnswer":
        setChat((prev) => [...prev, { role: "assistant", text: msg.text }]);
        answeredRef.current = true;
        // Answer-only follow-ups (finish with just an answer, no query) post
        // agentAnswer and nothing else — clear loading/status here so the
        // composer re-enables. Harmless in the with-query path since the
        // following "results" also clears them.
        setLoading(false);
        setStatus("");
        break;
      case "sessionCleared":
        setChat([]);
        setResults(null);
        setAgentSteps([]);
        setDetailFields(null);
        // Belt-and-suspenders: never leave the composer disabled after a reset.
        setLoading(false);
        setStatus("");
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
    stepsRef.current = [];
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
    stepsRef.current = [];
    setDetailFields(null);
    setError("");
    setLoading(false);
    setStatus("");
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
              {settings.destinationType !== "sqs" && chat.length > 0 && (
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
                {chat.length > 0 && (
                  <Container header={<Header variant="h3">Conversation</Header>}>
                    <SpaceBetween size="l">
                      {chat.map((turn, i) =>
                        turn.role === "user" ? (
                          <Box key={i}>
                            <Box
                              fontWeight="bold"
                              color="text-status-info"
                              fontSize="body-s"
                            >
                              You
                            </Box>
                            <div style={{ whiteSpace: "pre-wrap" }}>{turn.text}</div>
                          </Box>
                        ) : (
                          <Box key={i}>
                            <Box
                              fontWeight="bold"
                              color="text-status-success"
                              fontSize="body-s"
                            >
                              Assistant
                            </Box>
                            <div style={{ whiteSpace: "pre-wrap" }}>{turn.text}</div>
                            {turn.steps && turn.steps.length > 0 && (
                              <Box padding={{ top: "xs" }}>
                                <ExpandableSection
                                  headerText="Agent steps"
                                  variant="footer"
                                >
                                  <AgentTranscript steps={turn.steps} running={false} />
                                </ExpandableSection>
                              </Box>
                            )}
                            {turn.results && (
                              <Box padding={{ top: "xs" }}>
                                <SpaceBetween size="s">
                                  <ResultsTable
                                    columns={turn.results.columns}
                                    rows={turn.results.rows}
                                    explanation={turn.results.explanation}
                                    idColumn={turn.results.idColumn}
                                    partitionColumns={turn.results.partitionColumns}
                                    hiddenColumns={turn.results.hiddenColumns}
                                    detailFields={detailFields}
                                    detailLoading={detailLoading}
                                    onDetailFetchStart={() => {
                                      // Clear the previous turn's record so the
                                      // shared modal shows a spinner, not stale
                                      // data, until this fetch resolves.
                                      setDetailFields(null);
                                      setDetailLoading(true);
                                    }}
                                    onDetailDismiss={() => setDetailFields(null)}
                                    pageSize={5}
                                  />
                                  <Button
                                    onClick={() => {
                                      setResults(turn.results!);
                                      setPage("visualize");
                                    }}
                                  >
                                    Visualize →
                                  </Button>
                                </SpaceBetween>
                              </Box>
                            )}
                          </Box>
                        ),
                      )}
                    </SpaceBetween>
                  </Container>
                )}

                {/* Live progress for the in-flight turn; it folds into the turn
                    above once the turn completes (steps move onto the turn). */}
                {loading && <AgentTranscript steps={agentSteps} running={loading} />}

                {/* Composer anchored at the bottom, chat-style, so a follow-up
                    continues the conversation above. */}
                <QueryPanel
                  onAsk={handleAsk}
                  loading={loading}
                  status={status}
                  error={error}
                />
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
