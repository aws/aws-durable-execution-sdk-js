import { useState, useEffect, useCallback } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Button from "@cloudscape-design/components/button";
import { postMessage } from "./vscode";
import { QueryPanel } from "./QueryPanel";
import { ResultsTable } from "./ResultsTable";
import { VisualizePage } from "./VisualizePage";
import { SettingsModal } from "./SettingsModal";
import type { InboundMessage, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

applyMode(Mode.Dark);

type Page = "data" | "visualize";

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ columns: string[]; rows: string[][]; suggestedCharts?: string[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [page, setPage] = useState<Page>("data");
  const [explanation, setExplanation] = useState("");

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
        setResults({ columns: msg.columns, rows: msg.rows, suggestedCharts: msg.suggestedCharts });
        setExplanation(msg.explanation ?? "");
        setStatus("");
        setLoading(false);
        break;
      case "error":
        setError(msg.message);
        setStatus("");
        setLoading(false);
        break;
      case "settingsSaved":
        setSettingsOpen(false);
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
    setPage("data");
    postMessage({ type: "generate", question });
  };

  const handleSave = (s: Settings) => {
    postMessage({ type: "saveSettings", settings: s });
  };

  return (
    <div style={{ padding: "16px" }}>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          actions={
            <Button iconName="settings" variant="icon" onClick={() => setSettingsOpen(true)} />
          }
          description={
            settings.logGroupName || settings.dynamodbTableName || settings.auroraTable
              ? `${settings.region} · ${settings.destinationType}`
              : "Click ⚙ to configure"
          }
        >
          Workflow Insight Explorer
        </Header>

        {page === "data" && (
          <>
            <QueryPanel
              onAsk={handleAsk}
              loading={loading}
              status={status}
              error={error}
            />

            {results && (
              <SpaceBetween size="m">
                <ResultsTable
                  columns={results.columns}
                  rows={results.rows}
                  explanation={explanation}
                />
                <Button variant="primary" onClick={() => setPage("visualize")}>
                  Visualize →
                </Button>
              </SpaceBetween>
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
