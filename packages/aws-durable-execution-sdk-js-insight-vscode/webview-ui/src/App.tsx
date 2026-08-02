import { useState, useEffect, useCallback, useRef } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Header from "@cloudscape-design/components/header";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { postMessage } from "./vscode";
import { QueryPanel } from "./QueryPanel";
import { ResultsTable } from "./ResultsTable";
import { VisualizePage } from "./VisualizePage";
import { StudioPage } from "./StudioPage";
import { FunctionsListPage } from "./FunctionsListPage";
import { FunctionDetailPage } from "./FunctionDetailPage";
import { ExecutionDetailPage } from "./ExecutionDetailPage";
import { DAR_VERSION, autoLayout, parseWorkflow } from "./studioTypes";
import type { DarWorkflow } from "./studioTypes";
import { SettingsModal } from "./SettingsModal";
import { AiConsentModal } from "./AiConsentModal";
import { EditFunctionModal } from "./studio/EditFunctionModal";
import {
  INACTIVE_DEBUG_SESSION,
  type DebugCommandName,
  type DebugSessionState,
} from "./studio/DebugPanel";
import { AgentTranscript } from "./AgentTranscript";
import {
  SqsLiveView,
  toTable as sqsToTable,
  MAX_DISPLAYED_MESSAGES,
} from "./SqsLiveView";
import type {
  InboundMessage,
  Settings,
  SqsMessageRow,
  AgentStep,
  QueryMode,
  Favorite,
  DestinationTestReport,
  DeployStatus,
  DeployPermissionsRequest,
  StarterPackInfraProgress,
  StarterPackId,
  DebugProperty,
} from "./types";
import { DEFAULT_SETTINGS, AI_DISCLOSURE_VERSION } from "./types";
import type { DateFormat, DateVariant } from "./types";
import { DateFormatProvider } from "./DateFormatContext";
import { useDurableFunctionsView } from "./useDurableFunctionsView";
import { useExecutionDetail } from "./useExecutionDetail";

applyMode(Mode.Dark);

/**
 * Whether the Workflow Studio view is revealed. The flag is a real boolean from
 * the extension host but a string from the desktop app's flat JSON settings
 * file, so both encodings are accepted.
 */
function isStudioEnabled(s: Pick<Settings, "showWorkflowStudio">): boolean {
  return s.showWorkflowStudio === true || s.showWorkflowStudio === "true";
}

/** Whether `dag` dependency mode is enabled. Same dual encoding as above. */
function isDagEnabled(s: Pick<Settings, "enableDagMode">): boolean {
  return s.enableDagMode === true || s.enableDagMode === "true";
}

/**
 * Serializes Settings into the all-string payload the extension host expects
 * (each key maps 1:1 to a VS Code setting; sqsDeleteAfterRead is the only
 * boolean, coerced here at the boundary). Shared by the Save and Test actions
 * so their wire encoding can't drift apart.
 */
function toWireSettings(s: Settings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(s).map(([key, value]) => [key, String(value)]),
  );
}

/**
 * Generates a unique-enough id to correlate a host-request "bridge" call
 * with the reply `handleMessage` eventually receives. Prefers crypto.randomUUID
 * where available, falling back to a timestamp+random string otherwise.
 */
function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

/**
 * A simple, ready-to-run starter query for the current destination, used to
 * prefill the composer in "query" mode so the user has a working example to
 * edit instead of a blank box.
 */
function starterQueryFor(s: Settings): string {
  switch (s.destinationType) {
    case "dynamodb":
      // PartiQL requires the table name double-quoted.
      return `SELECT * FROM "${s.dynamodbTableName || "your-table"}" LIMIT 50`;
    case "aurora":
      return `SELECT * FROM ${s.auroraTable || "workflow_insight"} LIMIT 50`;
    case "redshift":
      return `SELECT * FROM ${s.redshiftSchema || "public"}.${s.redshiftTable || "workflow_insight"} LIMIT 50`;
    case "opensearch":
      return `SELECT * FROM \`${s.opensearchIndex || "workflow-insight"}\` LIMIT 50`;
    case "s3":
      return `SELECT * FROM ${s.athenaTable || "workflow_insight"} LIMIT 50`;
    default:
      // CloudWatch Logs Insights dialect.
      return "fields @timestamp, executionArn, status | sort @timestamp desc | limit 50";
  }
}

type Page = "data" | "visualize";

interface ResultsPayload {
  columns: string[];
  rows: string[][];
  suggestedCharts?: string[];
  idColumn?: string;
  partitionColumns?: { year?: string; month?: string; day?: string };
  hiddenColumns?: string[];
  explanation?: string;
  truncated?: boolean;
  finalQuery?: string;
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
  // Active query mode (query / ask / agent). Seeded from the persisted
  // workflowInsight.queryMode setting when config arrives, so it's remembered
  // across sessions; changing it in the composer persists it back.
  const [mode, setMode] = useState<QueryMode>("agent");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
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
  // AI-usage consent gate. LLM actions (Ask/Agent/Visualize) are deferred behind
  // a disclosure modal until the user has accepted the current disclosure
  // version; the accepted action then runs.
  const [consentOpen, setConsentOpen] = useState(false);
  const pendingLlmRef = useRef<null | (() => void)>(null);
  const consentAccepted =
    settings.aiDisclosureAcceptedVersion === AI_DISCLOSURE_VERSION;
  const [loading, setLoading] = useState(false);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  // Copilot (VS Code language-model API) is only available in the VS Code host;
  // defaults true so VS Code behavior is unchanged when the host omits it.
  const [copilotAvailable, setCopilotAvailable] = useState(true);
  const [downloadPercent, setDownloadPercent] = useState(0);
  // Result of a "Test connection" run in the Settings modal (null = not run
  // yet this session); `destTesting` shows the in-flight spinner.
  const [destTesting, setDestTesting] = useState(false);
  const [destTestResult, setDestTestResult] =
    useState<DestinationTestReport | null>(null);
  // Bedrock model ids fetched via the "List models" button (suggestions for the
  // model-id field), plus loading/error state for that fetch.
  const [bedrockModels, setBedrockModels] = useState<string[]>([]);
  const [bedrockModelsLoading, setBedrockModelsLoading] = useState(false);
  const [bedrockModelsError, setBedrockModelsError] = useState("");
  const [page, setPage] = useState<Page>("data");
  // Top-level view: the data Explorer or the drag-and-drop Workflow Studio.
  const [view, setView] = useState<
    "explorer" | "studio" | "functions" | "functionDetail" | "executionDetail"
  >("explorer");
  const studioEnabled = isStudioEnabled(settings);
  /**
   * The flag hides the Studio TAB; it does not make the view unreachable.
   *
   * The paths that navigate here all imply an explicit request for it, and are
   * already self-scoping: "Edit workflow" is only offered for functions whose
   * package embeds a `.dar` (see `FunctionInfo.editable`, derived from the
   * Studio's own deploy tag), while the agent and starter-pack flows live inside
   * the Studio. So they just open it — refusing would discard a workflow that had
   * already been loaded, for no gain.
   */
  const goToStudio = useCallback(() => setView("studio"), []);
  // Last .dar workflow the host loaded from disk; loadNonce bumps on each load
  // so StudioPage replaces its canvas even if two loads parse equal.
  const [loadedWorkflow, setLoadedWorkflow] = useState<DarWorkflow | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [savedNonce, setSavedNonce] = useState(0);
  // The real on-disk path of the currently loaded/saved workflow, when one
  // exists — a workflow loaded from a deployed function's embedded content
  // (no local file) leaves this null until the user explicitly saves. Drives
  // the code view's breakpoint gutter: a click is a no-op (see
  // WorkflowCodeView's own tooltip) when this is null, since there is no
  // real file to target a vscode.SourceBreakpoint against.
  const [workflowFilePath, setWorkflowFilePath] = useState<string | null>(
    null,
  );
  // handleMessage is registered once (empty deps) so it always reads this via
  // a ref rather than closing over a stale value.
  const workflowFilePathRef = useRef<string | null>(null);
  workflowFilePathRef.current = workflowFilePath;
  // Mirrors the host's real vscode.debug breakpoint list for
  // `workflowFilePath` — see "breakpointsChanged" in types.ts.
  const [breakpointLines, setBreakpointLines] = useState<number[]>([]);
  // The node ids whose `.dar.ts` decl line is currently a breakpoint (host
  // computes this via locateDarTsNodeLines reverse lookup) — drives the
  // canvas's filled breakpoint dots. Same store as breakpointLines.
  const [breakpointNodeIds, setBreakpointNodeIds] = useState<string[]>([]);
  // The node the active debug session is currently paused ON (its decl line ==
  // the paused darLine), or null — drives the canvas's paused-node glow, the
  // graph-view analogue of the code view's paused-line highlight.
  const [pausedNodeId, setPausedNodeId] = useState<string | null>(null);
  // False once the host reports it can't register real debugger breakpoints
  // at all (the standalone desktop app) — see `supported` in types.ts.
  // Optimistically true until told otherwise.
  const [breakpointsSupported, setBreakpointsSupported] = useState(true);
  // In-Studio debug session, accumulated from "debugEvent" messages (see the
  // protocol section in types.ts and the state shape in DebugPanel.tsx).
  // `active` keeps the panel visible through done/error until dismissed.
  const [debugSession, setDebugSession] = useState<DebugSessionState>(
    INACTIVE_DEBUG_SESSION,
  );
  // handleMessage and the breakpoint-sync effect read the live running flag
  // via a ref (same reason as workflowFilePathRef — their closures are
  // registered once and must not go stale).
  const debugRunningRef = useRef(false);
  debugRunningRef.current = debugSession.running;
  // Pending "debugGetProperties" fetches, keyed by requestId, resolved when
  // the host replies with "debugProperties" (same bridge pattern as
  // agentReqs/resourceReqs).
  const debugPropReqs = useRef<
    Map<
      string,
      { resolve: (p: DebugProperty[]) => void; reject: (e: Error) => void }
    >
  >(new Map());
  // Step Functions import: conversion notes, faithfulness flag, and the current
  // progress phase (updated as the host works).
  const [importNotes, setImportNotes] = useState<string[] | null>(null);
  const [importFaithful, setImportFaithful] = useState<boolean | null>(null);
  const [importPhase, setImportPhase] = useState<string>("");
  const [starterPackInfraProgress, setStarterPackInfraProgress] =
    useState<StarterPackInfraProgress | null>(null);
  // Latest content of a code block the user is editing in a VS Code tab; nonce
  // makes each update distinct so StudioPage re-applies it to the node.
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  // A mid-deploy IAM review the host is blocked on. Reviewed inside the deploy
  // modal (see StudioPage) rather than in a native dialog, so the statements
  // can be shown as a table alongside the deploy the user already started.
  const [deployPermissions, setDeployPermissions] =
    useState<DeployPermissionsRequest | null>(null);
  // Durable Functions view + Execution Detail view: state/mutations extracted
  // into dedicated hooks (see useDurableFunctionsView.ts / useExecutionDetail.ts).
  // `setView` is threaded in because both features navigate the top-level view,
  // which App itself owns.
  const {
    functionsList,
    functionsError,
    functionsLoading,
    selectedFn,
    fnInfo,
    fnInfoError,
    executions,
    execError,
    execNextMarker,
    execLoading,
    refreshFunctions,
    selectFunction,
    loadMoreExecutions,
    refreshExecutions,
    handleViewFunction,
    applyFunctionsList,
    applyFunctionInfo,
    applyExecutionsList,
  } = useDurableFunctionsView({ setView });
  const {
    starting,
    startError,
    executionDetail,
    executionDetailError,
    executionDetailLoading,
    selectedExecutionArn,
    executionWorkflow,
    startExecutionFor,
    openExecution,
    refreshExecutionDetail,
    handleStopExecution,
    applyExecutionStarted,
    applyExecutionDetail,
    applyExecutionWorkflow,
  } = useExecutionDetail({ view, setView });
  // Pending agent (node-code) requests, keyed by requestId, resolved when the
  // host replies with `agentNodeCode`.
  const agentReqs = useRef<
    Map<string, { resolve: (c: string) => void; reject: (e: Error) => void }>
  >(new Map());
  // Pending whole-workflow agent requests, resolved (after loading the result)
  // when the host replies with `agentWorkflow`.
  const codeViewReqs = useRef<
    Map<
      string,
      { resolve: (v: string) => void; reject: (e: Error) => void }
    >
  >(new Map());
  const agentWfReqs = useRef<
    Map<string, { resolve: () => void; reject: (e: Error) => void }>
  >(new Map());
  // Pending starter-pack infra deploy requests, resolved (with the resulting
  // `.dar`) when the host replies with `starterPackInfraResult`. Kept as its
  // own ref rather than reusing agentWfReqs/resourceReqs — those already have
  // specific, incompatible resolve/reject shapes (agentWfReqs resolves with
  // no value since it also drives the canvas load as a side effect;
  // resourceReqs always resolves, never rejects), and force-fitting this
  // flow's resolve-with-`.dar`-string/reject-on-error shape into either would
  // just require an awkward union type instead of a small dedicated map.
  const starterPackReqs = useRef<
    Map<string, { resolve: (dar: string) => void; reject: (e: Error) => void }>
  >(new Map());
  // The requestId of the currently in-flight starter-pack deploy, if any —
  // lets a separate `cancelStarterPackDeploy` call (triggered by the modal's
  // Cancel button) target the right request without threading requestId
  // through the UI layer.
  const currentStarterPackReqId = useRef<string | null>(null);
  // Pending resource-picker lookups, resolved when the host replies with
  // `resourceList` (always resolves — errors are returned, not thrown, so the
  // field stays manually editable).
  const resourceReqs = useRef<
    Map<
      string,
      (r: { items: { label: string; value: string }[]; error?: string }) => void
    >
  >(new Map());
  // Pending result-type inference lookups, resolved when the host replies with
  // `inferTypesResult` (always resolves — errors yield an empty map).
  const inferReqs = useRef<
    Map<string, (types: Record<string, string>) => void>
  >(new Map());
  const [sqsMessages, setSqsMessages] = useState<SqsMessageRow[]>([]);
  const [sqsListening, setSqsListening] = useState(false);
  const [detailFields, setDetailFields] = useState<Record<
    string,
    string
  > | null>(null);
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
        if (
          msg.settings.queryMode === "query" ||
          msg.settings.queryMode === "ask" ||
          msg.settings.queryMode === "agent"
        )
          setMode(msg.settings.queryMode);
        if (msg.modelDownloaded !== undefined)
          setModelDownloaded(msg.modelDownloaded);
        setCopilotAvailable(msg.copilotAvailable !== false);
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
          truncated: msg.truncated,
          finalQuery: msg.finalQuery,
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
      case "destinationTestResult":
        setDestTesting(false);
        setDestTestResult(msg.result);
        break;
      case "bedrockModels":
        setBedrockModelsLoading(false);
        // Only replace the list when the host actually sent one; on error it
        // omits `models` so we keep any previously-fetched suggestions.
        if (msg.models) setBedrockModels(msg.models);
        setBedrockModelsError(msg.error ?? "");
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
      case "favorites":
        setFavorites(msg.favorites);
        break;
      case "navigate":
        setView(msg.view);
        break;
      case "deployStatus": {
        const m = msg as DeployStatus;
        setDeployStatus(m);
        // Any terminal deploy state also ends an outstanding review — the host
        // is no longer waiting on one, so the modal must not keep prompting.
        if (m.status !== "progress") setDeployPermissions(null);
        const line =
          m.status === "done"
            ? `✓ Deployed → ${m.result.aliasArn}  (executionTimeout ${m.result.executionTimeoutSeconds}s)`
            : m.status === "error"
              ? `✗ ${m.message}`
              : m.message;
        setDeployLog((log) => [...log, line]);
        break;
      }
      case "deployPermissionsRequest":
        setDeployPermissions({
          requestId: msg.requestId,
          roleName: msg.roleName,
          statements: msg.statements,
          warnings: msg.warnings,
        });
        break;
      case "functionsList":
        applyFunctionsList(msg.functions, msg.error, msg.loading);
        break;
      case "functionInfo":
        applyFunctionInfo(msg.info, msg.error);
        break;
      case "executionsList":
        applyExecutionsList(msg.executions, msg.error, msg.nextMarker);
        break;
      case "executionStarted":
        applyExecutionStarted(msg.durableExecutionArn, msg.error);
        break;
      case "executionDetail":
        applyExecutionDetail(msg.detail, msg.error);
        break;
      case "executionWorkflow":
        applyExecutionWorkflow(msg.dar);
        break;
      case "resourceList": {
        const resolve = resourceReqs.current.get(msg.requestId);
        if (resolve) {
          resourceReqs.current.delete(msg.requestId);
          resolve({ items: msg.items, error: msg.error });
        }
        break;
      }
      case "inferTypesResult": {
        const resolve = inferReqs.current.get(msg.requestId);
        if (resolve) {
          inferReqs.current.delete(msg.requestId);
          resolve(msg.types ?? {});
        }
        break;
      }
      case "agentNodeCode": {
        const pending = agentReqs.current.get(msg.requestId);
        if (pending) {
          agentReqs.current.delete(msg.requestId);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.code ?? "");
        }
        break;
      }
      case "agentWorkflow": {
        const pending = agentWfReqs.current.get(msg.requestId);
        agentWfReqs.current.delete(msg.requestId);
        if (msg.error) {
          pending?.reject(new Error(msg.error));
          break;
        }
        try {
          // Agent output omits positions (keeps completions compact) — apply
          // auto-layout so the graph lands arranged, not stagger-defaulted.
          setLoadedWorkflow(autoLayout(parseWorkflow(JSON.parse(msg.dar ?? "{}"))));
          setLoadNonce((n) => n + 1);
          goToStudio();
          if (msg.notes && msg.notes.length > 0) setImportNotes(msg.notes);
          else setImportNotes(null);
          setImportFaithful(msg.faithful ?? null);
          setImportPhase("");
          pending?.resolve();
        } catch (e) {
          pending?.reject(e instanceof Error ? e : new Error(String(e)));
        }
        break;
      }
      case "importProgress":
        setImportPhase(msg.detail);
        break;
      case "starterPackInfraProgress":
        setStarterPackInfraProgress({
          message: msg.message,
          resources: msg.resources,
        });
        break;
      case "starterPackInfraResult": {
        const pending = starterPackReqs.current.get(msg.requestId);
        starterPackReqs.current.delete(msg.requestId);
        if (msg.error) {
          const error = new Error(msg.error) as Error & {
            cancelled?: boolean;
          };
          error.cancelled = msg.cancelled;
          pending?.reject(error);
        } else {
          pending?.resolve(msg.dar ?? "");
        }
        break;
      }
      case "workflowCodeResult":
      case "workflowFromCodeResult": {
        const pending = codeViewReqs.current.get(msg.requestId);
        if (pending) {
          codeViewReqs.current.delete(msg.requestId);
          const value =
            msg.type === "workflowCodeResult" ? msg.text : msg.dar;
          if (msg.error || value === undefined) {
            pending.reject(new Error(msg.error ?? "No result returned."));
          } else {
            pending.resolve(value);
          }
        }
        break;
      }
      case "workflowSaved":
        setSavedNonce((n) => n + 1);
        setWorkflowFilePath(msg.path);
        break;
      case "workflowLoaded":
        try {
          const wf = parseWorkflow(JSON.parse(msg.content));
          setLoadedWorkflow(wf);
          setLoadNonce((n) => n + 1);
          setWorkflowFilePath(msg.path ?? null);
          goToStudio();
          // A version we have no migration for (i.e. newer than this Studio)
          // still loads best-effort, but warn: fields this Studio doesn't know
          // about may be dropped or reshaped on the next save.
          setError(
            wf.darVersion !== DAR_VERSION
              ? `This workflow uses .dar format ${wf.darVersion}, but this Studio understands ${DAR_VERSION}. It was likely created by a newer version — it may not display or re-save correctly.`
              : "",
          );
        } catch (e) {
          setError(
            `Could not open workflow: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        break;
      case "breakpointsChanged":
        if (msg.supported === false) setBreakpointsSupported(false);
        // Only apply if it's for the workflow currently open — the host may
        // still be reporting stale changes for a path we've since navigated
        // away from (e.g. a debug session ending after switching workflows).
        setBreakpointLines((prev) =>
          msg.path === workflowFilePathRef.current ? msg.lines : prev,
        );
        setBreakpointNodeIds((prev) =>
          msg.path === workflowFilePathRef.current ? (msg.nodeIds ?? []) : prev,
        );
        break;
      case "debugEvent": {
        const ev = msg.event;
        // The paused-NODE glow follows the same lifecycle as the paused-LINE
        // highlight: set on pause, cleared the moment execution resumes or
        // the run ends. Kept as its own App-level state (parallel to the
        // pausedLine derivation below) so it doesn't require widening
        // DebugSessionState.
        if (ev.kind === "paused") setPausedNodeId(ev.pausedNodeId ?? null);
        else if (
          ev.kind === "resumed" ||
          ev.kind === "done" ||
          ev.kind === "error"
        )
          setPausedNodeId(null);
        // Every transition is a pure function of the previous session state,
        // so a burst of events (status + paused arriving together) can't
        // clobber each other through stale closures.
        setDebugSession((prev) => {
          switch (ev.kind) {
            case "status":
              return {
                ...prev,
                active: true,
                statusLines: [...prev.statusLines, ev.message],
              };
            case "started":
              return {
                ...prev,
                active: true,
                running: true,
                functionName: ev.functionName,
                result: null,
                error: null,
              };
            case "paused":
              return {
                ...prev,
                paused: true,
                // Fresh objectIds every pause — the nonce tells the panel to
                // drop its variables cache and collapse the tree.
                pauseNonce: prev.pauseNonce + 1,
                lastPaused: {
                  darLine: ev.darLine,
                  functionName: ev.functionName,
                  callStack: ev.callStack,
                  scopes: ev.scopes,
                },
              };
            case "resumed":
              return { ...prev, paused: false };
            case "done":
              return {
                ...prev,
                running: false,
                paused: false,
                result: {
                  statusCode: ev.statusCode,
                  payload: ev.payload,
                  logTail: ev.logTail,
                },
              };
            case "error":
              return { ...prev, running: false, paused: false, error: ev.message };
            case "boundBreakpoints":
              return { ...prev, boundLines: ev.darLines };
          }
        });
        break;
      }
      case "debugProperties": {
        const pending = debugPropReqs.current.get(msg.requestId);
        if (pending) {
          debugPropReqs.current.delete(msg.requestId);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.properties);
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Fetch the real current breakpoint set whenever the workflow gets a real
  // backing file (first save, or loading an existing local file) — starts
  // the gutter in sync with whatever VS Code already has (e.g. breakpoints
  // set via a normal editor tab before Studio was opened).
  useEffect(() => {
    if (!workflowFilePath) {
      setBreakpointLines([]);
      setBreakpointNodeIds([]);
      return;
    }
    postMessage({ type: "getBreakpoints", path: workflowFilePath });
  }, [workflowFilePath]);

  // While a debug session is live, gutter toggles must ALSO reach the
  // session (the CDP breakpoints were translated at start — a new line needs
  // retranslation and a removed one needs unbinding). breakpointsChanged
  // remains the source of truth for the line list itself; this only pushes
  // the full current set into the running session (REPLACE semantics
  // host-side, so re-sends are harmless). Reacts to the LINES, not the
  // session, so starting a session doesn't fire a redundant send (the host
  // already sets the initial breakpoints from runWorkflow).
  useEffect(() => {
    if (!debugRunningRef.current) return;
    postMessage({ type: "debugSetBreakpoints", darLines: breakpointLines });
  }, [breakpointLines]);

  const runQuestion = (question: string, useMode: QueryMode) => {
    setLoading(true);
    setError("");
    setResults(null);
    setAgentSteps([]);
    stepsRef.current = [];
    setPage("data");
    // Keep the chat history (this is a conversation); append the new question.
    setChat((prev) => [...prev, { role: "user", text: question }]);
    answeredRef.current = false;
    postMessage({ type: "generate", question, mode: useMode });
  };

  const handleAsk = (question: string) => {
    // Query mode never uses an LLM — run it directly. Ask/Agent do, so gate
    // them behind the AI-usage consent.
    if (mode === "query") {
      runQuestion(question, "query");
      return;
    }
    gateLlm(() => runQuestion(question, mode));
  };

  // Run an LLM-backed action, first ensuring the AI-usage disclosure has been
  // accepted; otherwise defer the action and open the consent modal.
  const gateLlm = (action: () => void) => {
    if (consentAccepted) {
      action();
      return;
    }
    pendingLlmRef.current = action;
    setConsentOpen(true);
  };

  const acceptConsent = () => {
    postMessage({ type: "setConsent", version: AI_DISCLOSURE_VERSION });
    // Optimistically reflect acceptance so the gate opens immediately and the
    // modal isn't shown again this session (the host persists it too).
    setSettings((s) => ({
      ...s,
      aiDisclosureAcceptedVersion: AI_DISCLOSURE_VERSION,
    }));
    setConsentOpen(false);
    const pending = pendingLlmRef.current;
    pendingLlmRef.current = null;
    pending?.();
  };

  const declineConsent = () => {
    pendingLlmRef.current = null;
    setConsentOpen(false);
  };

  // Run a saved favorite: favorites are raw queries, so run them verbatim in
  // "query" mode regardless of the current mode. We deliberately do NOT change
  // or persist the composer's default mode — re-running a favorite shouldn't
  // silently flip the user's chosen default for future sessions.
  const handleRunFavorite = (query: string) => {
    runQuestion(query, "query");
  };

  // Change the active mode and persist it as the default for next time.
  const handleModeChange = (m: QueryMode) => {
    setMode(m);
    postMessage({ type: "setMode", mode: m });
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
    postMessage({ type: "saveSettings", settings: toWireSettings(s) });
  };

  // Change the favorite date format: apply immediately (optimistic) and persist.
  const setDateFormat = useCallback(
    (fmt: DateFormat) => {
      setSettings((prev) => {
        const next = { ...prev, dateFormat: fmt };
        postMessage({ type: "saveSettings", settings: toWireSettings(next) });
        return next;
      });
    },
    [],
  );

  const setDateVariant = useCallback((v: DateVariant) => {
    setSettings((prev) => {
      const next = { ...prev, dateVariant: v };
      postMessage({ type: "saveSettings", settings: toWireSettings(next) });
      return next;
    });
  }, []);

  const handleTestDestination = (s: Settings) => {
    // Tests the current (possibly unsaved) form values; the host normalizes the
    // same all-string payload without persisting it.
    setDestTestResult(null);
    setDestTesting(true);
    postMessage({ type: "testDestination", settings: toWireSettings(s) });
  };

  const handleClearTest = useCallback(() => setDestTestResult(null), []);

  const handleListModels = (s: Settings) => {
    setBedrockModelsError("");
    setBedrockModelsLoading(true);
    postMessage({ type: "listModels", settings: toWireSettings(s) });
  };

  const handleSaveWorkflow = (wf: DarWorkflow) => {
    postMessage({
      type: "saveWorkflow",
      name: wf.name,
      content: JSON.stringify(wf, null, 2),
    });
  };

  const handleToggleBreakpoint = (line: number) => {
    if (!workflowFilePath) return; // no real file to target yet
    postMessage({ type: "toggleBreakpoint", path: workflowFilePath, line });
  };

  // Canvas node breakpoint: the host maps nodeId -> its `.dar.ts` decl line
  // and toggles a breakpoint there (same store as code/body-line
  // breakpoints). A no-op without a real backing file, like the code-view
  // toggle above.
  const handleToggleNodeBreakpoint = (nodeId: string) => {
    if (!workflowFilePath) return;
    postMessage({ type: "toggleNodeBreakpoint", path: workflowFilePath, nodeId });
  };

  const handleDeploy = (functionName: string, workflow: DarWorkflow) => {
    setDeployStatus({ status: "progress", message: "Starting…" });
    setDeployLog(["Starting…"]);
    postMessage({ type: "deployWorkflow", functionName, workflow });
  };

  // Remote debug: the hosts bridge the session to the in-Studio DebugPanel
  // via "debugEvent" messages (see the protocol section in types.ts), so a
  // debug run resets the session state here — optimistically active, so the
  // panel appears immediately and captures the setup status stream. Execute
  // (debug:false) reuses the host's pre-existing startExecution pipeline and
  // never touches the session.
  const handleRun = (
    functionName: string,
    payload: string,
    executionName: string | undefined,
    debug: boolean,
  ) => {
    if (debug) {
      setDebugSession({
        ...INACTIVE_DEBUG_SESSION,
        active: true,
        running: true,
        functionName,
        statusLines: ["Starting debug session…"],
      });
    }
    postMessage({
      type: "runWorkflow",
      functionName,
      payload,
      ...(executionName ? { executionName } : {}),
      debug,
    });
  };

  // Stepping/continue/stop for the active debug session — fire-and-forget;
  // resulting state changes come back as "debugEvent"s.
  const handleDebugCommand = useCallback((command: DebugCommandName) => {
    postMessage({ type: "debugCommand", command });
  }, []);

  // Lazily fetch an object's own properties for the DebugPanel's variables
  // tree (correlated by requestId, same bridge pattern as generateNodeCode).
  const debugGetProperties = useCallback(
    (objectId: string) =>
      new Promise<DebugProperty[]>((resolve, reject) => {
        const requestId = newRequestId();
        debugPropReqs.current.set(requestId, { resolve, reject });
        postMessage({ type: "debugGetProperties", requestId, objectId });
      }),
    [],
  );

  // Hide the panel after a finished run (the session itself already ended
  // host-side — this only clears the webview's record of it).
  const dismissDebugSession = useCallback(() => {
    setDebugSession(INACTIVE_DEBUG_SESSION);
  }, []);

  // The selectedFn-based "Start execution" action (FunctionDetailPage's modal).
  // Lives in App because it reads `selectedFn` from the functions hook and
  // delegates to `startExecutionFor` from the execution-detail hook — neither
  // hook needs the other's state for anything else, so this small bridge
  // avoids passing selectedFn into useExecutionDetail just for this one case.
  const startExecution = (payload: string, executionName?: string) => {
    if (!selectedFn) return;
    startExecutionFor(selectedFn, payload, executionName);
  };

  const handleOpenWorkflow = () => {
    postMessage({ type: "openWorkflow" });
  };

  const [editFunctionModalOpen, setEditFunctionModalOpen] = useState(false);
  const handleEditFunction = () => {
    setEditFunctionModalOpen(true);
  };
  const listEditableFunctions = useCallback(
    () =>
      new Promise<{ label: string; value: string }[]>((resolve) => {
        const requestId = newRequestId();
        resourceReqs.current.set(requestId, ({ items }) => resolve(items));
        postMessage({ type: "listEditableFunctions", requestId });
      }),
    [],
  );

  // Bridge for the Studio's per-node "agent" buttons: post a request and resolve
  // when the host replies (correlated by requestId).
  const generateNodeCode = useCallback(
    (req: {
      kind: string;
      field: string;
      name: string;
      description: string;
      scope: string[];
      inputType?: string;
      currentCode?: string;
    }) =>
      new Promise<string>((resolve, reject) => {
        const requestId = newRequestId();
        agentReqs.current.set(requestId, { resolve, reject });
        postMessage({ type: "generateNodeCode", requestId, ...req });
      }),
    [],
  );

  // Code-view bridges: serialize the model to `.dar.ts` text and parse edited
  // text back (both host-side, where the TS toolchain lives).
  const renderWorkflowCode = useCallback(
    (workflow: unknown) =>
      new Promise<string>((resolve, reject) => {
        const requestId = newRequestId();
        codeViewReqs.current.set(requestId, { resolve, reject });
        postMessage({ type: "workflowCode", requestId, workflow });
      }),
    [],
  );
  const parseWorkflowCode = useCallback(
    (text: string) =>
      new Promise<string>((resolve, reject) => {
        const requestId = newRequestId();
        codeViewReqs.current.set(requestId, { resolve, reject });
        postMessage({ type: "workflowFromCode", requestId, text });
      }),
    [],
  );

  // Bridge for the Studio resource pickers: ask the host to list account
  // resources of a kind. Always resolves (errors are returned, not thrown), so
  // the field stays manually editable when listing is denied or fails.
  const listResources = useCallback(
    (resource: string) =>
      new Promise<{
        items: { label: string; value: string }[];
        error?: string;
      }>((resolve) => {
        const requestId = newRequestId();
        resourceReqs.current.set(requestId, resolve);
        postMessage({ type: "listResources", requestId, resource });
      }),
    [],
  );

  // Ask the host to infer node result types (TS) from their code. Always
  // resolves (errors yield an empty map), so the caller degrades gracefully.
  const inferTypes = useCallback(
    (
      items: {
        nodeId: string;
        resultName: string;
        code: string;
        codeKind: "step" | "condition";
        scope: string[];
      }[],
      seedTypes?: Record<string, string>,
      inputType?: string,
    ) =>
      new Promise<Record<string, string>>((resolve) => {
        const requestId = newRequestId();
        inferReqs.current.set(requestId, resolve);
        postMessage({
          type: "inferTypes",
          requestId,
          items,
          seedTypes,
          inputType,
        });
      }),
    [],
  );

  // Bridge for the Studio header "Agent" button: generate a whole workflow and
  // load it onto the canvas (App handles the load when the host replies).
  const generateWorkflow = useCallback(
    (description: string) =>
      new Promise<void>((resolve, reject) => {
        const requestId = newRequestId();
        agentWfReqs.current.set(requestId, { resolve, reject });
        postMessage({ type: "generateWorkflow", requestId, description });
      }),
    [],
  );

  // List the account's Step Functions state machines for the import picker.
  const listStateMachines = useCallback(
    () =>
      new Promise<{ label: string; value: string }[]>((resolve) => {
        const requestId = newRequestId();
        resourceReqs.current.set(requestId, ({ items }) => resolve(items));
        postMessage({ type: "listStateMachines", requestId });
      }),
    [],
  );

  // Import a state machine by ARN → convert to .dar → load onto the canvas
  // (App handles the load via the shared `agentWorkflow` reply path).
  const importStateMachine = useCallback((arn: string, inlineLambdas: boolean) => {
    setImportPhase("Starting…");
    return new Promise<void>((resolve, reject) => {
      const requestId = newRequestId();
      agentWfReqs.current.set(requestId, { resolve, reject });
      postMessage({ type: "importStateMachine", requestId, arn, inlineLambdas });
    });
  }, []);

  // Deploy a Step Functions starter pack's supporting infra (a CFN stack) and
  // resolve the pack's `.dar`. Unlike `importStateMachine`, this does NOT load
  // the result onto the canvas itself — the caller (Task 5's UI) decides what
  // to do with the returned `.dar` (e.g. load it, or offer to deploy it as a
  // durable Lambda via the existing deploy flow).
  const deployStarterPackInfra = useCallback((packId: StarterPackId) => {
    setStarterPackInfraProgress({ message: "Starting…" });
    return new Promise<string>((resolve, reject) => {
      const requestId = newRequestId();
      currentStarterPackReqId.current = requestId;
      starterPackReqs.current.set(requestId, {
        resolve: (dar) => {
          currentStarterPackReqId.current = null;
          resolve(dar);
        },
        reject: (e) => {
          currentStarterPackReqId.current = null;
          reject(e);
        },
      });
      postMessage({ type: "deployStarterPackInfra", requestId, packId });
    });
  }, []);

  // Cancels the currently in-flight starter-pack deploy, if any — the host
  // deletes the in-progress CFN stack rather than leaving it orphaned (see
  // cfnDeploy.ts's waitForStackComplete).
  const cancelStarterPackDeploy = useCallback(() => {
    const requestId = currentStarterPackReqId.current;
    if (!requestId) return;
    postMessage({ type: "cancelStarterPackDeploy", requestId });
  }, []);

  // Parse a `.dar` string (e.g. a starter pack's resolved workflow) and load
  // it onto the canvas — the same mechanism the `agentWorkflow` reply path
  // uses (auto-layout, since starter-pack output has no saved positions).
  const loadDar = useCallback((dar: string) => {
    setLoadedWorkflow(autoLayout(parseWorkflow(JSON.parse(dar))));
    setLoadNonce((n) => n + 1);
    goToStudio();
  }, [goToStudio]);

  return (
    <DateFormatProvider
      value={{
        format: settings.dateFormat,
        setFormat: setDateFormat,
        variant: settings.dateVariant,
        setVariant: setDateVariant,
      }}
    >
    <div style={{ padding: "16px" }}>
      <SpaceBetween size="l">
        {/* The page-level "Workflow Insight Explorer" heading was accurate when
            the Explorer was the only view; with three top-level views it named
            just one of them while costing two lines on all of them. Dropped in
            favour of the view tabs themselves, with the heading's actions moved
            onto the same row and its destination summary folded into the
            settings button's tooltip. */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <SegmentedControl
            selectedId={view}
            onChange={({ detail }) => {
              const next = detail.selectedId as
                | "explorer"
                | "studio"
                | "functions"
                | "functionDetail"
                | "executionDetail";
              setView(next);
              if (next === "functions" && functionsList.length === 0) {
                refreshFunctions();
              }
            }}
            label="View"
            options={[
              { id: "explorer", text: "Workflow Insight" },
              // Opt-in (see isStudioEnabled), but always shown while it IS the
              // active view — reached via "Edit workflow" on a Studio-built
              // function — so the tab strip still offers a way back out.
              ...(studioEnabled || view === "studio"
                ? [{ id: "studio", text: "Workflow Studio" }]
                : []),
              { id: "functions", text: "Durable Functions" },
            ]}
          />
          <div style={{ marginLeft: "auto" }}>
            <SpaceBetween direction="horizontal" size="xs">
              {/* Which account/destination is being queried is worth keeping
                  visible — it just doesn't need a heading's worth of space. */}
              <Box
                variant="small"
                color="text-status-inactive"
                padding={{ top: "xxs" }}
              >
                {settings.logGroupName ||
                settings.dynamodbTableName ||
                settings.auroraTable ||
                settings.sqsQueueUrl
                  ? `${settings.region} · ${settings.destinationType}`
                  : "Click ⚙ to configure"}
              </Box>
              {settings.destinationType !== "sqs" && chat.length > 0 && (
                <Button iconName="add-plus" onClick={handleNewSession}>
                  New session
                </Button>
              )}
              <Button
                iconName="settings"
                variant="icon"
                ariaLabel="Settings"
                onClick={() => setSettingsOpen(true)}
              />
            </SpaceBetween>
          </div>
        </div>
        {(view === "functions" ||
          view === "functionDetail" ||
          view === "executionDetail") && (
          <BreadcrumbGroup
            items={[
              { text: "Durable functions", href: "#functions" },
              ...(view !== "functions" && selectedFn
                ? [{ text: selectedFn, href: "#functionDetail" }]
                : []),
              ...(view === "executionDetail"
                ? [
                    {
                      text:
                        executionDetail?.name ||
                        selectedExecutionArn?.split("/").pop() ||
                        "Execution",
                      href: "#executionDetail",
                    },
                  ]
                : []),
            ]}
            onFollow={(e) => {
              e.preventDefault();
              const href = e.detail.href;
              if (href === "#functions") setView("functions");
              else if (href === "#functionDetail") setView("functionDetail");
            }}
          />
        )}

        {view === "functions" && (
          <FunctionsListPage
            functions={functionsList}
            functionsError={functionsError || undefined}
            functionsLoading={functionsLoading}
            onRefresh={refreshFunctions}
            onSelect={(name) => {
              selectFunction(name);
              setView("functionDetail");
            }}
          />
        )}

        {view === "functionDetail" && selectedFn && (
          <FunctionDetailPage
            functionName={selectedFn}
            info={fnInfo}
            infoError={fnInfoError || undefined}
            executions={executions}
            executionsError={execError || undefined}
            hasMore={!!execNextMarker}
            loading={execLoading}
            onLoadMore={loadMoreExecutions}
            onRefreshExecutions={refreshExecutions}
            onStartExecution={startExecution}
            onOpenExecution={openExecution}
            onEditWorkflow={(name) =>
              postMessage({ type: "editFunctionWorkflow", functionName: name })
            }
            starting={starting}
            startError={startError || undefined}
          />
        )}

        {view === "executionDetail" && (
          <ExecutionDetailPage
            detail={executionDetail}
            workflow={executionWorkflow}
            error={executionDetailError || undefined}
            loading={executionDetailLoading}
            onRefresh={refreshExecutionDetail}
            onStop={handleStopExecution}
            onStartExecution={startExecutionFor}
            starting={starting}
            startError={startError || undefined}
            onEditWorkflow={(functionRef) =>
              postMessage({
                type: "editFunctionWorkflow",
                functionName: functionRef,
              })
            }
          />
        )}

        {view === "studio" && (
          <StudioPage
            loaded={loadedWorkflow}
            loadNonce={loadNonce}
            savedNonce={savedNonce}
            workflowFilePath={workflowFilePath}
            breakpointLines={breakpointLines}
            breakpointsSupported={breakpointsSupported}
            onToggleBreakpoint={handleToggleBreakpoint}
            breakpointNodeIds={breakpointNodeIds}
            onToggleNodeBreakpoint={handleToggleNodeBreakpoint}
            debugSession={debugSession}
            onDebugCommand={handleDebugCommand}
            onDebugGetProperties={debugGetProperties}
            onDebugDismiss={dismissDebugSession}
            // The paused-line highlight follows the top frame and clears the
            // moment execution resumes (lastPaused itself is kept for the
            // panel's call-stack display).
            pausedLine={
              debugSession.paused
                ? (debugSession.lastPaused?.darLine ?? null)
                : null
            }
            // The canvas analogue of pausedLine: the node whose decl line the
            // session paused on (cleared with pausedNodeId on resume/end).
            pausedNodeId={debugSession.paused ? pausedNodeId : null}
            onSave={handleSaveWorkflow}
            onOpen={handleOpenWorkflow}
            onEditFunction={handleEditFunction}
            onGenerateNodeCode={generateNodeCode}
            onRenderWorkflowCode={renderWorkflowCode}
            dagEnabled={isDagEnabled(settings)}
            onParseWorkflowCode={parseWorkflowCode}
            onGenerateWorkflow={generateWorkflow}
            onListStateMachines={listStateMachines}
            onImportStateMachine={importStateMachine}
            importNotes={importNotes}
            importFaithful={importFaithful}
            importPhase={importPhase}
            onDeployStarterPackInfra={deployStarterPackInfra}
            starterPackInfraProgress={starterPackInfraProgress}
            onCancelStarterPackDeploy={cancelStarterPackDeploy}
            onLoadDar={loadDar}
            onListResources={listResources}
            onInferTypes={inferTypes}
            onDeploy={handleDeploy}
            onRun={handleRun}
            deployStatus={deployStatus}
            deployLog={deployLog}
            deployPermissions={deployPermissions}
            onRespondDeployPermissions={(requestId, approved) => {
              setDeployPermissions(null);
              postMessage({
                type: "deployPermissionsResponse",
                requestId,
                approved,
              });
            }}
            onCancelDeploy={() => postMessage({ type: "cancelDeploy" })}
            onViewFunction={handleViewFunction}
          />
        )}

        <EditFunctionModal
          visible={editFunctionModalOpen}
          onDismiss={() => setEditFunctionModalOpen(false)}
          onList={listEditableFunctions}
          onOpen={(functionName) =>
            postMessage({ type: "editFunctionWorkflow", functionName })
          }
        />

        {view === "explorer" &&
          (settings.destinationType === "sqs" ? (
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
                    gate={gateLlm}
                  />
                );
              })()}
          </>
        ) : (
          <>
            {page === "data" && (
              <>
                {chat.length > 0 && (
                  <Container
                    header={<Header variant="h3">Conversation</Header>}
                  >
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
                            <div style={{ whiteSpace: "pre-wrap" }}>
                              {turn.text}
                            </div>
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
                            <div style={{ whiteSpace: "pre-wrap" }}>
                              {turn.text}
                            </div>
                            {turn.steps && turn.steps.length > 0 && (
                              <Box padding={{ top: "xs" }}>
                                <ExpandableSection
                                  headerText="Agent steps"
                                  variant="footer"
                                >
                                  <AgentTranscript
                                    steps={turn.steps}
                                    running={false}
                                  />
                                </ExpandableSection>
                              </Box>
                            )}
                            {turn.results && (
                              <Box padding={{ top: "xs" }}>
                                <SpaceBetween size="s">
                                  {turn.results.truncated && (
                                    <Box
                                      color="text-status-warning"
                                      fontSize="body-s"
                                    >
                                      Showing the first{" "}
                                      {turn.results.rows.length.toLocaleString()}{" "}
                                      rows — the result was truncated at the row
                                      cap. Add a LIMIT or aggregate (COUNT/GROUP
                                      BY) in the query for the full set.
                                    </Box>
                                  )}
                                  <ResultsTable
                                    columns={turn.results.columns}
                                    rows={turn.results.rows}
                                    explanation={turn.results.explanation}
                                    idColumn={turn.results.idColumn}
                                    partitionColumns={
                                      turn.results.partitionColumns
                                    }
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
                                    onDetailDismiss={() =>
                                      setDetailFields(null)
                                    }
                                    pageSize={5}
                                    query={turn.results.finalQuery}
                                    destinationType={settings.destinationType}
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
                {loading && (
                  <AgentTranscript steps={agentSteps} running={loading} />
                )}

                {/* Composer anchored at the bottom, chat-style, so a follow-up
                    continues the conversation above. */}
                <QueryPanel
                  onAsk={handleAsk}
                  mode={mode}
                  onModeChange={handleModeChange}
                  starterQuery={starterQueryFor(settings)}
                  favorites={favorites.filter(
                    (f) => f.destinationType === settings.destinationType,
                  )}
                  onRunFavorite={handleRunFavorite}
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
                gate={gateLlm}
              />
            )}
          </>
        ))}

        <SettingsModal
          visible={settingsOpen}
          settings={settings}
          modelDownloaded={modelDownloaded}
          copilotAvailable={copilotAvailable}
          downloadPercent={downloadPercent}
          onDismiss={() => setSettingsOpen(false)}
          onSave={handleSave}
          testing={destTesting}
          testResult={destTestResult}
          onTest={handleTestDestination}
          onClearTest={handleClearTest}
          bedrockModels={bedrockModels}
          bedrockModelsLoading={bedrockModelsLoading}
          bedrockModelsError={bedrockModelsError}
          onListModels={handleListModels}
        />

        <AiConsentModal
          visible={consentOpen}
          onAccept={acceptConsent}
          onDecline={declineConsent}
        />
      </SpaceBetween>
    </div>
    </DateFormatProvider>
  );
}
