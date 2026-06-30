import { useState, useEffect } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Tabs from "@cloudscape-design/components/tabs";
import type { Settings } from "./types";
import { postMessage } from "./vscode";

interface Props {
  visible: boolean;
  settings: Settings;
  modelDownloaded: boolean;
  downloadPercent: number;
  onDismiss: () => void;
  onSave: (settings: Settings) => void;
}

const DEST_OPTIONS: SelectProps.Option[] = [
  { value: "cloudwatch-logs-exporter", label: "CloudWatch Logs (dedicated log group)" },
  { value: "lambda-log-exporter", label: "CloudWatch Logs (Lambda function log group)" },
  { value: "dynamodb", label: "DynamoDB" },
  { value: "aurora", label: "Aurora PostgreSQL" },
];

export function SettingsModal({ visible, settings, modelDownloaded, downloadPercent, onDismiss, onSave }: Props) {
  const [form, setForm] = useState<Settings>(settings);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings, visible]);

  const update = (field: keyof Settings, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const canSave = form.llmProvider !== "local" || modelDownloaded;

  const handleDownload = () => {
    setDownloading(true);
    postMessage({ type: "downloadModel" });
  };

  const dest = form.destinationType;
  const showLogGroup = dest === "cloudwatch-logs-exporter" || dest === "lambda-log-exporter";
  const showDdb = dest === "dynamodb";
  const showAurora = dest === "aurora";

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Settings"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave(form)} disabled={!canSave}>Save</Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Tabs
        tabs={[
          {
            id: "data-source",
            label: "Data Source",
            content: (
              <SpaceBetween size="m">
                <FormField label="Destination Type" description="Where your Workflow Insight records are stored">
                  <Select
                    selectedOption={DEST_OPTIONS.find((o) => o.value === form.destinationType) ?? DEST_OPTIONS[0]}
                    options={DEST_OPTIONS}
                    onChange={({ detail }) => update("destinationType", detail.selectedOption.value ?? "")}
                  />
                </FormField>

                {showLogGroup && (
                  <FormField label="Log Group Name" description="Comma-separate multiple groups">
                    <Input value={form.logGroupName} onChange={({ detail }) => update("logGroupName", detail.value)} placeholder="/workflow-insight/demo" />
                  </FormField>
                )}

                {showDdb && (
                  <FormField label="DynamoDB Table Name">
                    <Input value={form.dynamodbTableName} onChange={({ detail }) => update("dynamodbTableName", detail.value)} placeholder="workflow-insight" />
                  </FormField>
                )}

                {showAurora && (
                  <SpaceBetween size="s">
                    <FormField label="Aurora Cluster ARN">
                      <Input value={form.auroraResourceArn} onChange={({ detail }) => update("auroraResourceArn", detail.value)} placeholder="arn:aws:rds:..." />
                    </FormField>
                    <FormField label="Aurora Secret ARN">
                      <Input value={form.auroraSecretArn} onChange={({ detail }) => update("auroraSecretArn", detail.value)} placeholder="arn:aws:secretsmanager:..." />
                    </FormField>
                    <FormField label="Database">
                      <Input value={form.auroraDatabase} onChange={({ detail }) => update("auroraDatabase", detail.value)} placeholder="postgres" />
                    </FormField>
                    <FormField label="Table">
                      <Input value={form.auroraTable} onChange={({ detail }) => update("auroraTable", detail.value)} placeholder="workflow_insight" />
                    </FormField>
                  </SpaceBetween>
                )}
              </SpaceBetween>
            ),
          },
          {
            id: "general",
            label: "General",
            content: (
              <SpaceBetween size="m">
                <FormField label="AWS Region">
                  <Input value={form.region} onChange={({ detail }) => update("region", detail.value)} placeholder="us-east-1" />
                </FormField>
                <FormField label="AWS Profile" description="Leave empty to use the default credential chain (env, SSO, shared config)">
                  <Input value={form.awsProfile} onChange={({ detail }) => update("awsProfile", detail.value)} placeholder="default" />
                </FormField>
              </SpaceBetween>
            ),
          },
          {
            id: "llm",
            label: "LLM",
            content: (
              <SpaceBetween size="m">
                <FormField label="LLM Provider" description="Which model to use for converting questions to queries">
                  <Select
                    selectedOption={
                      form.llmProvider === "copilot"
                        ? { value: "copilot", label: "GitHub Copilot (VS Code built-in)" }
                        : form.llmProvider === "local"
                          ? { value: "local", label: "Local LLM (offline, ~2.2 GB download)" }
                          : { value: "bedrock", label: "Amazon Bedrock" }
                    }
                    options={[
                      { value: "bedrock", label: "Amazon Bedrock" },
                      { value: "copilot", label: "GitHub Copilot (VS Code built-in)" },
                      { value: "local", label: "Local LLM (offline, ~2.2 GB download)" },
                    ]}
                    onChange={({ detail }) => update("llmProvider", detail.selectedOption.value ?? "bedrock")}
                  />
                </FormField>

                {form.llmProvider === "bedrock" && (
                  <FormField label="Bedrock Model ID" description="Model or inference profile ID">
                    <Input value={form.bedrockModelId} onChange={({ detail }) => update("bedrockModelId", detail.value)} placeholder="us.anthropic.claude-sonnet-4-20250514-v1:0" />
                  </FormField>
                )}

                {form.llmProvider === "copilot" && (
                  <Box color="text-body-secondary">
                    Uses GitHub Copilot via the VS Code Language Model API. Requires an active Copilot subscription. No additional configuration needed.
                  </Box>
                )}

                {form.llmProvider === "local" && (
                  <SpaceBetween size="s">
                    {modelDownloaded ? (
                      <Box color="text-status-success">✓ Model downloaded and ready.</Box>
                    ) : downloading ? (
                      <ProgressBar
                        value={downloadPercent}
                        label="Downloading Qwen2.5-Coder-3B (~2.2 GB)"
                        description="This happens once. The model is stored locally for offline use."
                      />
                    ) : (
                      <SpaceBetween size="xs">
                        <Box color="text-body-secondary">
                          Runs Qwen2.5-Coder-3B locally. Fully offline after download (~2.2 GB). No API keys needed.
                        </Box>
                        <Button onClick={handleDownload}>Download Model</Button>
                      </SpaceBetween>
                    )}
                  </SpaceBetween>
                )}
              </SpaceBetween>
            ),
          },
        ]}
      />
    </Modal>
  );
}
