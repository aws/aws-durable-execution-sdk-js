import * as vscode from "vscode";
// randomInt, not Math.random: this nonce backs the webview CSP.
import { randomInt } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import {
  readConfig,
  resolveCredentials,
  configFromWireSettings,
} from "./config";
import { testDestination } from "./destinationTest";
import {
  deployWorkflow,
  DeployCancelledError,
  requireLambdaFunctionName,
} from "./deploy";
import {
  startDebugRun,
  type DebugRunnerHandle,
} from "./remoteDebug/debugRunner";
import {
  listDurableFunctions,
  getFunctionInfo,
  listExecutions,
  startExecution,
  getExecution,
  stopExecution,
  listWorkflowStudioFunctions,
  getWorkflowDar,
} from "./functions";
import { listResources } from "./resources";
import { listActions, reflectAction } from "./awsSdkReflect";
import {
  listApiDirectory,
  listApiOperations,
  listApiVendors,
  reflectApiOperation,
} from "./openApiReflect";
import { installCopilotBridge } from "./copilotBridge";
import { inferResultTypes, type InferItem } from "./inferTypes";
import {
  parseWorkflow,
  locateDarTsNodeLines,
  darTsNodeIdForLine,
  type PermissionAnalysis,
} from "@aws/durable-execution-sdk-js-cdk";
import { listBedrockModels } from "./bedrockModels";
import {
  generateQuery,
  verifyResult,
  analyzeResults,
  generateChartSpec,
  isModelDownloaded,
  ensureModel,
  setLocalModel,
  setLocalServer,
  type GeneratedQuery,
} from "./llm";
import { generateNodeCode, generateWorkflowDar } from "./agent";
import { importStateMachineFromArn } from "./aslImport";
import {
  deployStarterPackInfra,
  STARTER_PACKS,
  type StarterPackId,
} from "./starterPacks/registry";
import { CfnDeployCancelledError } from "./starterPacks/cfnDeploy";
import {
  QueryService,
  MAX_SQL_ROWS,
  JS_ROW_CAP,
  REQUIRED_AI_DISCLOSURE_VERSION,
  type QueryMode,
} from "./queryService";
import {
  runAgentLoop,
  type AgentQueryResult,
  type ConversationTurn,
} from "./agentLoop";
import { runLogsInsightsQuery, fetchLogsInsightsRecord } from "./logsInsights";
import { runDynamoDBQuery, fetchDynamoDBRecord } from "./dynamodb";
import { runAuroraQuery, fetchAuroraRecord } from "./aurora";
import { runRedshiftQuery, fetchRedshiftRecord } from "./redshift";
import { runOpenSearchQuery, fetchOpenSearchRecord } from "./opensearch";
import {
  runAthenaQuery,
  ensureAthenaTable,
  tableExists,
  fetchAthenaRecord,
} from "./athena";
import { listenToQueue, type SqsMessageRow } from "./sqs";
import { fetchDetailRecord } from "./detailService";
import {
  parseDarTs,
  workflowFileToJsonText,
  workflowToDarTs,
  type JsonWorkflow,
} from "./darTs";
import { ensureLimit } from "./schema";
import { assertReadOnly } from "./queryValidator";
import {
  ensureIdentifierColumn,
  isAggregateQuery,
  resolveActualColumnCasing,
  resolveActualColumns,
} from "./queryShape";

type InboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string; mode?: QueryMode }
  | { type: "setMode"; mode: QueryMode }
  | { type: "setConsent"; version: string }
  | { type: "newSession" }
  // Workflow Studio (kept in sync with OutboundMessage in
  // webview-ui/src/types.ts): save the .dar JSON the webview built, or open one.
  | { type: "saveWorkflow"; name: string; content: string }
  | { type: "toggleBreakpoint"; path: string; line: number }
  | { type: "toggleNodeBreakpoint"; path: string; nodeId: string }
  | { type: "getBreakpoints"; path: string }
  | { type: "workflowCode"; requestId: string; workflow: unknown }
  | { type: "workflowFromCode"; requestId: string; text: string }
  | { type: "openWorkflow" }
  | { type: "listStateMachines"; requestId: string }
  | { type: "listEditableFunctions"; requestId: string }
  | {
      type: "generateNodeCode";
      requestId: string;
      kind: string;
      field: string;
      name: string;
      description: string;
      scope: string[];
      inputType?: string;
      currentCode?: string;
    }
  | { type: "generateWorkflow"; requestId: string; description: string }
  | {
      type: "importStateMachine";
      requestId: string;
      arn: string;
      inlineLambdas?: boolean;
    }
  | {
      type: "deployStarterPackInfra";
      requestId: string;
      /** Starter pack id; see `./starterPacks/registry.ts`'s `StarterPackId`. */
      packId: string;
    }
  | {
      type: "cancelStarterPackDeploy";
      requestId: string;
    }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "deployWorkflow"; functionName: string; workflow: unknown }
  // Run the workflow's deployed Lambda (kept in sync with OutboundMessage
  // in webview-ui/src/types.ts): plain async durable execution, or — with
  // debug:true — a synchronous invoke held under an in-app debug run (LDK
  // layer + tunnel + our own CDP client, streamed to the webview's debug
  // panel via "debugEvent"). See onRunWorkflow.
  | {
      type: "runWorkflow";
      functionName: string;
      payload: string;
      executionName?: string;
      debug: boolean;
    }
  // In-Studio debugger (kept in sync with OutboundMessage in
  // webview-ui/src/types.ts — see its "In-Studio debugger protocol"
  // section): stepping/continue/stop for the active debug run, lazy
  // variables expansion, and live breakpoint replacement.
  | {
      type: "debugCommand";
      command: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop";
    }
  | { type: "debugGetProperties"; requestId: string; objectId: string }
  | { type: "debugSetBreakpoints"; darLines: number[] }
  // The deploy modal's answer to a "deployPermissionsRequest" — the deploy is
  // blocked until it arrives.
  | { type: "deployPermissionsResponse"; requestId: string; approved: boolean }
  // Stop the in-flight Studio deploy at its next step boundary.
  | { type: "cancelDeploy" }
  | { type: "listFunctions" }
  | { type: "getFunctionInfo"; functionName: string }
  | { type: "editFunctionWorkflow"; functionName: string }
  | { type: "listSdkActions"; clientPackage: string }
  | { type: "reflectSdkAction"; clientPackage: string; command: string }
  | { type: "listApiVendors" }
  | { type: "listApiOperations"; spec: string }
  | { type: "reflectApiOperation"; spec: string; key: string }
  | { type: "listResources"; requestId: string; resource: string }
  | {
      type: "inferTypes";
      requestId: string;
      items: InferItem[];
      seedTypes?: Record<string, string>;
      inputType?: string;
    }
  | {
      type: "listExecutions";
      functionName: string;
      qualifier?: string;
      marker?: string;
    }
  | {
      type: "startExecution";
      functionName: string;
      payload: string;
      executionName?: string;
    }
  | { type: "getExecution"; arn: string }
  | { type: "stopExecution"; arn: string }
  | { type: "getExecutionWorkflow"; arn: string; functionArn: string }
  | { type: "testDestination"; settings: Record<string, string> }
  | { type: "listModels"; settings: Record<string, string> }
  | { type: "downloadModel"; localModel?: string }
  | {
      type: "exportChart";
      format: "svg" | "png";
      content: string;
      filename?: string;
    }
  | {
      type: "exportData";
      format: "csv" | "json";
      content: string;
      filename: string;
    }
  | { type: "saveFavorite"; query: string; destinationType: string }
  | { type: "deleteFavorite"; id: string }
  // NOTE: keep this `visualize` shape in sync with OutboundMessage in
  // webview-ui/src/types.ts (host and webview message types are declared
  // separately in each project's own `src`).
  | {
      type: "visualize";
      columns: string[];
      numericColumns: string[];
      chartType?: string;
      description: string;
      requestId: number;
    }
  | { type: "startListening" }
  | { type: "stopListening" }
  | {
      type: "fetchDetail";
      idColumn: string;
      idValue: string;
      year?: string;
      month?: string;
      day?: string;
    };

/**
 * Query execution mode chosen in the composer (kept in sync with QueryMode in
 * webview-ui/src/types.ts):
 * - "query": run the user's text verbatim as a read-only query (no LLM).
 * - "ask":   one LLM NL→query translation, run once, present (no agent loop).
 * - "agent": the full agentic explore→answer loop.
 */

/** A saved query (kept in sync with Favorite in webview-ui/src/types.ts). */
interface Favorite {
  id: string;
  label: string;
  query: string;
  destinationType: string;
}

/**
 * Max rows handed to run_javascript. The model sees only a small sample, but
 * JS computes over this fuller set so aggregations aren't silently limited.
 * Bounded so a huge result can't overwhelm the sandbox/host; when the true
 * result exceeds it, the JS result reports the truncation so the model can
 * fall back to a SQL aggregate.
 */

/**
 * Hard ceiling on rows loaded from a SQL destination (Athena/Aurora/DynamoDB)
 * for one query, independent of the model-supplied LIMIT. The model is told to
 * add LIMIT 100, but nothing forces it to, and Athena's result pagination
 * otherwise pulls EVERY matching row into the extension-host process and then
 * serializes it to the webview — a large table with a LIMIT-less query would
 * blow up host memory. This is the SQL analogue of ensureLimit on the logs
 * path: a safety net well above normal result sizes (and above JS_ROW_CAP, so
 * run_javascript's fuller set isn't further clipped by it). When hit, the
 * result is marked truncated so the model/UI don't treat it as complete. It
 * bounds host memory only; per-query scan cost is a separate concern (see the
 * Athena bytes_scanned_cutoff_per_query guidance).
 */

/**
 * Default CloudWatch Logs Insights time window (24h) used for "query" mode,
 * where the user supplies the raw query but no time range (mirrors the
 * generator's own default).
 */

/**
 * Whether a query-execution error is worth asking the model to fix (a
 * malformed/invalid query) versus a hard failure (missing config, no
 * permissions) that a retry can't help. Destination-agnostic, so every
 * provider path retries on exactly the same class of errors.
 */

/**
 * Extra guidance appended to a fix-it prompt when the failure is a
 * COLUMN_NOT_FOUND (the classic "referenced an input/output JSON field as a
 * bare column" mistake). Empty for any other error.
 */

/**
 * Normalize a query for the agentic loop's "already tried this" check: trim,
 * collapse runs of whitespace, and lowercase, so trivially-different but
 * effectively-identical regenerations (reindented, recased) are recognized as
 * repeats and stop the loop instead of wasting an iteration.
 */

export function activate(context: vscode.ExtensionContext): void {
  installCopilotBridge();
  context.subscriptions.push(
    vscode.commands.registerCommand("workflowInsight.openExplorer", () => {
      ExplorerPanel.show(context.extensionUri, context.globalState);
    }),
    vscode.commands.registerCommand(
      "workflowInsight.openWorkflowStudio",
      () => {
        ExplorerPanel.show(context.extensionUri, context.globalState, "studio");
      },
    ),
  );
}

export function deactivate(): void {}

class ExplorerPanel {
  private static current: ExplorerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private listenController: AbortController | undefined;
  // Aborts an in-flight starter-pack infra deploy, keyed by requestId (see
  // onDeployStarterPackInfra/onCancelStarterPackDeploy).
  private readonly starterPackControllers = new Map<string, AbortController>();
  // View the webview should switch to once it signals "ready" (set when the
  // panel is opened via the Workflow Studio command).
  private pendingView: "explorer" | "studio" | undefined;
  // The real on-disk path of the workflow currently open in Studio's code
  // view, if any — set by onSaveWorkflow/onOpenWorkflow, mirrored from the
  // webview's own tracking (see App.tsx's workflowFilePath). Used to scope
  // onBreakpointsMaybeChanged's forwarding to the RIGHT file (VS Code's
  // onDidChangeBreakpoints fires for every file, not just this one) and as
  // the resolved target when the webview's own message omits it (defensive
  // — the webview always sends its current path, but this guards against
  // a race where the two get out of sync).
  private workflowFilePath: string | undefined;
  // The in-app debug run this panel currently owns, if any — an LDK debug
  // session driven by our own CDP client (see ./remoteDebug/debugRunner.ts),
  // streamed to the webview's debug panel; no vscode.debug session is
  // involved. Exactly one run at a time in v1: the run mutates the
  // function's $LATEST config, so two concurrent runs on any functions
  // would still fight over the single tracked teardown path here.
  private activeDebugRun: DebugRunnerHandle | undefined;
  // Deploy permission reviews awaiting an answer from the deploy modal, keyed
  // by requestId. A deploy is BLOCKED on its entry, so `dispose` must settle
  // any leftovers or the deploy promise never resolves.
  private readonly permissionsReqs = new Map<
    string,
    (approved: boolean) => void
  >();
  private permissionsReqSeq = 0;
  // Aborts the in-flight Studio deploy at its next step boundary. There is no
  // CloudFormation stack to roll back — the deploy is a sequence of direct
  // Lambda/IAM calls — so this only stops further calls; see DeployOptions.signal.
  private deployAbort: AbortController | undefined;
  // The AI query pipeline (Ask/Agent/raw), extracted to a vscode-free service
  // shared with the standalone app. It owns the conversation history.
  private readonly query = new QueryService((m) => this.post(m));

  static show(
    extensionUri: vscode.Uri,
    globalState: vscode.Memento,
    initialView?: "explorer" | "studio",
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (ExplorerPanel.current) {
      ExplorerPanel.current.panel.reveal(column);
      if (initialView)
        ExplorerPanel.current.post({ type: "navigate", view: initialView });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "workflowInsightExplorer",
      "Workflow Insight Explorer",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );
    ExplorerPanel.current = new ExplorerPanel(panel, extensionUri, globalState);
    ExplorerPanel.current.pendingView = initialView;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
  ) {
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );
    // Keeps the Workflow Studio code view's gutter in sync with VS Code's
    // REAL breakpoint list — fires for ANY change, from ANY source (a normal
    // editor tab, this panel's own onToggleBreakpoint, or VS Code itself
    // during an active debug session), so the webview never shows stale
    // state. Only forwards changes for the currently-tracked workflow path
    // (see onToggleBreakpoint/onGetBreakpoints — this.workflowFilePath).
    vscode.debug.onDidChangeBreakpoints(
      () => this.onBreakpointsMaybeChanged(),
      null,
      this.disposables,
    );
  }

  /** Validate a required non-empty string field from an inbound message. */
  private requireString(v: unknown, name: string): string {
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`Invalid message: ${name} must be a non-empty string`);
    }
    return v;
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    // Defense-in-depth: the webview is our own (CSP-locked) code, but never
    // trust the shape of an inbound message before acting on it.
    if (
      msg === null ||
      typeof msg !== "object" ||
      typeof (msg as { type?: unknown }).type !== "string"
    ) {
      return;
    }
    try {
      switch (msg.type) {
        case "ready":
          this.sendConfig();
          this.post({ type: "favorites", favorites: this.getFavorites() });
          if (this.pendingView) {
            this.post({ type: "navigate", view: this.pendingView });
            this.pendingView = undefined;
          }
          return;
        case "generate": {
          const cfg = readConfig();
          return await this.query.runGenerate(
            msg.question,
            msg.mode ?? "agent",
            cfg,
            resolveCredentials(cfg.awsProfile),
          );
        }
        case "setMode":
          return await this.onSetMode(msg.mode);
        case "setConsent":
          return await this.onSetConsent(msg.version);
        case "newSession":
          this.query.clearConversation();
          this.post({ type: "sessionCleared" });
          return;
        case "saveWorkflow":
          return await this.onSaveWorkflow(msg.name, msg.content);
        case "toggleBreakpoint":
          return this.onToggleBreakpoint(msg.path, msg.line);
        case "toggleNodeBreakpoint":
          return this.onToggleNodeBreakpoint(msg.path, msg.nodeId);
        case "getBreakpoints":
          return this.onGetBreakpoints(msg.path);
        case "workflowCode":
          try {
            this.post({
              type: "workflowCodeResult",
              requestId: msg.requestId,
              text: workflowToDarTs(msg.workflow as never),
            });
          } catch (e) {
            this.post({
              type: "workflowCodeResult",
              requestId: msg.requestId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        case "workflowFromCode":
          try {
            this.post({
              type: "workflowFromCodeResult",
              requestId: msg.requestId,
              dar: JSON.stringify(parseDarTs(msg.text)),
            });
          } catch (e) {
            this.post({
              type: "workflowFromCodeResult",
              requestId: msg.requestId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        case "openWorkflow":
          return await this.onOpenWorkflow();
        case "generateNodeCode":
          return await this.onGenerateNodeCode(msg);
        case "generateWorkflow":
          return await this.onGenerateWorkflow(msg.requestId, msg.description);
        case "listStateMachines":
          return await this.onListStateMachines(msg.requestId);
        case "listEditableFunctions":
          return await this.onListEditableFunctions(msg.requestId);
        case "importStateMachine":
          return await this.onImportStateMachine(
            msg.requestId,
            this.requireString(msg.arn, "arn"),
            msg.inlineLambdas === true,
          );
        case "deployStarterPackInfra":
          return await this.onDeployStarterPackInfra(msg.requestId, msg.packId);
        case "cancelStarterPackDeploy":
          return this.onCancelStarterPackDeploy(msg.requestId);
        case "saveSettings":
          return await this.onSaveSettings(msg.settings);
        case "deployWorkflow": {
          const fn = this.requireString(msg.functionName, "functionName");
          if (!msg.workflow || typeof msg.workflow !== "object") {
            throw new Error("Invalid message: workflow must be an object");
          }
          return await this.onDeployWorkflow(fn, msg.workflow);
        }
        case "runWorkflow":
          return await this.onRunWorkflow(
            this.requireString(msg.functionName, "functionName"),
            // Empty payload is legal — treated as "{}" (matches the CLI).
            typeof msg.payload === "string" ? msg.payload : "{}",
            typeof msg.executionName === "string" && msg.executionName.trim()
              ? msg.executionName.trim()
              : undefined,
            msg.debug === true,
          );
        case "debugCommand":
          return await this.onDebugCommand(msg.command);
        case "deployPermissionsResponse":
          return this.onDeployPermissionsResponse(
            this.requireString(msg.requestId, "requestId"),
            msg.approved === true,
          );
        case "cancelDeploy":
          return this.onCancelDeploy();
        case "debugGetProperties":
          return await this.onDebugGetProperties(
            this.requireString(msg.requestId, "requestId"),
            this.requireString(msg.objectId, "objectId"),
          );
        case "debugSetBreakpoints":
          return await this.onDebugSetBreakpoints(
            Array.isArray(msg.darLines) ? msg.darLines : [],
          );
        case "listFunctions":
          return await this.onListFunctions();
        case "getFunctionInfo":
          return await this.onGetFunctionInfo(msg.functionName);
        case "editFunctionWorkflow":
          return await this.onEditFunctionWorkflow(
            this.requireString(msg.functionName, "functionName"),
          );
        case "listSdkActions":
          return await this.onListSdkActions(
            this.requireString(msg.clientPackage, "clientPackage"),
          );
        case "reflectSdkAction":
          return await this.onReflectSdkAction(
            this.requireString(msg.clientPackage, "clientPackage"),
            this.requireString(msg.command, "command"),
          );
        case "listApiVendors":
          return this.onListApiVendors();
        case "listApiOperations":
          return await this.onListApiOperations(
            this.requireString(msg.spec, "spec"),
          );
        case "reflectApiOperation":
          return await this.onReflectApiOperation(
            this.requireString(msg.spec, "spec"),
            this.requireString(msg.key, "key"),
          );
        case "listResources":
          return await this.onListResources(msg.requestId, msg.resource);
        case "inferTypes":
          return this.onInferTypes(
            msg.requestId,
            msg.items,
            msg.seedTypes,
            msg.inputType,
          );
        case "listExecutions":
          return await this.onListExecutions(
            msg.functionName,
            msg.qualifier,
            msg.marker,
          );
        case "startExecution":
          return await this.onStartExecution(
            this.requireString(msg.functionName, "functionName"),
            msg.payload,
            msg.executionName,
          );
        case "getExecution":
          return await this.onGetExecution(msg.arn);
        case "stopExecution":
          return await this.onStopExecution(this.requireString(msg.arn, "arn"));
        case "getExecutionWorkflow":
          return await this.onGetExecutionWorkflow(msg.arn, msg.functionArn);
        case "testDestination":
          return await this.onTestDestination(msg.settings);
        case "listModels":
          return await this.onListModels(msg.settings);
        case "downloadModel":
          return await this.onDownloadModel(msg.localModel);
        case "exportChart":
          return await this.onExportChart(
            msg.format,
            msg.content,
            msg.filename,
          );
        case "exportData":
          return await this.onExportData(msg.format, msg.content, msg.filename);
        case "saveFavorite":
          return await this.onSaveFavorite(msg.query, msg.destinationType);
        case "deleteFavorite":
          return await this.onDeleteFavorite(msg.id);
        case "visualize":
          return await this.onVisualize(msg);
        case "startListening":
          return this.onStartListening();
        case "stopListening":
          return this.onStopListening();
        case "fetchDetail":
          return await this.onFetchDetail(
            msg.idColumn,
            msg.idValue,
            msg.year,
            msg.month,
            msg.day,
          );
      }
    } catch (err) {
      this.post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendConfig(): void {
    const cfg = readConfig();
    // Reflect the selected local model so isModelDownloaded() below (and any
    // local generation) targets the right file.
    setLocalModel(cfg.localModel);
    setLocalServer(cfg.localServerUrl, cfg.localServerModel);
    this.post({
      type: "config",
      settings: {
        region: cfg.region,
        destinationType: cfg.destinationType,
        logGroupName: cfg.logGroupNames.join(", "),
        dynamodbTableName: cfg.dynamodbTableName,
        auroraResourceArn: cfg.auroraResourceArn,
        auroraSecretArn: cfg.auroraSecretArn,
        auroraDatabase: cfg.auroraDatabase,
        auroraTable: cfg.auroraTable,
        redshiftWorkgroupName: cfg.redshiftWorkgroupName,
        redshiftClusterIdentifier: cfg.redshiftClusterIdentifier,
        redshiftDbUser: cfg.redshiftDbUser,
        redshiftSecretArn: cfg.redshiftSecretArn,
        redshiftDatabase: cfg.redshiftDatabase,
        redshiftTable: cfg.redshiftTable,
        redshiftSchema: cfg.redshiftSchema,
        opensearchEndpoint: cfg.opensearchEndpoint,
        opensearchIndex: cfg.opensearchIndex,
        sqsQueueUrl: cfg.sqsQueueUrl,
        sqsDeleteAfterRead: cfg.sqsDeleteAfterRead,
        showWorkflowStudio: cfg.showWorkflowStudio,
        athenaDatabase: cfg.athenaDatabase,
        athenaTable: cfg.athenaTable,
        athenaWorkgroup: cfg.athenaWorkgroup,
        athenaOutputLocation: cfg.athenaOutputLocation,
        athenaS3Location: cfg.athenaS3Location,
        llmProvider: cfg.llmProvider,
        awsProfile: cfg.awsProfile ?? "",
        bedrockModelId: cfg.bedrockModelId,
        localModel: cfg.localModel,
        localServerUrl: cfg.localServerUrl,
        localServerModel: cfg.localServerModel,
        agenticMaxIterations: String(cfg.agenticMaxIterations),
        queryMode: cfg.queryMode,
        aiDisclosureAcceptedVersion: cfg.aiDisclosureAcceptedVersion,
        dateFormat: cfg.dateFormat,
        dateVariant: cfg.dateVariant,
      },
      modelDownloaded: isModelDownloaded(),
    });
  }

  private async onTestDestination(
    settings: Record<string, string>,
  ): Promise<void> {
    // Test exactly what the user has typed in the modal (not the saved config),
    // so they can validate before committing. Failures are reported as a normal
    // result payload — not the global `error` toast — so they render inline in
    // the modal next to the Test button.
    const cfg = configFromWireSettings(settings);
    await this.respond(
      () => testDestination(cfg),
      (result) => ({ type: "destinationTestResult", result }),
      (summary) => ({
        type: "destinationTestResult",
        result: { ok: false, summary, checks: [] },
      }),
    );
  }

  private async onListModels(settings: Record<string, string>): Promise<void> {
    // Use the region/profile currently in the modal (may be unsaved) so the
    // list matches what the user is about to save. Errors are reported inline
    // via the same payload rather than the global error toast.
    const cfg = configFromWireSettings(settings);
    await this.respond(
      () =>
        listBedrockModels({
          region: cfg.region,
          credentials: resolveCredentials(cfg.awsProfile),
        }),
      (models) => ({ type: "bedrockModels", models }),
      // Omit `models` on failure so the webview keeps any previously-fetched
      // suggestions (e.g. after a retry with a typo'd profile) rather than
      // clearing the list.
      (error) => ({ type: "bedrockModels", error }),
    );
  }

  private async onSaveSettings(
    settings: Record<string, string>,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("workflowInsight");
    for (const [key, value] of Object.entries(settings)) {
      // sqsDeleteAfterRead is boolean-typed in the settings schema; the
      // webview always sends strings, so coerce it before writing. `false` is
      // a meaningful value here, so it must not be treated as "unset".
      // agenticMaxIterations is number-typed — coerce likewise (invalid/empty
      // falls back to undefined so the schema default applies).
      let coerced: string | boolean | number | undefined;
      if (
        key === "sqsDeleteAfterRead" ||
        key === "showWorkflowStudio" ||
        key === "enableDagMode"
      ) {
        coerced = value === "true";
      } else if (key === "agenticMaxIterations") {
        const n = Number(value);
        coerced = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
      } else {
        coerced = value || undefined;
      }
      await config.update(key, coerced, vscode.ConfigurationTarget.Global);
    }
    this.sendConfig();

    const cfg = readConfig();
    if (
      cfg.destinationType === "s3" &&
      cfg.athenaDatabase &&
      cfg.athenaS3Location
    ) {
      await this.onEnsureAthenaTable(cfg);
    }

    this.post({ type: "settingsSaved" });
  }

  /**
   * Auto-create (or verify) the Glue table backing Athena queries, and
   * discover any Hive partitions S3Exporter has already written. Idempotent —
   * safe to run every time settings are saved. Best-effort: surfaces failures
   * as a non-fatal warning rather than blocking settings from saving, since
   * the user may not have Glue/Athena permissions yet (or the bucket/table
   * exist already via other tooling).
   */
  private async onEnsureAthenaTable(
    cfg: ReturnType<typeof readConfig>,
  ): Promise<void> {
    const credentials = resolveCredentials(cfg.awsProfile);
    try {
      const exists = await tableExists({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        table: cfg.athenaTable,
      });
      if (exists) return;

      this.post({
        type: "status",
        text: `Creating Glue table ${cfg.athenaDatabase}.${cfg.athenaTable}...`,
      });
      await ensureAthenaTable({
        region: cfg.region,
        credentials,
        database: cfg.athenaDatabase,
        table: cfg.athenaTable,
        workgroup: cfg.athenaWorkgroup || undefined,
        outputLocation: cfg.athenaOutputLocation || undefined,
        s3Location: cfg.athenaS3Location,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({
        type: "error",
        message: `Saved settings, but couldn't auto-create the Athena table: ${msg}`,
      });
    }
  }

  private async onDownloadModel(localModel?: string): Promise<void> {
    // Download the model the user picked in settings (may not be saved yet),
    // falling back to the saved selection.
    setLocalModel(localModel ?? readConfig().localModel);
    if (isModelDownloaded()) {
      this.post({ type: "downloadProgress", percent: 100, done: true });
      return;
    }
    await ensureModel((text) => {
      const match = text.match(/(\d+)%/);
      const percent = match ? Number(match[1]) : 0;
      this.post({ type: "downloadProgress", percent, done: false });
    });
    this.post({ type: "downloadProgress", percent: 100, done: true });
  }

  private async onExportChart(
    format: "svg" | "png",
    content: string,
    filename?: string,
  ): Promise<void> {
    const ext = format === "svg" ? "svg" : "png";
    const defaultName = filename || `chart.${ext}`;
    const uri = await vscode.window.showSaveDialog({
      filters: { [format.toUpperCase()]: [ext] },
      defaultUri: vscode.Uri.file(defaultName),
    });
    if (!uri) return;

    if (format === "svg") {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    } else {
      // content is a data URL: data:image/png;base64,...
      const base64 = content.split(",")[1];
      await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, "base64"));
    }
    vscode.window.showInformationMessage(`Chart saved to ${uri.fsPath}`);
  }

  /** Save a result table (CSV/JSON text built by the webview) to a file. */
  private async onExportData(
    format: "csv" | "json",
    content: string,
    filename: string,
  ): Promise<void> {
    const ext = format === "csv" ? "csv" : "json";
    const uri = await vscode.window.showSaveDialog({
      filters: { [format.toUpperCase()]: [ext] },
      defaultUri: vscode.Uri.file(filename || `results.${ext}`),
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
    vscode.window.showInformationMessage(`Results saved to ${uri.fsPath}`);
  }

  /**
   * Save a Workflow Studio graph as a `.dar.ts` file — the only user-facing
   * format. The webview sends the JSON model text (the internal wire shape);
   * the host converts via {@link workflowToDarTs}.
   */
  private async onSaveWorkflow(name: string, content: string): Promise<void> {
    const safe =
      (name || "workflow").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
      "workflow";
    const uri = await vscode.window.showSaveDialog({
      filters: { "Durable workflow": ["dar.ts"] },
      defaultUri: vscode.Uri.file(`${safe}.dar.ts`),
    });
    if (!uri) return;
    const out = workflowToDarTs(JSON.parse(content));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(out, "utf-8"));
    // Reports the real saved path so the webview's code-view gutter can
    // target real vscode.SourceBreakpoints against it (see
    // onToggleBreakpoint/onGetBreakpoints) — a brand-new, never-saved
    // workflow has no real file to target yet, by design (see this
    // feature's design notes: breakpoints require a save first).
    this.workflowFilePath = uri.fsPath;
    this.post({ type: "workflowSaved", path: uri.fsPath });
    vscode.window.showInformationMessage(`Workflow saved to ${uri.fsPath}`);
  }

  /** Every real VS Code breakpoint currently set on `path`, as 1-based line
   *  numbers (deduplicated, ascending) — reads `vscode.debug.breakpoints`
   *  directly, so this ALWAYS reflects reality (a breakpoint added via a
   *  normal editor tab shows up here too, not just ones this panel set). */
  private breakpointLinesFor(path: string): number[] {
    const target = vscode.Uri.file(path).toString();
    const lines = new Set<number>();
    for (const bp of vscode.debug.breakpoints) {
      if (!(bp instanceof vscode.SourceBreakpoint)) continue;
      if (bp.location.uri.toString() !== target) continue;
      lines.add(bp.location.range.start.line + 1); // 0-based -> 1-based
    }
    return [...lines].sort((a, b) => a - b);
  }

  /**
   * Toggles a real `vscode.SourceBreakpoint` at `path`:`line` (1-based) —
   * removes one if it already exists there, otherwise adds one. `path` must
   * be a real file on disk (the webview only sends this once the workflow
   * has been saved — see App.tsx's `workflowFilePath`/`handleToggleBreakpoint`
   * — there is deliberately no "create the file first" fallback here: a
   * breakpoint against a file that doesn't exist yet would silently do
   * nothing useful once a real debug session tries to resolve it).
   * `onBreakpointsMaybeChanged` (registered on `vscode.debug.onDidChangeBreakpoints`
   * in the constructor) picks up the resulting change and reports the new
   * list back to the webview — this method doesn't post anything itself, to
   * keep exactly ONE code path (the event listener) responsible for keeping
   * the webview in sync, regardless of who changed the breakpoints.
   */
  private onToggleBreakpoint(path: string, line: number): void {
    const uri = vscode.Uri.file(path);
    const target = uri.toString();
    const existing = vscode.debug.breakpoints.find(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.location.uri.toString() === target &&
        bp.location.range.start.line === line - 1,
    );
    if (existing) {
      vscode.debug.removeBreakpoints([existing]);
    } else {
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(
          new vscode.Location(uri, new vscode.Position(line - 1, 0)),
        ),
      ]);
    }
  }

  /**
   * Toggles a NODE breakpoint: a node breakpoint IS a normal
   * `vscode.SourceBreakpoint` on the node's `.dar.ts` DECLARATION line (its
   * `"id": "…"` property line), so it lives in the SAME store as code
   * (body-line) breakpoints and a single reverse lookup tells the canvas and
   * the code-view gutter which lines are "node" breakpoints. Reads `path`,
   * maps `nodeId` -> decl line via the cdk's `locateDarTsNodeLines` (static
   * parse, never executed — same posture as the rest of the `.dar.ts`
   * tooling), then reuses `onToggleBreakpoint`'s exact add/remove logic. A
   * missing file or an unmapped node id is a silent no-op (there is nothing
   * real to target — mirrors `onToggleBreakpoint`'s own contract).
   * `onBreakpointsMaybeChanged` (the single sync path) posts the resulting
   * `breakpointsChanged` with the recomputed `nodeIds`.
   */
  private onToggleNodeBreakpoint(path: string, nodeId: string): void {
    let text: string;
    try {
      text = fs.readFileSync(path, "utf-8");
    } catch {
      return;
    }
    const line = locateDarTsNodeLines(text).get(nodeId);
    if (line === undefined) return;
    this.onToggleBreakpoint(path, line);
  }

  /** The node ids whose `.dar.ts` declaration line is currently a breakpoint
   *  in `path` — the reverse of a node breakpoint (see
   *  `onToggleNodeBreakpoint`). Reads `path`, runs `locateDarTsNodeLines`, and
   *  keeps every node whose decl line is in the current breakpoint set. Empty
   *  when the file can't be read (never-saved / deleted). */
  private nodeIdsForBreakpoints(path: string): string[] {
    let text: string;
    try {
      text = fs.readFileSync(path, "utf-8");
    } catch {
      return [];
    }
    const lineSet = new Set(this.breakpointLinesFor(path));
    const nodeIds: string[] = [];
    for (const [nodeId, line] of locateDarTsNodeLines(text)) {
      if (lineSet.has(line)) nodeIds.push(nodeId);
    }
    return nodeIds;
  }

  /** The node that owns `darLine` — its `.dar.ts` declaration line OR any line
   *  of its code body (the cdk's `darTsNodeIdForLine`), so the canvas can glow
   *  the running node whether the pause landed on the node's operation entry or
   *  on a statement inside its code. Undefined when `darLine` is null, belongs
   *  to no node (blank lines, the workflow literal's own scaffolding), or the
   *  tracked file can't be read. */
  private pausedNodeIdFor(darLine: number | null): string | undefined {
    if (darLine == null || !this.workflowFilePath) return undefined;
    let text: string;
    try {
      text = fs.readFileSync(this.workflowFilePath, "utf-8");
    } catch {
      return undefined;
    }
    return darTsNodeIdForLine(text, darLine);
  }

  /**
   * Asks the webview to approve the IAM permissions inferred for a deploy,
   * resolving when the deploy modal answers. Replaces a native modal dialog
   * that crammed every statement into its body text — unreadable past a
   * handful, and it put the decision in a different surface from the deploy
   * the user had just started.
   *
   * Resolves FALSE if the panel goes away while waiting (see `dispose`): the
   * deploy then proceeds without the inline policy rather than hanging on a
   * webview that can no longer answer.
   */
  private requestPermissionsApproval(
    analysis: PermissionAnalysis,
    roleName: string,
  ): Promise<boolean> {
    const requestId = `perm-${++this.permissionsReqSeq}`;
    return new Promise<boolean>((resolve) => {
      this.permissionsReqs.set(requestId, resolve);
      this.post({
        type: "deployPermissionsRequest",
        requestId,
        roleName,
        statements: analysis.statements.map((s) => ({
          actions: s.actions,
          resources: s.resources,
          source: s.source,
        })),
        warnings: analysis.warnings,
      });
    });
  }

  /** The deploy modal answered a permissions review. */
  private onDeployPermissionsResponse(
    requestId: string,
    approved: boolean,
  ): void {
    const resolve = this.permissionsReqs.get(requestId);
    if (!resolve) return; // Already answered, or a stale/unknown id.
    this.permissionsReqs.delete(requestId);
    resolve(approved);
  }

  /** Responds to the webview's initial "getBreakpoints" request — starts the
   *  code view's gutter in sync with whatever VS Code already has. */
  private onGetBreakpoints(path: string): void {
    this.workflowFilePath = path;
    this.post({
      type: "breakpointsChanged",
      path,
      lines: this.breakpointLinesFor(path),
      nodeIds: this.nodeIdsForBreakpoints(path),
    });
  }

  /**
   * Fires on EVERY breakpoint change anywhere in VS Code (added, removed, or
   * moved, from any source — a normal editor tab, `onToggleBreakpoint`
   * above, or VS Code itself during an active debug session). Only forwards
   * to the webview when `this.workflowFilePath` is set — i.e. the currently
   * open workflow has a real backing file — since without one there is
   * nothing for the webview's gutter to stay in sync with.
   */
  private onBreakpointsMaybeChanged(): void {
    if (!this.workflowFilePath) return;
    this.post({
      type: "breakpointsChanged",
      path: this.workflowFilePath,
      lines: this.breakpointLinesFor(this.workflowFilePath),
      nodeIds: this.nodeIdsForBreakpoints(this.workflowFilePath),
    });
  }

  /**
   * Deploy the current workflow as a durable Lambda (generate → bundle →
   * create/update → version → alias), streaming progress to the webview. Uses
   * the same region/credentials as the Insight side; role ARN + retention come
   * from settings (role auto-created when blank).
   */
  private async onDeployWorkflow(
    functionName: string,
    workflowJson: unknown,
  ): Promise<void> {
    this.deployAbort = new AbortController();
    try {
      const cfg = readConfig();
      const raw = vscode.workspace.getConfiguration("workflowInsight");
      const roleArn = (raw.get<string>("lambdaRoleArn") || "").trim();
      const retentionDays = raw.get<number>("deployRetentionDays") ?? 7;
      const workflow = parseWorkflow(workflowJson);
      // `.dar.ts` is the current first-class format for both authoring and
      // the deploy artifact (dar-ts-specification.md's Phase 2) — always
      // built and embedded, not just when debugging. The webview's in-memory
      // model has no backing file of its own, so this is generated fresh on
      // every deploy from its current JSON wire-format state (same
      // conversion `onSaveWorkflow`'s "Save" already applies when writing a
      // `.dar.ts` file to disk).
      //
      // The deployment record is stamped into the model FIRST so the
      // generated text's trailing `meta.deploy` block carries it — that's
      // what lets a reopened file (after a VS Code restart) still know which
      // Lambda it belongs to for one-click debugging. Injected BEFORE
      // generation (not patched into the file afterwards) so the deployed
      // text, the saved file, and the source map's sourcesContent are all
      // the same bytes.
      const workflowJsonWithDeploy = {
        ...(workflowJson as JsonWorkflow),
        deploy: {
          functionName,
          region: cfg.region,
          deployedAt: new Date().toISOString(),
        },
      };
      const darTsText = workflowToDarTs(workflowJsonWithDeploy);
      // Persist the updated deployment record into the user's real saved
      // file (when there is one) BEFORE deploying — the on-disk == deployed
      // content invariant is exactly what the darSourceAbsolutePath check
      // below relies on. `meta` sits at the file's very bottom, so this
      // rewrite never shifts function-body lines (breakpoints stay valid).
      if (this.workflowFilePath) {
        try {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(this.workflowFilePath),
            Buffer.from(darTsText, "utf-8"),
          );
        } catch {
          // Read-only/missing file — deploy proceeds; only the reopen
          // convenience is lost (and darSourceAbsolutePath won't match).
        }
      }
      this.post({
        type: "deployStatus",
        status: "progress",
        message: `Deploying "${functionName}" to ${cfg.region}…`,
      });
      // Debug info (source map + local artifacts) is ALWAYS generated now —
      // debugging a deployed workflow is a headline feature, the .dar.ts
      // source is embedded in every deploy regardless, and the map's extra
      // size/time is negligible. Persisted under the open workspace folder
      // (or, with none open, the user's home directory — NOT an OS temp dir,
      // which would defeat debugOutDir needing to outlive a single deploy
      // call) — see DeployOptions.debugOutDir's doc comment in deploy.ts for
      // the full "must be a stable location" rationale.
      const debugOutDir = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        ".workflow-studio-debug",
        requireLambdaFunctionName(functionName),
      );
      const darSourceFileName = `${functionName}.dar.ts`;
      // When the workflow open in Studio is backed by a REAL saved .dar.ts
      // whose on-disk content is byte-identical to what we're deploying,
      // record ITS absolute path as the source map's `sources` entry — the
      // webview gutter registers vscode.SourceBreakpoints against that exact
      // file, and a remote debug session only pauses on them if the mapped
      // source resolves to the same path (see darSourceAbsolutePath's doc
      // comment in deploy.ts). Content mismatch (file edited outside Studio,
      // or unsaved graph changes) means the file's line numbers can't be
      // trusted — fall back to the debugOutDir copy rather than binding
      // breakpoints to lines that may no longer mean what the map says.
      let darSourceAbsolutePath: string | undefined;
      if (this.workflowFilePath) {
        try {
          const onDisk = Buffer.from(
            await vscode.workspace.fs.readFile(
              vscode.Uri.file(this.workflowFilePath),
            ),
          ).toString("utf-8");
          if (onDisk === darTsText)
            darSourceAbsolutePath = this.workflowFilePath;
        } catch {
          // File gone/unreadable — fall back to the debugOutDir copy.
        }
      }
      const result = await deployWorkflow({
        region: cfg.region,
        credentials: resolveCredentials(cfg.awsProfile),
        functionName,
        roleArn: roleArn || undefined,
        retentionDays,
        workflow,
        darTsText,
        allowDagMode: cfg.enableDagMode,
        debugOutDir,
        darSourceFileName,
        darSourceAbsolutePath,
        onProgress: (message) =>
          this.post({ type: "deployStatus", status: "progress", message }),
        confirmOverwrite: async () => {
          const choice = await vscode.window.showWarningMessage(
            `A Lambda function named "${functionName}" already exists in ${cfg.region}. Deploying will update it and publish a new version.`,
            { modal: true },
            "Update",
          );
          return choice === "Update";
        },
        confirmPermissions: (analysis) =>
          this.requestPermissionsApproval(analysis, `${functionName}-role`),
        signal: this.deployAbort.signal,
      });
      this.post({ type: "deployStatus", status: "done", result });
    } catch (e) {
      if (e instanceof DeployCancelledError) {
        this.post({
          type: "deployStatus",
          status: "error",
          // The error's own message names what was already applied — never
          // flatten it to a bare "Cancelled", which would imply a rollback.
          message: e.message,
        });
        return;
      }
      this.post({
        type: "deployStatus",
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.deployAbort = undefined;
    }
  }

  /**
   * Cancels the in-flight deploy. Cooperative: it stops the sequence at the
   * next step boundary rather than undoing anything (no CloudFormation stack is
   * involved). Also settles any outstanding permissions review — the deploy is
   * parked awaiting that answer, so aborting alone would not wake it.
   */
  private onCancelDeploy(): void {
    for (const resolve of this.permissionsReqs.values()) resolve(false);
    this.permissionsReqs.clear();
    this.deployAbort?.abort();
  }

  /**
   * One-click remote debug of an already-deployed workflow: attaches the LDK
   * debug layer to the function's $LATEST, invokes it, and drives the
   * sandbox's V8 inspector with our own CDP client through the secure tunnel
   * (see ./remoteDebug/debugRunner.ts — no vscode.debug / js-debug session),
   * streaming the whole run to the webview's in-Studio debug panel as
   * "debugEvent" messages. Breakpoints set in Studio's code view (or the
   * `.dar.ts` file itself) seed the run; VS Code's real breakpoint list
   * stays the store (see breakpointLinesFor).
   */
  private async onRunWorkflow(
    functionName: string,
    payload: string,
    executionName: string | undefined,
    debug: boolean,
  ): Promise<void> {
    payload = payload.trim() || "{}";
    try {
      JSON.parse(payload);
    } catch {
      // A debug run's webview panel already reset to "running" on the Run
      // click — settle it with the error instead of a dialog it can't see.
      if (debug) {
        this.postDebugEvent({
          kind: "error",
          message: "The payload must be valid JSON.",
        });
      } else {
        vscode.window.showErrorMessage("The payload must be valid JSON.");
      }
      return;
    }

    // Execute and Debug are ONE flow with a flag (the webview's Run modal
    // sets it): execute = the pre-existing async durable invoke
    // (startExecution — returns immediately with the execution ARN); debug =
    // the same target function, but invoked synchronously under a remote
    // debug session so breakpoints can hold it.
    if (!debug) {
      await this.onStartExecution(functionName, payload, executionName);
      return;
    }

    // Source maps come from the last deploy-with-debug-info — computed the
    // SAME way onDeployWorkflow does, so the two always agree on where the
    // artifacts live (see debugOutDir's rationale there).
    const debugOutDir = path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
      ".workflow-studio-debug",
      requireLambdaFunctionName(functionName),
    );
    // index.js.map is the deploy's own "debug info exists" marker: without
    // it no breakpoint could ever bind, which looks like a silent failure —
    // refuse up front with the fix instead (startDebugRun re-checks, but
    // failing here keeps the error ahead of any progress noise).
    if (!fs.existsSync(path.join(debugOutDir, "index.js.map"))) {
      this.postDebugEvent({
        kind: "error",
        message:
          `No debug info found for "${functionName}". Deploy the workflow ` +
          `first (every deploy includes debug info), then try again.`,
      });
      return;
    }
    // One run at a time (see the activeDebugRun field's doc comment).
    if (this.activeDebugRun) {
      this.postDebugEvent({
        kind: "error",
        message:
          "A debug session is already running. Stop it before starting another.",
      });
      return;
    }

    // Terminal-event bookkeeping: onDone/onError can fire BEFORE
    // startDebugRun's own resolution reaches us (an invoke that settles
    // instantly after the runtime is released), so the handle is only
    // stored if the run hasn't already ended, and clearing checks identity.
    let handle: DebugRunnerHandle | undefined;
    let ended = false;
    const endRun = (): void => {
      ended = true;
      if (handle && this.activeDebugRun === handle) {
        this.activeDebugRun = undefined;
      }
    };

    const cfg = readConfig();
    try {
      // Setup takes tens of seconds (config update + tunnel + attach) — the
      // runner streams progress through onStatus, which the webview's debug
      // panel renders live, so no separate VS Code progress UI is needed.
      const started = await startDebugRun({
        region: cfg.region,
        credentials: resolveCredentials(cfg.awsProfile),
        functionName,
        payloadJson: payload,
        executionName,
        debugOutDir,
        // Seed the run with the gutter's current breakpoints — VS Code's
        // real breakpoint list is still the store (see breakpointLinesFor);
        // debugSetBreakpoints pushes later gutter changes into the run.
        initialBreakpointDarLines: this.workflowFilePath
          ? this.breakpointLinesFor(this.workflowFilePath)
          : [],
        events: {
          onStatus: (message) =>
            this.postDebugEvent({ kind: "status", message }),
          onPaused: (p) =>
            this.postDebugEvent({
              kind: "paused",
              darLine: p.darLine,
              functionName: p.functionName,
              // If the paused `.dar.ts` line IS a node's declaration line,
              // include that node id so the canvas can glow the paused node
              // (reverse of a node breakpoint — see onToggleNodeBreakpoint).
              pausedNodeId: this.pausedNodeIdFor(p.darLine),
              // The protocol's frames carry no bundleLine (the UI never
              // shows bundle coordinates) — drop it here.
              callStack: p.callStack.map((f) => ({
                functionName: f.functionName,
                darLine: f.darLine,
              })),
              scopes: p.scopes,
            }),
          onResumed: () => this.postDebugEvent({ kind: "resumed" }),
          onDone: (result) => {
            this.postDebugEvent({
              kind: "done",
              statusCode: result.statusCode,
              payload: result.payload,
              logTail: result.logTail,
            });
            endRun();
          },
          onError: (message) => {
            this.postDebugEvent({ kind: "error", message });
            endRun();
          },
        },
      });
      handle = started;
      if (!ended) {
        this.activeDebugRun = handle;
      }
      this.postDebugEvent({ kind: "started", functionName });
    } catch (e) {
      // startDebugRun tears its own partial work down before rethrowing,
      // so there is nothing to stop here.
      this.postDebugEvent({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Streams one event of the active in-app debug run to the webview (the
   *  "In-Studio debugger protocol" section in webview-ui/src/types.ts). */
  private postDebugEvent(event: Record<string, unknown>): void {
    this.post({ type: "debugEvent", event });
  }

  /**
   * A stepping/continue/stop command from the webview's debug toolbar. A
   * command with no active run (a stale click racing the run's own
   * completion) is a no-op, answered with a status line — the session is
   * simply gone, not broken.
   */
  private async onDebugCommand(
    command: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop",
  ): Promise<void> {
    const handle = this.activeDebugRun;
    if (!handle) {
      this.postDebugEvent({
        kind: "status",
        message: `Ignored "${command}" — no debug session is active.`,
      });
      return;
    }
    if (command === "stop") {
      // stop() tears everything down WITHOUT emitting onDone/onError (the
      // runner treats the invoke's settle after a user stop as fallout,
      // not a result) — synthesize the terminal event here so the webview
      // panel leaves its running state.
      this.activeDebugRun = undefined;
      await handle.stop();
      this.postDebugEvent({ kind: "error", message: "Debug session stopped." });
      return;
    }
    try {
      switch (command) {
        case "continue":
          return await handle.continue_();
        case "stepOver":
          return await handle.stepOver();
        case "stepInto":
          return await handle.stepInto();
        case "stepOut":
          return await handle.stepOut();
      }
    } catch (e) {
      // "not paused"/"stopped" rejections from racing clicks — inform,
      // don't fail the session over them.
      this.postDebugEvent({
        kind: "status",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Lazily expands a paused frame's scope (or a nested object) for the
   * webview's variables tree — replies with "debugProperties" correlated by
   * `requestId`, with `error` set when the fetch failed (session gone,
   * stale objectId after a resume, ...).
   */
  private async onDebugGetProperties(
    requestId: string,
    objectId: string,
  ): Promise<void> {
    const handle = this.activeDebugRun;
    if (!handle) {
      this.post({
        type: "debugProperties",
        requestId,
        properties: [],
        error: "No debug session is active.",
      });
      return;
    }
    try {
      const properties = await handle.getProperties(objectId);
      this.post({ type: "debugProperties", requestId, properties });
    } catch (e) {
      this.post({
        type: "debugProperties",
        requestId,
        properties: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * The user toggled gutter breakpoints DURING an active run: retranslate
   * and REPLACE the live set (the webview sends its full current line set),
   * answering with the lines that actually bound. With no active run this
   * is dropped silently — the gutter itself is owned by breakpointsChanged,
   * which is unaffected.
   */
  private async onDebugSetBreakpoints(darLines: number[]): Promise<void> {
    const handle = this.activeDebugRun;
    if (!handle) return;
    try {
      const bound = await handle.setBreakpoints(
        darLines.filter((l) => typeof l === "number" && Number.isFinite(l)),
      );
      this.postDebugEvent({ kind: "boundBreakpoints", darLines: bound });
    } catch (e) {
      this.postDebugEvent({
        kind: "status",
        message: `Couldn't update breakpoints: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
  }

  private awsContext() {
    const cfg = readConfig();
    return {
      region: cfg.region,
      credentials: resolveCredentials(cfg.awsProfile),
    };
  }

  /**
   * Runs `run`, posting the message built by `onSuccess` from its result, or
   * (on throw) the message built by `onError` from the error's string
   * message. Factors out the repeated try/catch/post-twice shape used by
   * most simple request→response handlers; callers close over any fields
   * (requestId, functionName, etc.) they need in both branches.
   */
  private async respond<T>(
    run: () => Promise<T>,
    onSuccess: (result: T) => Record<string, unknown>,
    onError: (message: string) => Record<string, unknown>,
  ): Promise<void> {
    try {
      this.post(onSuccess(await run()));
    } catch (e) {
      this.post(onError(e instanceof Error ? e.message : String(e)));
    }
  }

  /** List durable functions in the region for the picker. */
  private async onListFunctions(): Promise<void> {
    await this.respond(
      () =>
        listDurableFunctions(this.awsContext(), (partial) =>
          this.post({
            type: "functionsList",
            functions: partial,
            loading: true,
          }),
        ),
      (functions) => ({ type: "functionsList", functions, loading: false }),
      (error) => ({
        type: "functionsList",
        functions: [],
        loading: false,
        error,
      }),
    );
  }

  /** Lists account resources of a kind for a Studio "Jobs" resource picker. */
  private async onListResources(
    requestId: string,
    resource: string,
  ): Promise<void> {
    await this.respond(
      () => listResources(this.awsContext(), resource),
      (items) => ({ type: "resourceList", requestId, items }),
      (error) => ({ type: "resourceList", requestId, items: [], error }),
    );
  }

  /** Infer node result types (TS) from their code, in dependency order. */
  private onInferTypes(
    requestId: string,
    items: InferItem[],
    seedTypes?: Record<string, string>,
    inputType?: string,
  ): void {
    try {
      const types = inferResultTypes(items, seedTypes ?? {}, inputType);
      this.post({ type: "inferTypesResult", requestId, types });
    } catch (e) {
      this.post({
        type: "inferTypesResult",
        requestId,
        types: {},
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Metadata for one durable function. */
  private async onGetFunctionInfo(functionName: string): Promise<void> {
    await this.respond(
      () => getFunctionInfo(this.awsContext(), functionName),
      (info) => ({ type: "functionInfo", info }),
      (error) => ({ type: "functionInfo", info: null, error }),
    );
  }

  /** A page of durable executions for a function. */
  private async onListExecutions(
    functionName: string,
    qualifier?: string,
    marker?: string,
  ): Promise<void> {
    await this.respond(
      () =>
        listExecutions(this.awsContext(), { functionName, qualifier, marker }),
      ({ executions, nextMarker }) => ({
        type: "executionsList",
        functionName,
        executions,
        nextMarker,
      }),
      (error) => ({
        type: "executionsList",
        functionName,
        executions: [],
        error,
      }),
    );
  }

  /** Start a new execution (async invoke); returns the execution ARN. */
  private async onStartExecution(
    functionName: string,
    payload: string,
    executionName?: string,
  ): Promise<void> {
    await this.respond(
      () =>
        startExecution(this.awsContext(), {
          functionName,
          payload,
          executionName,
        }),
      (res) => ({
        type: "executionStarted",
        functionName,
        durableExecutionArn: res.durableExecutionArn,
        statusCode: res.statusCode,
      }),
      (error) => ({ type: "executionStarted", functionName, error }),
    );
  }

  /** Detail for one durable execution. */
  private async onGetExecution(arn: string): Promise<void> {
    await this.respond(
      () => getExecution(this.awsContext(), arn),
      (detail) => ({ type: "executionDetail", detail }),
      (error) => ({ type: "executionDetail", detail: null, error }),
    );
  }

  /**
   * Stops a running durable execution (gated behind a confirmation prompt),
   * then re-fetches its detail so the view reflects the STOPPED status.
   */
  private async onStopExecution(arn: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Stop this durable execution? It will be marked STOPPED and cannot resume.",
      { modal: true },
      "Stop execution",
    );
    if (choice !== "Stop execution") return;
    try {
      await stopExecution(this.awsContext(), arn);
      vscode.window.showInformationMessage("Stop requested.");
      const detail = await getExecution(this.awsContext(), arn);
      this.post({ type: "executionDetail", detail });
    } catch (e) {
      vscode.window.showErrorMessage(
        `Couldn't stop execution: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Generates the TypeScript for one node field from a natural-language
   * description via the configured LLM provider (Studio "agent" buttons).
   */
  private async onGenerateNodeCode(msg: {
    requestId: string;
    kind: string;
    field: string;
    name: string;
    description: string;
    scope: string[];
    inputType?: string;
    currentCode?: string;
  }): Promise<void> {
    await this.respond(
      () => {
        const cfg = readConfig();
        setLocalModel(cfg.localModel);
        setLocalServer(cfg.localServerUrl, cfg.localServerModel);
        return generateNodeCode(
          {
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials: resolveCredentials(cfg.awsProfile),
            modelId: cfg.bedrockModelId,
          },
          {
            kind: msg.kind,
            field: msg.field,
            name: msg.name,
            description: msg.description,
            scope: msg.scope,
            inputType: msg.inputType,
            currentCode: msg.currentCode,
          },
        );
      },
      (code) => ({ type: "agentNodeCode", requestId: msg.requestId, code }),
      (error) => ({
        type: "agentNodeCode",
        requestId: msg.requestId,
        error,
      }),
    );
  }

  /**
   * Generates a whole workflow `.dar` from a natural-language description via the
   * configured LLM provider (Studio header "Agent" button). Returns the `.dar`
   * JSON text, which the webview loads onto the canvas.
   */
  private async onGenerateWorkflow(
    requestId: string,
    description: string,
  ): Promise<void> {
    await this.respond(
      () => {
        const cfg = readConfig();
        setLocalModel(cfg.localModel);
        setLocalServer(cfg.localServerUrl, cfg.localServerModel);
        return generateWorkflowDar(
          {
            provider: cfg.llmProvider,
            region: cfg.region,
            credentials: resolveCredentials(cfg.awsProfile),
            modelId: cfg.bedrockModelId,
          },
          description,
        );
      },
      (dar) => ({ type: "agentWorkflow", requestId, dar }),
      (error) => ({ type: "agentWorkflow", requestId, error }),
    );
  }

  /** Lists the account's Step Functions state machines for the import picker. */
  private async onListStateMachines(requestId: string): Promise<void> {
    await this.respond(
      () => listResources(this.awsContext(), "stateMachineArn"),
      (items) => ({ type: "resourceList", requestId, items }),
      (error) => ({ type: "resourceList", requestId, items: [], error }),
    );
  }

  /**
   * Imports a Step Functions state machine: fetches its ASL definition and
   * converts it to a `.dar` (hybrid skeleton + agent bodies + validate/judge
   * loop). Returns the `.dar` via `agentWorkflow` so the webview loads it onto
   * the canvas using the same path as AI generation. Notes/faithfulness are
   * surfaced via the `dar`'s conversion notes shown by the webview.
   */
  private async onImportStateMachine(
    requestId: string,
    arn: string,
    inlineLambdas: boolean,
  ): Promise<void> {
    try {
      const cfg = readConfig();
      setLocalModel(cfg.localModel);
      setLocalServer(cfg.localServerUrl, cfg.localServerModel);
      const result = await importStateMachineFromArn({
        ctx: this.awsContext(),
        arn,
        llmOptions: {
          provider: cfg.llmProvider,
          region: cfg.region,
          credentials: resolveCredentials(cfg.awsProfile),
          modelId: cfg.bedrockModelId,
        },
        maxIterations: cfg.agenticMaxIterations,
        inlineLambdas,
        onEvent: (ev) =>
          this.post({ type: "importProgress", requestId, ...ev }),
      });
      this.post({
        type: "agentWorkflow",
        requestId,
        dar: result.dar,
        notes: result.notes,
        faithful: result.faithful,
      });
    } catch (e) {
      this.post({
        type: "agentWorkflow",
        requestId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Deploys a Step Functions starter pack's supporting infra (a CFN stack)
   * and resolves the pack's `.dar` workflow from the stack's outputs, posting
   * `starterPackInfraProgress` for each phase (mirrors `onImportStateMachine`'s
   * progress-then-result shape). Dispatches by `packId` to the right pack via
   * `./starterPacks/registry.ts`'s `STARTER_PACKS`/`deployStarterPackInfra`.
   * Does NOT deploy the resulting `.dar` as a durable Lambda; that's a
   * separate `deployWorkflow` call the webview triggers afterward.
   */
  private async onDeployStarterPackInfra(
    requestId: string,
    packId: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.starterPackControllers.set(requestId, controller);
    try {
      if (!Object.prototype.hasOwnProperty.call(STARTER_PACKS, packId)) {
        throw new Error(`Unknown starter pack id "${packId}".`);
      }
      const result = await deployStarterPackInfra(packId as StarterPackId, {
        ...this.awsContext(),
        signal: controller.signal,
        onProgress: (progress) =>
          this.post({
            type: "starterPackInfraProgress",
            requestId,
            message: progress.message,
            resources: progress.resources,
          }),
      });
      this.post({
        type: "starterPackInfraResult",
        requestId,
        dar: result.dar,
      });
    } catch (e) {
      this.post({
        type: "starterPackInfraResult",
        requestId,
        error: e instanceof Error ? e.message : String(e),
        cancelled: e instanceof CfnDeployCancelledError,
      });
    } finally {
      this.starterPackControllers.delete(requestId);
    }
  }

  /** Cancels an in-flight starter-pack infra deploy (see `onDeployStarterPackInfra`). */
  private onCancelStarterPackDeploy(requestId: string): void {
    this.starterPackControllers.get(requestId)?.abort();
  }

  /**
   * Fetches the `.dar` embedded in the execution's function (if it was deployed
   * from Studio / the CDK construct) so the Execution Detail view can draw the
   * workflow graph. Returns `null` dar when the function has no embedded shape.
   */
  private async onGetExecutionWorkflow(
    arn: string,
    functionArn: string,
  ): Promise<void> {
    await this.respond(
      async () => {
        const raw = await getWorkflowDar(this.awsContext(), functionArn);
        // getWorkflowDar returns whichever format was embedded (.dar.ts or
        // the legacy JSON .dar) as raw text — normalize to JSON-model text
        // for the graph-drawing webview, same as onOpenWorkflow already does
        // for a locally-opened file.
        return raw == null ? null : workflowFileToJsonText(raw);
      },
      (dar) => ({ type: "executionWorkflow", arn, dar: dar ?? undefined }),
      (error) => ({ type: "executionWorkflow", arn, error }),
    );
  }

  /** Open a workflow file and hand JSON model text to the webview. */
  private async onOpenWorkflow(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Open workflow",
      filters: {
        "Durable workflow": ["dar.ts", "dar"],
        "All files": ["*"],
      },
    });
    if (!uris || uris.length === 0) return;
    const uri = uris[0];
    const bytes = await vscode.workspace.fs.readFile(uri);
    const raw = Buffer.from(bytes).toString("utf-8");
    let content: string;
    try {
      // Sniffs content (legacy JSON vs .dar.ts) — static parse, never executed.
      content = workflowFileToJsonText(raw);
    } catch (e) {
      vscode.window.showErrorMessage(
        e instanceof Error ? e.message : String(e),
      );
      return;
    }
    const name =
      uri.path
        .split("/")
        .pop()
        ?.replace(/\.dar(\.ts)?$/i, "") ?? "workflow";
    this.workflowFilePath = uri.fsPath;
    this.post({ type: "workflowLoaded", name, content, path: uri.fsPath });
  }

  /**
   * Loads a specific durable function's embedded `.dar` (by name) and hands it
   * to the webview to edit in Workflow Studio — backs the "Edit" button on the
   * Durable Functions view, shown only for editable (tagged) functions.
   */
  private async onEditFunctionWorkflow(functionName: string): Promise<void> {
    try {
      const raw = await getWorkflowDar(this.awsContext(), functionName);
      if (raw == null) {
        vscode.window.showErrorMessage(
          `"${functionName}" has no embedded workflow.dar.ts to edit.`,
        );
        return;
      }
      // Normalize whichever format was embedded (.dar.ts or the legacy JSON
      // .dar) to JSON-model text — same conversion onOpenWorkflow already
      // applies for a locally-opened file.
      const content = workflowFileToJsonText(raw);
      // No real local file backs this content — clear the tracked path so
      // the code view's breakpoint gutter correctly shows "save to set
      // breakpoints" instead of stale state from whatever was open before.
      this.workflowFilePath = undefined;
      this.post({ type: "workflowLoaded", name: functionName, content });
    } catch (e) {
      vscode.window.showErrorMessage(
        `Couldn't open "${functionName}" in Workflow Studio: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** List an AWS SDK client's operations (loading it on demand). */
  private async onListSdkActions(clientPackage: string): Promise<void> {
    await this.respond(
      () => listActions(clientPackage),
      (info) => ({ type: "sdkActions", ...info }),
      (error) => ({ type: "sdkActions", clientPackage, error }),
    );
  }

  /** Reflect one AWS SDK operation's input shape into fields + a JSON skeleton. */
  private async onReflectSdkAction(
    clientPackage: string,
    command: string,
  ): Promise<void> {
    await this.respond(
      () => reflectAction(clientPackage, command),
      (shape) => ({ type: "sdkActionShape", clientPackage, ...shape }),
      (error) => ({
        type: "sdkActionShape",
        clientPackage,
        command,
        error,
      }),
    );
  }

  /** The static third-party API catalog + community directory (no network). */
  private onListApiVendors(): void {
    const dir = listApiDirectory();
    this.post({
      type: "apiVendors",
      vendors: listApiVendors(),
      directory: dir.entries,
      directoryGeneratedAt: dir.generatedAt,
    });
  }

  /** List a third-party API's operations from the vendor's own OpenAPI spec. */
  private async onListApiOperations(spec: string): Promise<void> {
    await this.respond(
      () => listApiOperations(spec),
      (info) => ({ type: "apiOperations", ...info }),
      (error) => ({ type: "apiOperations", specId: spec, error }),
    );
  }

  /** Reflect one API operation into url/params/body for a `httpCall` node. */
  private async onReflectApiOperation(
    spec: string,
    key: string,
  ): Promise<void> {
    await this.respond(
      () => reflectApiOperation(spec, key),
      (shape) => ({ type: "apiOperationShape", specId: spec, ...shape }),
      (error) => ({ type: "apiOperationShape", specId: spec, key, error }),
    );
  }

  /**
   * Lists durable functions with an embedded `.dar` for the webview's "Edit a
   * durable function" modal (used by both hosts — desktop has no native
   * scrollable/searchable picker, so this keeps the UI consistent and correct
   * for accounts with more functions than fit in a handful of buttons).
   */
  private async onListEditableFunctions(requestId: string): Promise<void> {
    await this.respond(
      () => listWorkflowStudioFunctions(this.awsContext()),
      (functions) => ({
        type: "resourceList",
        requestId,
        items: functions.map((f) => ({ label: f.name, value: f.name })),
      }),
      (error) => ({ type: "resourceList", requestId, items: [], error }),
    );
  }

  private readonly favoritesKey = "workflowInsight.favorites";

  private getFavorites(): Favorite[] {
    return this.globalState.get<Favorite[]>(this.favoritesKey, []);
  }

  private async setFavorites(list: Favorite[]): Promise<void> {
    await this.globalState.update(this.favoritesKey, list);
    this.post({ type: "favorites", favorites: list });
  }

  /** Prompt for a name, then persist the query to favorites (globalState). */
  private async onSaveFavorite(
    query: string,
    destinationType: string,
  ): Promise<void> {
    const suggested = query.length > 60 ? `${query.slice(0, 57)}...` : query;
    const label = await vscode.window.showInputBox({
      prompt: "Name this saved query",
      value: suggested,
      validateInput: (v) => (v.trim() ? null : "Enter a name."),
    });
    if (label === undefined) return; // cancelled
    const fav: Favorite = {
      id: randomUUID(),
      label: label.trim(),
      query,
      destinationType,
    };
    await this.setFavorites([...this.getFavorites(), fav]);
    vscode.window.showInformationMessage(`Saved query "${fav.label}".`);
  }

  private async onDeleteFavorite(id: string): Promise<void> {
    await this.setFavorites(this.getFavorites().filter((f) => f.id !== id));
  }

  /**
   * Free-text "describe how to visualize" on the Visualize page: ask the model
   * to map the request onto the fetched columns and return a Vega-Lite spec.
   * Only column names/types + the description are sent, never the row data.
   */
  private async onVisualize(msg: {
    columns: string[];
    numericColumns: string[];
    chartType?: string;
    description: string;
    requestId: number;
  }): Promise<void> {
    const cfg = readConfig();
    // Visualize builds the chart spec with the LLM — enforce consent host-side
    // too (defense in depth); reply as a chartSpecError so the webview clears
    // its loading state.
    if (cfg.aiDisclosureAcceptedVersion !== REQUIRED_AI_DISCLOSURE_VERSION) {
      this.post({
        type: "chartSpecError",
        message:
          "AI features require accepting the AI-usage disclosure first. Please try again and accept the notice.",
        requestId: msg.requestId,
      });
      return;
    }
    setLocalModel(cfg.localModel);
    setLocalServer(cfg.localServerUrl, cfg.localServerModel);
    const credentials = resolveCredentials(cfg.awsProfile);
    try {
      const spec = await generateChartSpec({
        provider: cfg.llmProvider,
        region: cfg.region,
        credentials,
        modelId: cfg.bedrockModelId,
        columns: msg.columns,
        numericColumns: msg.numericColumns,
        chartType: msg.chartType,
        description: msg.description,
      });
      this.post({ type: "chartSpec", spec, requestId: msg.requestId });
    } catch (err) {
      this.post({
        type: "chartSpecError",
        message: err instanceof Error ? err.message : String(err),
        requestId: msg.requestId,
      });
    }
  }

  private onStartListening(): void {
    if (this.listenController) return; // already listening
    const cfg = readConfig();
    if (!cfg.sqsQueueUrl) {
      this.post({
        type: "error",
        message: "No SQS queue configured. Set workflowInsight.sqsQueueUrl.",
      });
      return;
    }

    const controller = new AbortController();
    this.listenController = controller;
    this.post({ type: "sqsStatus", listening: true });

    void listenToQueue({
      region: cfg.region,
      credentials: resolveCredentials(cfg.awsProfile),
      queueUrl: cfg.sqsQueueUrl,
      deleteAfterRead: cfg.sqsDeleteAfterRead,
      signal: controller.signal,
      onMessages: (messages: SqsMessageRow[]) =>
        this.post({ type: "sqsMessages", messages }),
      onError: (error) => this.post({ type: "error", message: error.message }),
    }).finally(() => {
      // Only clear/notify if this call owns the current controller — a newer
      // start/stop may have already replaced it.
      if (this.listenController === controller) {
        this.listenController = undefined;
        this.post({ type: "sqsStatus", listening: false });
      }
    });
  }

  private onStopListening(): void {
    this.listenController?.abort();
    this.listenController = undefined;
    this.post({ type: "sqsStatus", listening: false });
  }

  private async onSetMode(mode: QueryMode): Promise<void> {
    await vscode.workspace
      .getConfiguration("workflowInsight")
      .update("queryMode", mode, vscode.ConfigurationTarget.Global);
  }

  /**
   * Record the user's acceptance of the AI-usage disclosure (the version of the
   * notice they agreed to). Stored in settings so it persists and is auditable;
   * a version bump re-prompts. Gating happens in the webview before any LLM
   * call, but persisting here keeps the decision durable.
   */
  private async onSetConsent(version: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("workflowInsight")
      .update(
        "aiDisclosureAcceptedVersion",
        version,
        vscode.ConfigurationTarget.Global,
      );
  }

  /**
   * Host-side AI-usage consent check (defense in depth). The webview gates AI
   * actions behind the disclosure modal, but we re-verify here so a replayed or
   * malformed message can't reach the LLM without accepted consent. Returns
   * true when the stored acceptance matches the current disclosure version.
   */
  private async onFetchDetail(
    idColumn: string,
    idValue: string,
    year?: string,
    month?: string,
    day?: string,
  ): Promise<void> {
    const cfg = readConfig();
    const credentials = resolveCredentials(cfg.awsProfile);
    try {
      const record = await fetchDetailRecord(cfg, credentials, {
        idValue,
        year,
        month,
        day,
      });

      if (!record) {
        this.post({
          type: "error",
          message: `Couldn't find a record for ${idColumn} = ${idValue}.`,
        });
        return;
      }
      this.post({ type: "detailResult", fields: record });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({
        type: "error",
        message: `Failed to fetch record detail: ${msg}`,
      });
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    // Cache-bust the webview assets: VS Code caches them by URI, so without a
    // changing query param a rebuilt media/webview.js|css can be served stale
    // even after relaunching. Keying on the bundle's mtime changes the URI
    // whenever the build changes, forcing a reload.
    const version = this.assetVersion(extensionUri);
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.js"))
      .with({ query: `v=${version}` });
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview.css"))
      .with({ query: `v=${version}` });
    // Base URI for the bundled Monaco workers (media/monaco/*.worker.js),
    // injected below so the webview can spawn them.
    const monacoBase = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "monaco"),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      // Monaco spawns its language workers via a same-origin blob that
      // importScripts the bundled worker (served from cspSource).
      `script-src 'nonce-${nonce}' ${webview.cspSource} blob:`,
      `worker-src ${webview.cspSource} blob:`,
      `font-src ${webview.cspSource} data:`,
      `img-src ${webview.cspSource} data: blob:`,
      // cspSource lets us fetch the bundled Monaco worker sources (wrapped in
      // same-origin blobs) for the in-browser TS language service.
      `connect-src ${webview.cspSource} data: blob:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Workflow Insight Explorer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">globalThis.__MONACO_WORKER_BASE__ = ${JSON.stringify(String(monacoBase))};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ExplorerPanel.current = undefined;
    this.listenController?.abort();
    this.listenController = undefined;
    // A live debug run holds AWS-side state (mutated function config +
    // tunnel) — tear it down with the panel. stop() is idempotent and never
    // throws; any events it would emit have nowhere to go anymore.
    if (this.activeDebugRun) {
      void this.activeDebugRun.stop();
      this.activeDebugRun = undefined;
    }
    // A deploy awaiting a permissions review would otherwise never resolve —
    // the webview that owed the answer is gone. Deny (deploy without the
    // inline policy) rather than leave the promise dangling.
    for (const resolve of this.permissionsReqs.values()) resolve(false);
    this.permissionsReqs.clear();
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  /**
   * A version token for the webview assets, derived from media/webview.js's
   * last-modified time, so the asset URLs change whenever the bundle is
   * rebuilt (defeating VS Code's webview asset cache). Also logged on open so
   * you can confirm which build is actually running.
   */
  private assetVersion(extensionUri: vscode.Uri): string {
    try {
      const p = vscode.Uri.joinPath(extensionUri, "media", "webview.js").fsPath;
      const mtime = fs.statSync(p).mtimeMs;
      const stamp = Math.floor(mtime);
      console.log(
        `[workflow-insight] webview bundle build stamp: ${new Date(mtime).toISOString()} (v=${stamp})`,
      );
      return String(stamp);
    } catch {
      return String(Date.now());
    }
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(randomInt(chars.length));
  return text;
}
