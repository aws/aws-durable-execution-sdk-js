import { useState, useEffect } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Checkbox from "@cloudscape-design/components/checkbox";
import Alert from "@cloudscape-design/components/alert";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Tabs from "@cloudscape-design/components/tabs";
import type { Settings, DestinationTestReport } from "./types";
import { RECOMMENDED_BEDROCK_MODELS } from "./types";
import { postMessage } from "./vscode";

interface Props {
  visible: boolean;
  settings: Settings;
  modelDownloaded: boolean;
  downloadPercent: number;
  onDismiss: () => void;
  onSave: (settings: Settings) => void;
  /** True while a "Test connection" run is in flight. */
  testing: boolean;
  /** Result of the last test this session, or null if none / cleared. */
  testResult: DestinationTestReport | null;
  /** Kick off a connectivity test for the current (unsaved) form values. */
  onTest: (settings: Settings) => void;
  /** Clear a stale test result (called on open and on destination change). */
  onClearTest: () => void;
  /** Bedrock model ids fetched via "List models" (Autosuggest suggestions). */
  bedrockModels: string[];
  /** True while the model list is being fetched. */
  bedrockModelsLoading: boolean;
  /** Error from the last model-list fetch, or "" if none. */
  bedrockModelsError: string;
  /** Fetch the Bedrock models available for the current region/profile. */
  onListModels: (settings: Settings) => void;
}

const DEST_OPTIONS: SelectProps.Option[] = [
  { value: "cloudwatch-logs-exporter", label: "CloudWatch Logs (dedicated log group)" },
  { value: "lambda-log-exporter", label: "CloudWatch Logs (Lambda function log group)" },
  { value: "dynamodb", label: "DynamoDB" },
  { value: "aurora", label: "Aurora PostgreSQL" },
  { value: "redshift", label: "Amazon Redshift" },
  { value: "opensearch", label: "Amazon OpenSearch" },
  { value: "s3", label: "S3 + Athena" },
  { value: "sqs", label: "Amazon SQS (live view)" },
];

// Mirrors LOCAL_MODEL_PRESETS in src/llm.ts (the webview can't import from the
// extension host). Keep the values in sync.
const LOCAL_MODEL_OPTIONS: SelectProps.Option[] = [
  {
    value: "llama-3-groq-8b-tool-use",
    label: "Llama-3-Groq-8B Tool-Use",
    description: "Best tool-calling (BFCL ~89%) · ~4.9 GB · needs ~6 GB RAM",
  },
  {
    value: "phi-3.5-mini",
    label: "Phi-3.5-mini",
    description: "Smaller, strong quality-per-GB · ~2.4 GB",
  },
  {
    value: "qwen2.5-coder-3b",
    label: "Qwen2.5-Coder-3B",
    description: "Smallest/fastest, weakest at tool use · ~2.2 GB",
  },
];

export function SettingsModal({ visible, settings, modelDownloaded, downloadPercent, onDismiss, onSave, testing, testResult, onTest, onClearTest, bedrockModels, bedrockModelsLoading, bedrockModelsError, onListModels }: Props) {
  const [form, setForm] = useState<Settings>(settings);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings, visible]);

  // Drop any prior test result when the modal (re)opens so a stale pass/fail
  // from a previous session isn't shown against freshly-loaded settings.
  useEffect(() => {
    onClearTest();
  }, [visible, onClearTest]);

  const update = (field: keyof Settings, value: string | boolean) => {
    // Changing the destination invalidates any existing test result.
    if (field === "destinationType") onClearTest();
    setForm((f) => ({ ...f, [field]: value }));
  };

  const canSave = form.llmProvider !== "local" || modelDownloaded;

  const handleDownload = () => {
    setDownloading(true);
    postMessage({ type: "downloadModel", localModel: form.localModel });
  };

  const dest = form.destinationType;
  const showLogGroup = dest === "cloudwatch-logs-exporter" || dest === "lambda-log-exporter";
  const showDdb = dest === "dynamodb";
  const showAurora = dest === "aurora";
  const showRedshift = dest === "redshift";
  const showOpenSearch = dest === "opensearch";
  const showAthena = dest === "s3";
  const showSqs = dest === "sqs";

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

                {showRedshift && (
                  <SpaceBetween size="s">
                    <FormField label="Workgroup Name" description="Redshift Serverless workgroup. Leave empty if using a provisioned cluster.">
                      <Input value={form.redshiftWorkgroupName} onChange={({ detail }) => update("redshiftWorkgroupName", detail.value)} placeholder="insight-workgroup" />
                    </FormField>
                    <FormField label="Cluster Identifier" description="Provisioned Redshift cluster (alternative to a Serverless workgroup).">
                      <Input value={form.redshiftClusterIdentifier} onChange={({ detail }) => update("redshiftClusterIdentifier", detail.value)} placeholder="my-redshift-cluster" />
                    </FormField>
                    <FormField label="Database">
                      <Input value={form.redshiftDatabase} onChange={({ detail }) => update("redshiftDatabase", detail.value)} placeholder="dev" />
                    </FormField>
                    <FormField label="Schema">
                      <Input value={form.redshiftSchema} onChange={({ detail }) => update("redshiftSchema", detail.value)} placeholder="public" />
                    </FormField>
                    <FormField label="Table">
                      <Input value={form.redshiftTable} onChange={({ detail }) => update("redshiftTable", detail.value)} placeholder="workflow_insight" />
                    </FormField>
                    <FormField label="DB User" description="Provisioned clusters only (temporary credentials). Leave empty for Serverless or when using a Secret ARN.">
                      <Input value={form.redshiftDbUser} onChange={({ detail }) => update("redshiftDbUser", detail.value)} placeholder="admin" />
                    </FormField>
                    <FormField label="Secret ARN" description="Optional: Secrets Manager ARN for Data API auth (alternative to IAM/DB user).">
                      <Input value={form.redshiftSecretArn} onChange={({ detail }) => update("redshiftSecretArn", detail.value)} placeholder="arn:aws:secretsmanager:..." />
                    </FormField>
                  </SpaceBetween>
                )}

                {showOpenSearch && (
                  <SpaceBetween size="s">
                    <FormField label="Domain Endpoint" description="Amazon OpenSearch Service HTTPS endpoint. Authenticated with SigV4 (your AWS identity must be in the domain access policy).">
                      <Input value={form.opensearchEndpoint} onChange={({ detail }) => update("opensearchEndpoint", detail.value)} placeholder="https://my-domain.us-east-1.es.amazonaws.com" />
                    </FormField>
                    <FormField label="Index">
                      <Input value={form.opensearchIndex} onChange={({ detail }) => update("opensearchIndex", detail.value)} placeholder="workflow-insight" />
                    </FormField>
                  </SpaceBetween>
                )}

                {showAthena && (
                  <SpaceBetween size="s">
                    <FormField label="Glue Database" description="Athena/Glue database that will contain the workflow insight table">
                      <Input value={form.athenaDatabase} onChange={({ detail }) => update("athenaDatabase", detail.value)} placeholder="default" />
                    </FormField>
                    <FormField label="Glue Table">
                      <Input value={form.athenaTable} onChange={({ detail }) => update("athenaTable", detail.value)} placeholder="workflow_insight" />
                    </FormField>
                    <FormField
                      label="S3 Location"
                      description="The S3Exporter's bucket + prefix, e.g. s3://my-insight-bucket/workflow-insight/. Used to auto-create the Glue table on Save."
                    >
                      <Input value={form.athenaS3Location} onChange={({ detail }) => update("athenaS3Location", detail.value)} placeholder="s3://my-insight-bucket/workflow-insight/" />
                    </FormField>
                    <FormField
                      label="Athena Workgroup"
                      description="Leave empty to use the 'primary' workgroup and specify a result output location below instead"
                    >
                      <Input value={form.athenaWorkgroup} onChange={({ detail }) => update("athenaWorkgroup", detail.value)} placeholder="my-workgroup" />
                    </FormField>
                    <FormField
                      label="Query Result Location"
                      description="Required unless the chosen workgroup has its own output location configured"
                    >
                      <Input value={form.athenaOutputLocation} onChange={({ detail }) => update("athenaOutputLocation", detail.value)} placeholder="s3://my-insight-bucket/athena-results/" />
                    </FormField>
                    <Box color="text-body-secondary" fontSize="body-s">
                      On Save, the Explorer checks whether the Glue table exists and, if not,
                      creates it (matching the S3Exporter's JSON + Hive date partitioning) and
                      runs MSCK REPAIR TABLE to discover existing partitions.
                    </Box>
                  </SpaceBetween>
                )}

                {showSqs && (
                  <SpaceBetween size="s">
                    <FormField label="SQS Queue URL">
                      <Input
                        value={form.sqsQueueUrl}
                        onChange={({ detail }) => update("sqsQueueUrl", detail.value)}
                        placeholder="https://sqs.us-east-1.amazonaws.com/123456789012/workflow-insight"
                      />
                    </FormField>
                    <Checkbox
                      checked={form.sqsDeleteAfterRead}
                      onChange={({ detail }) => update("sqsDeleteAfterRead", detail.checked)}
                    >
                      Delete messages after displaying them
                    </Checkbox>
                    <Box color="text-body-secondary" fontSize="body-s">
                      Off by default — the Explorer only observes the queue, so other
                      consumers still receive every message. Enable only if this
                      Explorer should be the sole consumer.
                    </Box>
                  </SpaceBetween>
                )}

                <SpaceBetween size="xs">
                  <div>
                    <Button
                      onClick={() => onTest(form)}
                      loading={testing}
                      disabled={testing}
                    >
                      Test connection
                    </Button>
                  </div>
                  <Box color="text-body-secondary" fontSize="body-s">
                    Runs read-only checks against this destination (and confirms
                    the config is complete) without saving. For S3 + Athena it
                    also verifies the Glue table and runs a test query.
                  </Box>
                  {testResult && (
                    <Alert type={testResult.ok ? "success" : "error"} header={testResult.summary}>
                      {testResult.checks.length > 0 && (
                        <SpaceBetween size="xxs">
                          {testResult.checks.map((c, i) => (
                            <Box key={i}>
                              <Box
                                variant="span"
                                fontWeight="bold"
                                color={c.ok ? "text-status-success" : "text-status-error"}
                              >
                                {c.ok ? "✓" : "✗"} {c.label}
                              </Box>
                              {c.detail && (
                                <Box variant="span" color="text-body-secondary">
                                  {" "}— {c.detail}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </SpaceBetween>
                      )}
                    </Alert>
                  )}
                </SpaceBetween>
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
                <FormField
                  label="Max Iterations"
                  description="Most run→verify→refine rounds for one question (1–20). Higher digs harder on tough questions but costs more model/query calls. The loop also stops early if it repeats a query. Applies to every data source."
                >
                  <Input
                    type="number"
                    value={form.agenticMaxIterations}
                    onChange={({ detail }) => update("agenticMaxIterations", detail.value)}
                    placeholder="8"
                  />
                </FormField>

                <FormField
                  label="LLM Provider"
                  description="Model used for the AI features (Ask, Agent, and Visualize) that convert questions to queries and build charts. Query mode uses no AI."
                >
                  <Select
                    selectedOption={
                      form.llmProvider === "copilot"
                        ? { value: "copilot", label: "GitHub Copilot (VS Code built-in)" }
                        : form.llmProvider === "local"
                          ? { value: "local", label: "Local LLM (offline, ~2.2 GB download)" }
                          : form.llmProvider === "local-server"
                            ? { value: "local-server", label: "Local server (Ollama / OpenAI-compatible)" }
                            : { value: "bedrock", label: "Amazon Bedrock" }
                    }
                    options={[
                      { value: "bedrock", label: "Amazon Bedrock" },
                      { value: "copilot", label: "GitHub Copilot (VS Code built-in)" },
                      { value: "local-server", label: "Local server (Ollama / OpenAI-compatible)" },
                      { value: "local", label: "Local LLM (offline, on-device)" },
                    ]}
                    onChange={({ detail }) => update("llmProvider", detail.selectedOption.value ?? "bedrock")}
                  />
                </FormField>

                <Alert type="info" header="How your data is used">
                  When you use <b>Ask</b>, <b>Agent</b>, or <b>Visualize</b>, your
                  request and limited data (result <b>column names</b> and a{" "}
                  <b>small sample of rows</b>) are sent to the selected provider;{" "}
                  <b>Query</b> mode sends nothing.{" "}
                  {form.llmProvider === "bedrock" &&
                    "With Amazon Bedrock, that data goes to Amazon Bedrock in your configured AWS account/region, under your AWS agreement and Bedrock terms."}
                  {form.llmProvider === "copilot" &&
                    "With GitHub Copilot, that data goes to GitHub/Microsoft via the VS Code Language Model API, under your Copilot subscription terms."}
                  {form.llmProvider === "local-server" &&
                    "With a local server, that data goes only to the endpoint you run and control — no third-party cloud if it is self-hosted."}
                  {form.llmProvider === "local" &&
                    "The on-device model runs entirely on your machine; your data never leaves your computer."}{" "}
                  Data you send is subject to that provider's terms and privacy
                  policy. You consent to this on first use; clear{" "}
                  <code>workflowInsight.aiDisclosureAcceptedVersion</code> to
                  withdraw and be re-prompted.
                </Alert>

                {form.llmProvider === "bedrock" && (
                  <FormField
                    label="Bedrock Model ID"
                    description="Model or inference profile ID. Pick one your account can access, or type any value."
                  >
                    <SpaceBetween size="xs">
                      <Autosuggest
                        value={form.bedrockModelId}
                        onChange={({ detail }) => update("bedrockModelId", detail.value)}
                        options={[
                          {
                            label: "Recommended",
                            options: RECOMMENDED_BEDROCK_MODELS,
                          },
                          ...(bedrockModels.length
                            ? [
                                {
                                  label: "All available in your account",
                                  options: bedrockModels
                                    .filter(
                                      (m) =>
                                        !RECOMMENDED_BEDROCK_MODELS.some(
                                          (r) => r.value === m,
                                        ),
                                    )
                                    .map((m) => ({ value: m })),
                                },
                              ]
                            : []),
                        ]}
                        enteredTextLabel={(v) => `Use "${v}"`}
                        placeholder="us.anthropic.claude-sonnet-5"
                        empty={
                          bedrockModelsLoading
                            ? "Loading models…"
                            : "No models loaded yet — click List available models, or type an ID."
                        }
                        statusType={bedrockModelsLoading ? "loading" : "finished"}
                        loadingText="Loading models…"
                        filteringType="auto"
                        virtualScroll
                        ariaLabel="Bedrock Model ID"
                      />
                      <div>
                        <Button
                          onClick={() => onListModels(form)}
                          loading={bedrockModelsLoading}
                          iconName="refresh"
                        >
                          List available models
                        </Button>
                      </div>
                      <Box color="text-body-secondary" fontSize="body-s">
                        A curated set of recommended models is shown by default.
                        Click List available models to fetch everything your
                        Region and AWS Profile can use (inference profiles +
                        on-demand models); some may still need model access
                        granted in the Bedrock console. You can also type any
                        model / inference profile ID directly.
                      </Box>
                      {bedrockModelsError && (
                        <Alert type="error" header="Couldn't list models">
                          {bedrockModelsError}
                        </Alert>
                      )}
                    </SpaceBetween>
                  </FormField>
                )}

                {form.llmProvider === "copilot" && (
                  <Box color="text-body-secondary">
                    Uses GitHub Copilot via the VS Code Language Model API. Requires an active Copilot subscription. No additional configuration needed.
                  </Box>
                )}

                {form.llmProvider === "local-server" && (
                  <SpaceBetween size="s">
                    <Box color="text-body-secondary">
                      Runs against a local OpenAI-compatible server you host — e.g.{" "}
                      <b>Ollama</b> (<code>ollama serve</code>), LM Studio, or a
                      llama.cpp server. Start it and pull a model first (e.g.{" "}
                      <code>ollama pull llama3.1</code>). Nothing is downloaded by
                      the extension.
                    </Box>
                    <FormField
                      label="Server URL"
                      description="Base URL of the OpenAI-compatible API (chat/completions is appended)."
                    >
                      <Input
                        value={form.localServerUrl}
                        onChange={({ detail }) => update("localServerUrl", detail.value)}
                        placeholder="http://localhost:11434/v1"
                      />
                    </FormField>
                    <FormField label="Model" description="Model name the server should use.">
                      <Input
                        value={form.localServerModel}
                        onChange={({ detail }) => update("localServerModel", detail.value)}
                        placeholder="llama3.1"
                      />
                    </FormField>
                  </SpaceBetween>
                )}

                {form.llmProvider === "local" && (
                  <SpaceBetween size="s">
                    <FormField
                      label="Local Model"
                      description="Larger models answer better (especially multi-step tool use) but download bigger and need more RAM. Changing this may require a new download."
                    >
                      <Select
                        selectedOption={
                          LOCAL_MODEL_OPTIONS.find(
                            (o) => o.value === form.localModel,
                          ) ?? LOCAL_MODEL_OPTIONS[0]
                        }
                        options={LOCAL_MODEL_OPTIONS}
                        onChange={({ detail }) => {
                          setDownloading(false);
                          update(
                            "localModel",
                            detail.selectedOption.value ?? "llama-3-groq-8b-tool-use",
                          );
                        }}
                      />
                    </FormField>

                    {modelDownloaded ? (
                      <Box color="text-status-success">✓ Model downloaded and ready.</Box>
                    ) : downloading ? (
                      <ProgressBar
                        value={downloadPercent}
                        label="Downloading model…"
                        description="This happens once per model. Stored locally for offline use."
                      />
                    ) : (
                      <SpaceBetween size="xs">
                        <Box color="text-body-secondary">
                          Runs fully offline after a one-time download. No API keys needed.
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
