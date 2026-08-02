/**
/**
 * The desktop "host": the standalone equivalent of the extension's message
 * dispatch. It reuses the extension's vscode-free host modules (functions,
 * resources, awsSdkReflect) verbatim and maps the same webview message protocol
 * onto Electron IPC + native dialogs. AWS credentials come from the standard
 * SDK provider chain (env, ~/.aws, SSO), exactly like the extension.
 *
 * This is a PoC slice: the core Functions/Executions/Studio + AWS SDK method
 * flows are wired. AI generation (generate / generateWorkflow) is not yet ported
 * (it used VS Code's language-model API; the standalone build will route it to
 * Bedrock) — those messages are acknowledged with a clear notice.
 */
import { app, dialog } from "electron";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers";

import {
  getExecution,
  getFunctionInfo,
  getWorkflowDar,
  listDurableFunctions,
  listWorkflowStudioFunctions,
  listExecutions,
  startExecution,
  stopExecution,
  type AwsContext,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/functions";
import { listResources } from "../../aws-durable-execution-sdk-js-insight-vscode/src/resources";
import { describeStateMachine } from "../../aws-durable-execution-sdk-js-insight-vscode/src/resources";
import {
  generateNodeCode,
  generateWorkflowDar,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/agent";
import { generateChartSpec } from "../../aws-durable-execution-sdk-js-insight-vscode/src/llm";
import {
  QueryService,
  type QueryMode,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/queryService";
import { convertStateMachine } from "../../aws-durable-execution-sdk-js-insight-vscode/src/aslImport";
import { resolveInlineSources } from "../../aws-durable-execution-sdk-js-insight-vscode/src/lambdaSource";
import {
  setLocalModel,
  setLocalServer,
  type LlmProvider,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/llm";
import {
  deployWorkflow,
  requireLambdaFunctionName,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/deploy";
import {
  startDebugRun,
  type DebugRunnerHandle,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/remoteDebug/debugRunner";
import {
  deployStarterPackInfra,
  STARTER_PACKS,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/starterPacks/registry";
import { CfnDeployCancelledError } from "../../aws-durable-execution-sdk-js-insight-vscode/src/starterPacks/cfnDeploy";
import { inferResultTypes } from "../../aws-durable-execution-sdk-js-insight-vscode/src/inferTypes";
import {
  parseWorkflow,
  locateDarTsNodeLines,
  darTsNodeIdForLine,
  type PermissionAnalysis,
} from "@aws/durable-execution-sdk-js-cdk";
import { testDestination } from "../../aws-durable-execution-sdk-js-insight-vscode/src/destinationTest";
import { configFromWireSettings } from "../../aws-durable-execution-sdk-js-insight-vscode/src/configCore";
import { fetchDetailRecord } from "../../aws-durable-execution-sdk-js-insight-vscode/src/detailService";
import {
  isDarTsFile,
  parseDarTs,
  workflowFileToJsonText,
  workflowToDarTs,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/darTs";
import {
  listActions,
  reflectAction,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/awsSdkReflect";
import {
  listApiDirectory,
  listApiOperations,
  listApiVendors,
  reflectApiOperation,
} from "../../aws-durable-execution-sdk-js-insight-vscode/src/openApiReflect";
import type {
  DebugEvent,
  InboundMessage,
  OutboundMessage,
} from "../../aws-durable-execution-sdk-js-insight-vscode/webview-ui/src/types";
import { readFavorites, readSettings, writeSettings } from "./settings";

type Post = (msg: InboundMessage) => void;

// The AI query pipeline owns conversation state, so it persists across messages
// as a singleton; its `post` routes to whichever window is currently active.
let currentPost: Post | undefined;
let queryServiceSingleton: QueryService | undefined;
function queryService(): QueryService {
  if (!queryServiceSingleton) {
    queryServiceSingleton = new QueryService((m) => currentPost?.(m as never));
  }
  return queryServiceSingleton;
}

// Aborts an in-flight starter-pack infra deploy, keyed by requestId (see the
// "deployStarterPackInfra"/"cancelStarterPackDeploy" cases below).
const starterPackControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// In-Studio debugging (the "In-Studio debugger protocol" section in the
// webview's types.ts). The desktop app debugs deployed workflows with the
// SAME in-app runner as the VS Code extension
// (src/remoteDebug/debugRunner.ts): LDK debug layer + tunnel + our OWN CDP
// client, streamed to the webview's debug panel as "debugEvent"s. An earlier
// revision of this file called remote debugging a genuine platform gap
// ("nothing to be ported ONTO") — that was true while debugging meant
// attaching VS Code's js-debug, and stopped being true when the runner's own
// CDP client replaced vscode.debug on both hosts.
// ---------------------------------------------------------------------------

// Exactly one debug run at a time (mirrors the extension's activeDebugRun
// field): the run mutates the function's $LATEST config, so concurrent runs
// would fight over the single teardown path.
let activeDebugRun: DebugRunnerHandle | undefined;

// The desktop's breakpoint store. Electron has no vscode.debug breakpoint
// registry, but the in-app runner doesn't need one — it only needs 1-based
// `.dar.ts` line numbers to translate itself — so a plain in-memory map
// (saved workflow path → lines) IS the whole store. Not persisted across app
// restarts, by design (the gutter state it backs doesn't survive one either).
const breakpointStore = new Map<string, Set<number>>();

// The real on-disk path of the workflow currently open in Studio, if any —
// set when a file is opened or saved. Mirrors extension.ts's
// this.workflowFilePath: the deploy path writes the deployment-stamped
// .dar.ts back to it (so `meta.deploy` persists and a reopened file can
// reconnect to its Lambda) and records it as the source map's source (so
// debugger breakpoints bind to the user's real file, not the debug-folder
// copy). Undefined for a never-saved / deployed-function-loaded workflow.
let currentWorkflowPath: string | undefined;

/** `path`'s stored breakpoint lines, deduped and ascending. */
function breakpointLinesFor(path: string): number[] {
  return [...(breakpointStore.get(path) ?? [])].sort((a, b) => a - b);
}

/** The node ids whose `.dar.ts` declaration line is currently a breakpoint in
 *  `path` — the reverse of a node breakpoint (see the "toggleNodeBreakpoint"
 *  case). Reads `path`, runs the cdk's `locateDarTsNodeLines` (static parse,
 *  never executed), and keeps every node whose decl line is in the store's
 *  current line set. Empty when the file can't be read. */
function nodeIdsForBreakpoints(path: string): string[] {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const lineSet = new Set(breakpointLinesFor(path));
  const nodeIds: string[] = [];
  for (const [nodeId, line] of locateDarTsNodeLines(text)) {
    if (lineSet.has(line)) nodeIds.push(nodeId);
  }
  return nodeIds;
}

/** The node that owns `darLine` — its `.dar.ts` declaration line OR any line of
 *  its code body — resolved against `currentWorkflowPath`, so the canvas can
 *  glow the running node whether the pause landed on the node's operation entry
 *  or on a statement inside its code. Undefined when `darLine` is null, no path
 *  is tracked, the file can't be read, or the line belongs to no node. */
function pausedNodeIdFor(darLine: number | null): string | undefined {
  if (darLine == null || !currentWorkflowPath) return undefined;
  let text: string;
  try {
    text = readFileSync(currentWorkflowPath, "utf-8");
  } catch {
    return undefined;
  }
  return darTsNodeIdForLine(text, darLine);
}

/** Streams one event of the active debug run to the webview. */
function postDebugEvent(post: Post, event: DebugEvent): void {
  post({ type: "debugEvent", event });
}

// Deploy permission reviews awaiting an answer from the deploy modal, keyed by
// requestId. A deploy BLOCKS on its entry — the review used to be a native
// Electron message box, which crammed every statement into its detail text and
// put the decision outside the deploy modal the user was already looking at.
const permissionsReqs = new Map<string, (approved: boolean) => void>();
let permissionsReqSeq = 0;

/** Asks the webview to approve a deploy's inferred IAM permissions. */
function requestPermissionsApproval(
  post: Post,
  analysis: PermissionAnalysis,
  roleName: string,
): Promise<boolean> {
  const requestId = `perm-${++permissionsReqSeq}`;
  return new Promise<boolean>((resolve) => {
    permissionsReqs.set(requestId, resolve);
    post({
      type: "deployPermissionsRequest",
      requestId,
      roleName,
      statements: analysis.statements.map((s) => ({
        actions: s.actions,
        resources: s.resources,
        source: s.source,
      })),
      warnings: analysis.warnings,
    } as never);
  });
}

/** The deploy modal answered a permissions review. */
function resolvePermissionsApproval(
  requestId: string,
  approved: boolean,
): void {
  const resolve = permissionsReqs.get(requestId);
  if (!resolve) return; // Already answered, or a stale/unknown id.
  permissionsReqs.delete(requestId);
  resolve(approved);
}

// Aborts the in-flight Studio deploy at its next step boundary. No
// CloudFormation stack is involved (the deploy is direct Lambda/IAM calls), so
// this stops further calls rather than rolling anything back.
let deployAbort: AbortController | undefined;

/** Cooperatively cancels the in-flight deploy. Also settles any outstanding
 *  permissions review — the deploy is parked awaiting that answer, so aborting
 *  alone would not wake it. */
function cancelDeploy(): void {
  for (const resolve of permissionsReqs.values()) resolve(false);
  permissionsReqs.clear();
  deployAbort?.abort();
}

/**
 * LLM options for the AI features. Uses the configured provider (Copilot is
 * hidden in the desktop app, so this is Bedrock or a local provider) with the
 * app's AWS credentials + region and the configured Bedrock model.
 */
function agentOpts(): {
  provider: LlmProvider;
  region: string;
  credentials: ReturnType<typeof awsContext>["credentials"];
  modelId: string;
} {
  const s = readSettings();
  // Keep local providers pointed at the configured endpoints/models.
  setLocalModel(s.localModel);
  setLocalServer(s.localServerUrl, s.localServerModel);
  return {
    provider: (s.llmProvider || "bedrock") as LlmProvider,
    region: s.region || "us-east-1",
    credentials: awsContext().credentials,
    modelId: s.bedrockModelId || "us.anthropic.claude-sonnet-5",
  };
}

function awsContext(): AwsContext {
  const settings = readSettings();
  const profile = settings.awsProfile?.trim();
  return {
    region: settings.region || "us-east-1",
    credentials: profile ? fromIni({ profile }) : fromNodeProviderChain(),
  };
}

function sendConfig(post: Post): void {
  post({
    type: "config",
    settings: readSettings() as never,
    modelDownloaded: false,
    // Copilot uses VS Code's language-model API, which doesn't exist here.
    // Other providers (Bedrock/local) remain available.
    copilotAvailable: false,
  });
}

/** Route one message from the webview, replying via `post`. */
export async function handleMessage(
  msg: OutboundMessage,
  post: Post,
): Promise<void> {
  currentPost = post;
  switch (msg.type) {
    case "generate": {
      const cfg = configFromWireSettings(readSettings());
      return await queryService().runGenerate(
        msg.question,
        (msg.mode ?? "agent") as QueryMode,
        cfg,
        awsContext().credentials,
      );
    }
    case "ready":
      sendConfig(post);
      post({ type: "favorites", favorites: readFavorites() as never });
      return;

    case "setConsent":
      writeSettings({ aiDisclosureAcceptedVersion: msg.version });
      return;

    case "saveSettings":
      writeSettings(msg.settings);
      post({ type: "settingsSaved" });
      sendConfig(post);
      return;

    case "listFunctions":
      try {
        const functions = await listDurableFunctions(awsContext(), (partial) =>
          post({ type: "functionsList", functions: partial, loading: true }),
        );
        post({ type: "functionsList", functions, loading: false });
      } catch (e) {
        post({
          type: "functionsList",
          functions: [],
          loading: false,
          error: errMsg(e),
        });
      }
      return;

    case "getFunctionInfo":
      try {
        const info = await getFunctionInfo(awsContext(), msg.functionName);
        post({ type: "functionInfo", info });
      } catch (e) {
        post({ type: "functionInfo", info: null, error: errMsg(e) });
      }
      return;

    case "listExecutions":
      try {
        const { executions, nextMarker } = await listExecutions(awsContext(), {
          functionName: msg.functionName,
          qualifier: msg.qualifier,
          marker: msg.marker,
        });
        post({
          type: "executionsList",
          functionName: msg.functionName,
          executions,
          nextMarker,
        });
      } catch (e) {
        post({
          type: "executionsList",
          functionName: msg.functionName,
          executions: [],
          error: errMsg(e),
        });
      }
      return;

    case "getExecution":
      try {
        const detail = await getExecution(awsContext(), msg.arn);
        post({ type: "executionDetail", detail });
      } catch (e) {
        post({ type: "executionDetail", detail: null, error: errMsg(e) });
      }
      return;

    case "getExecutionWorkflow":
      // The Graph tab overlays live statuses on the function's embedded .dar
      // workflow. Fetch it from the function package (present only for functions
      // deployed from Workflow Studio); absent => the webview hides the tab.
      try {
        const raw = await getWorkflowDar(awsContext(), msg.functionArn);
        // getWorkflowDar returns whichever format was embedded (.dar.ts or
        // the legacy JSON .dar) as raw text — normalize to JSON-model text
        // for the graph-drawing webview, same as onOpenWorkflow's local-file
        // path already does.
        const dar = raw == null ? undefined : workflowFileToJsonText(raw);
        post({
          type: "executionWorkflow",
          arn: msg.arn,
          dar,
        });
      } catch (e) {
        post({ type: "executionWorkflow", arn: msg.arn, error: errMsg(e) });
      }
      return;

    case "stopExecution":
      try {
        await stopExecution(awsContext(), msg.arn);
        const detail = await getExecution(awsContext(), msg.arn);
        post({ type: "executionDetail", detail });
      } catch (e) {
        post({ type: "executionDetail", detail: null, error: errMsg(e) });
      }
      return;

    case "startExecution":
      try {
        const res = await startExecution(awsContext(), {
          functionName: msg.functionName,
          payload: msg.payload,
          executionName: msg.executionName,
        });
        post({
          type: "executionStarted",
          functionName: msg.functionName,
          durableExecutionArn: res.durableExecutionArn,
          statusCode: res.statusCode,
        });
      } catch (e) {
        post({
          type: "executionStarted",
          functionName: msg.functionName,
          error: errMsg(e),
        });
      }
      return;

    case "listSdkActions":
      try {
        const info = await listActions(msg.clientPackage);
        post({ type: "sdkActions", ...info });
      } catch (e) {
        post({
          type: "sdkActions",
          clientPackage: msg.clientPackage,
          error: errMsg(e),
        });
      }
      return;

    case "listApiVendors": {
      const dir = listApiDirectory();
      post({
        type: "apiVendors",
        vendors: listApiVendors(),
        directory: dir.entries,
        directoryGeneratedAt: dir.generatedAt,
      });
      return;
    }

    case "listApiOperations":
      try {
        const info = await listApiOperations(msg.spec);
        post({ type: "apiOperations", ...info });
      } catch (e) {
        post({
          type: "apiOperations",
          specId: msg.spec,
          error: errMsg(e),
        });
      }
      return;

    case "reflectApiOperation":
      try {
        const shape = await reflectApiOperation(msg.spec, msg.key);
        post({ type: "apiOperationShape", specId: msg.spec, ...shape });
      } catch (e) {
        post({
          type: "apiOperationShape",
          specId: msg.spec,
          key: msg.key,
          error: errMsg(e),
        });
      }
      return;

    case "reflectSdkAction":
      try {
        const shape = await reflectAction(msg.clientPackage, msg.command);
        post({
          type: "sdkActionShape",
          clientPackage: msg.clientPackage,
          ...shape,
        });
      } catch (e) {
        post({
          type: "sdkActionShape",
          clientPackage: msg.clientPackage,
          command: msg.command,
          error: errMsg(e),
        });
      }
      return;

    case "listResources":
      try {
        const items = await listResources(awsContext(), msg.resource);
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items,
        } as never);
      } catch (e) {
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items: [],
          error: errMsg(e),
        } as never);
      }
      return;

    case "workflowCode":
      try {
        post({
          type: "workflowCodeResult",
          requestId: msg.requestId,
          text: workflowToDarTs(msg.workflow as never),
        } as never);
      } catch (e) {
        post({
          type: "workflowCodeResult",
          requestId: msg.requestId,
          error: errMsg(e),
        } as never);
      }
      return;

    case "workflowFromCode":
      try {
        post({
          type: "workflowFromCodeResult",
          requestId: msg.requestId,
          dar: JSON.stringify(parseDarTs(msg.text)),
        } as never);
      } catch (e) {
        post({
          type: "workflowFromCodeResult",
          requestId: msg.requestId,
          error: errMsg(e),
        } as never);
      }
      return;

    case "toggleBreakpoint": {
      // The gutter's breakpoints live in the in-memory store above (the
      // desktop's equivalent of the extension's vscode.SourceBreakpoint
      // registry) — the in-app debug runner consumes them directly, so no
      // VS Code is involved anywhere in the chain anymore.
      const lines = breakpointStore.get(msg.path) ?? new Set<number>();
      if (lines.has(msg.line)) {
        lines.delete(msg.line);
      } else {
        lines.add(msg.line);
      }
      breakpointStore.set(msg.path, lines);
      post({
        type: "breakpointsChanged",
        path: msg.path,
        lines: breakpointLinesFor(msg.path),
        nodeIds: nodeIdsForBreakpoints(msg.path),
      });
      return;
    }

    case "toggleNodeBreakpoint": {
      // A node breakpoint IS a normal breakpoint on the node's `.dar.ts`
      // DECLARATION line — same in-memory store as code (body-line)
      // breakpoints, just addressed by node id. The host owns the
      // nodeId <-> line translation: read the file at `msg.path`, map the id
      // to its decl line via the cdk's `locateDarTsNodeLines`, then toggle
      // that line exactly like the "toggleBreakpoint" case above. A missing
      // file / unmapped id is a silent no-op (nothing real to target).
      let text: string;
      try {
        text = readFileSync(msg.path, "utf-8");
      } catch {
        return;
      }
      const line = locateDarTsNodeLines(text).get(msg.nodeId);
      if (line === undefined) return;
      const lines = breakpointStore.get(msg.path) ?? new Set<number>();
      if (lines.has(line)) {
        lines.delete(line);
      } else {
        lines.add(line);
      }
      breakpointStore.set(msg.path, lines);
      post({
        type: "breakpointsChanged",
        path: msg.path,
        lines: breakpointLinesFor(msg.path),
        nodeIds: nodeIdsForBreakpoints(msg.path),
      });
      return;
    }

    case "getBreakpoints":
      // Starts the code view's gutter in sync with the store (sent once the
      // view mounts) — mirrors the extension's onGetBreakpoints.
      post({
        type: "breakpointsChanged",
        path: msg.path,
        lines: breakpointLinesFor(msg.path),
        nodeIds: nodeIdsForBreakpoints(msg.path),
      });
      return;

    case "runWorkflow": {
      // Execute (debug:false) is plain AWS SDK work — same startExecution
      // pipeline as the Durable Functions view above, fully supported here.
      if (!msg.debug) {
        try {
          const res = await startExecution(awsContext(), {
            functionName: msg.functionName,
            payload: msg.payload,
            executionName: msg.executionName,
          });
          post({
            type: "executionStarted",
            functionName: msg.functionName,
            durableExecutionArn: res.durableExecutionArn,
            statusCode: res.statusCode,
          });
        } catch (e) {
          post({
            type: "executionStarted",
            functionName: msg.functionName,
            error: errMsg(e),
          });
        }
        return;
      }
      // debug:true — the same in-app debug run as the VS Code extension
      // (see the debugging section's module comment above): startDebugRun
      // attaches the LDK debug layer, invokes the function, and drives the
      // sandbox's inspector with our own CDP client, streaming everything
      // to the webview's debug panel.
      const functionName = msg.functionName;
      // Source maps come from the last deploy-with-debug-info — computed the
      // SAME way the "deployWorkflow" case below does, so the two always
      // agree on where the artifacts live (Documents/WorkflowStudioDebug —
      // see that case's rationale for why not a temp dir).
      const debugOutDir = join(
        app.getPath("documents"),
        "WorkflowStudioDebug",
        requireLambdaFunctionName(functionName),
      );
      // index.js.map is the deploy's own "debug info exists" marker: refuse
      // up front with the fix (startDebugRun re-checks, but failing here
      // keeps the error ahead of any progress noise).
      if (!existsSync(join(debugOutDir, "index.js.map"))) {
        postDebugEvent(post, {
          kind: "error",
          message:
            `No debug info found for "${functionName}". Deploy the workflow ` +
            `first (every deploy includes debug info), then try again.`,
        });
        return;
      }
      // One run at a time (see activeDebugRun's doc comment).
      if (activeDebugRun) {
        postDebugEvent(post, {
          kind: "error",
          message:
            "A debug session is already running. Stop it before starting another.",
        });
        return;
      }

      // SIMPLIFICATION: this host doesn't track which saved workflow file
      // the webview currently has open (the extension keeps
      // workflowFilePath for that), so the initial breakpoint set is read
      // from the store only when it's unambiguous — exactly one stored path
      // with breakpoints. With zero or several candidate paths the run
      // starts with none, and the webview's gutter push
      // ("debugSetBreakpoints", sent on any toggle during the session)
      // still applies breakpoints mid-run.
      const storedPaths = [...breakpointStore.keys()].filter(
        (p) => (breakpointStore.get(p)?.size ?? 0) > 0,
      );
      const initialBreakpointDarLines =
        storedPaths.length === 1 ? breakpointLinesFor(storedPaths[0]) : [];

      // Terminal-event bookkeeping (mirrors the extension): onDone/onError
      // can fire BEFORE startDebugRun's resolution reaches us, so the
      // handle is only stored if the run hasn't already ended.
      let handle: DebugRunnerHandle | undefined;
      let ended = false;
      const endRun = (): void => {
        ended = true;
        if (handle && activeDebugRun === handle) {
          activeDebugRun = undefined;
        }
      };

      const ctx = awsContext();
      try {
        const started = await startDebugRun({
          region: ctx.region,
          credentials: ctx.credentials,
          functionName,
          payloadJson: msg.payload.trim() || "{}",
          executionName: msg.executionName,
          debugOutDir,
          initialBreakpointDarLines,
          events: {
            onStatus: (message) =>
              postDebugEvent(post, { kind: "status", message }),
            onPaused: (p) =>
              postDebugEvent(post, {
                kind: "paused",
                darLine: p.darLine,
                functionName: p.functionName,
                // If the paused `.dar.ts` line IS a node's declaration line,
                // include that node id so the canvas can glow the paused node
                // (reverse of a node breakpoint).
                pausedNodeId: pausedNodeIdFor(p.darLine),
                // The protocol's frames carry no bundleLine (the UI never
                // shows bundle coordinates) — drop it here.
                callStack: p.callStack.map((f) => ({
                  functionName: f.functionName,
                  darLine: f.darLine,
                })),
                scopes: p.scopes,
              }),
            onResumed: () => postDebugEvent(post, { kind: "resumed" }),
            onDone: (result) => {
              postDebugEvent(post, {
                kind: "done",
                statusCode: result.statusCode,
                payload: result.payload,
                logTail: result.logTail,
              });
              endRun();
            },
            onError: (message) => {
              postDebugEvent(post, { kind: "error", message });
              endRun();
            },
          },
        });
        handle = started;
        if (!ended) {
          activeDebugRun = handle;
        }
        postDebugEvent(post, { kind: "started", functionName });
      } catch (e) {
        // startDebugRun tears its own partial work down before rethrowing.
        postDebugEvent(post, { kind: "error", message: errMsg(e) });
      }
      return;
    }

    case "deployPermissionsResponse": {
      resolvePermissionsApproval(
        String((msg as { requestId?: unknown }).requestId ?? ""),
        (msg as { approved?: unknown }).approved === true,
      );
      return;
    }

    case "debugCommand": {
      // Mirrors the extension's onDebugCommand: a command with no active
      // run (a stale click racing the run's completion) is a no-op answered
      // with a status line — the session is simply gone, not broken.
      const handle = activeDebugRun;
      if (!handle) {
        postDebugEvent(post, {
          kind: "status",
          message: `Ignored "${msg.command}" — no debug session is active.`,
        });
        return;
      }
      if (msg.command === "stop") {
        // stop() tears everything down WITHOUT emitting onDone/onError (the
        // runner treats the invoke's settle after a user stop as fallout,
        // not a result) — synthesize the terminal event here so the
        // webview's panel leaves its running state.
        activeDebugRun = undefined;
        await handle.stop();
        postDebugEvent(post, {
          kind: "error",
          message: "Debug session stopped.",
        });
        return;
      }
      try {
        switch (msg.command) {
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
        postDebugEvent(post, { kind: "status", message: errMsg(e) });
      }
      return;
    }

    case "debugGetProperties": {
      // Lazily expands a paused frame's scope (or a nested object) for the
      // webview's variables tree — mirrors the extension.
      const handle = activeDebugRun;
      if (!handle) {
        post({
          type: "debugProperties",
          requestId: msg.requestId,
          properties: [],
          error: "No debug session is active.",
        });
        return;
      }
      try {
        const properties = await handle.getProperties(msg.objectId);
        post({ type: "debugProperties", requestId: msg.requestId, properties });
      } catch (e) {
        post({
          type: "debugProperties",
          requestId: msg.requestId,
          properties: [],
          error: errMsg(e),
        });
      }
      return;
    }

    case "debugSetBreakpoints": {
      // Gutter toggles during an active run: retranslate and REPLACE the
      // live set, answering with the lines that actually bound. With no
      // active run this is dropped silently — the gutter itself is owned by
      // "breakpointsChanged", which is unaffected. Mirrors the extension.
      const handle = activeDebugRun;
      if (!handle) return;
      try {
        const bound = await handle.setBreakpoints(
          msg.darLines.filter(
            (l) => typeof l === "number" && Number.isFinite(l),
          ),
        );
        postDebugEvent(post, { kind: "boundBreakpoints", darLines: bound });
      } catch (e) {
        postDebugEvent(post, {
          kind: "status",
          message: `Couldn't update breakpoints: ${errMsg(e)}`,
        });
      }
      return;
    }

    case "saveWorkflow": {
      // `.dar.ts` is the only user-facing format; the webview sends the JSON
      // model text (internal wire shape) and the host converts.
      const safe =
        (msg.name || "workflow")
          .replace(/[^\w.-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "workflow";
      const res = await dialog.showSaveDialog({
        defaultPath: `${safe}.dar.ts`,
        filters: [{ name: "Durable workflow", extensions: ["ts"] }],
      });
      if (res.canceled || !res.filePath) return;
      try {
        // Normalize whatever suffix the platform dialog produced to `.dar.ts`.
        let path = res.filePath;
        if (!isDarTsFile(path)) {
          path = `${path.replace(/(\.dar)?(\.ts)?$/i, "")}.dar.ts`;
        }
        // The OS overwrite prompt covered the ORIGINAL path — if normalizing
        // changed it and the new path exists, ask before clobbering.
        if (path !== res.filePath && existsSync(path)) {
          const { response } = await dialog.showMessageBox({
            type: "warning",
            message: `${path.split(/[\\/]/).pop()} already exists. Replace it?`,
            buttons: ["Replace", "Cancel"],
            defaultId: 1,
          });
          if (response !== 0) return;
        }
        writeFileSync(path, workflowToDarTs(JSON.parse(msg.content)), "utf-8");
        currentWorkflowPath = path;
        post({ type: "workflowSaved", path } as never);
      } catch (e) {
        await dialog.showMessageBox({
          type: "error",
          message: "Couldn't save the workflow",
          detail: errMsg(e),
        });
      }
      return;
    }

    case "exportData":
      await saveTextFile(msg.filename, msg.content, [
        { name: "Data", extensions: [msg.format] },
      ]);
      return;

    case "exportChart": {
      // Mirrors the extension's onExportChart: SVG is text; PNG arrives as a
      // data URL whose base64 payload we decode.
      const ext = msg.format === "svg" ? "svg" : "png";
      const res = await dialog.showSaveDialog({
        defaultPath: msg.filename || `chart.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (res.canceled || !res.filePath) return;
      if (msg.format === "svg") {
        writeFileSync(res.filePath, msg.content, "utf-8");
      } else {
        writeFileSync(
          res.filePath,
          Buffer.from(msg.content.split(",")[1] ?? "", "base64"),
        );
      }
      return;
    }

    case "fetchDetail": {
      // Expand-row detail fetch — shares the destination dispatch with the
      // extension via the vscode-free detailService.
      const cfg = configFromWireSettings(readSettings());
      try {
        const record = await fetchDetailRecord(cfg, awsContext().credentials, {
          idValue: msg.idValue,
          year: msg.year,
          month: msg.month,
          day: msg.day,
        });
        if (!record) {
          post({
            type: "error",
            message: `Couldn't find a record for ${msg.idColumn} = ${msg.idValue}.`,
          });
          return;
        }
        post({ type: "detailResult", fields: record } as never);
      } catch (e) {
        post({
          type: "error",
          message: `Failed to fetch record detail: ${errMsg(e)}`,
        });
      }
      return;
    }

    case "testDestination":
      try {
        const result = await testDestination(
          configFromWireSettings(msg.settings),
        );
        post({ type: "destinationTestResult", result });
      } catch (e) {
        post({
          type: "destinationTestResult",
          result: { ok: false, summary: errMsg(e), checks: [] },
        });
      }
      return;

    case "openWorkflow": {
      const res = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "Durable workflow", extensions: ["ts", "dar", "json"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (res.canceled || res.filePaths.length === 0) return;
      const path = res.filePaths[0];
      const raw = await readFile(path, "utf-8");
      let content: string;
      try {
        // Sniffs content (legacy JSON vs .dar.ts) — static parse only.
        content = workflowFileToJsonText(raw);
      } catch (e) {
        await dialog.showMessageBox({
          type: "error",
          message: "Couldn't open workflow",
          detail: errMsg(e),
        });
        return;
      }
      const name = path.split(/[\\/]/).pop() ?? "workflow";
      currentWorkflowPath = path;
      post({ type: "workflowLoaded", name, content, path } as never);
      return;
    }

    case "listEditableFunctions": {
      // The webview drives a proper searchable/scrollable Cloudscape modal
      // (EditFunctionModal) instead of a native dialog — Electron's
      // dialog.showMessageBox only supports a handful of plain buttons with
      // no scrolling, which doesn't work once an account has more than a few
      // editable functions.
      try {
        const fns = await listWorkflowStudioFunctions(awsContext());
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items: fns.map((f) => ({ label: f.name, value: f.name })),
        });
      } catch (e) {
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items: [],
          error: errMsg(e),
        });
      }
      return;
    }

    case "listStateMachines":
      try {
        const items = await listResources(awsContext(), "stateMachineArn");
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items,
        } as never);
      } catch (e) {
        post({
          type: "resourceList",
          requestId: msg.requestId,
          items: [],
          error: errMsg(e),
        } as never);
      }
      return;

    case "importStateMachine":
      try {
        const { definition } = await describeStateMachine(
          awsContext(),
          msg.arn,
        );
        if (!definition.trim()) {
          throw new Error("The state machine has no readable definition.");
        }
        let inline:
          | Awaited<ReturnType<typeof resolveInlineSources>>
          | undefined;
        if (msg.inlineLambdas) {
          try {
            inline = await resolveInlineSources(
              awsContext(),
              JSON.parse(definition),
            );
          } catch (e) {
            inline = {
              sources: new Map(),
              notes: [
                `Could not inspect Lambda sources; kept invokes: ${errMsg(e)}`,
              ],
            };
          }
        }
        const maxIterations = Number(readSettings().agenticMaxIterations) || 8;
        const result = await convertStateMachine(
          agentOpts(),
          definition,
          maxIterations,
          (ev) =>
            post({
              type: "importProgress",
              requestId: msg.requestId,
              ...ev,
            } as never),
          inline,
        );
        post({
          type: "agentWorkflow",
          requestId: msg.requestId,
          dar: result.dar,
          notes: result.notes,
          faithful: result.faithful,
        } as never);
      } catch (e) {
        post({
          type: "agentWorkflow",
          requestId: msg.requestId,
          error: errMsg(e),
        } as never);
      }
      return;

    case "deployStarterPackInfra":
      const controller = new AbortController();
      starterPackControllers.set(msg.requestId, controller);
      try {
        if (!Object.prototype.hasOwnProperty.call(STARTER_PACKS, msg.packId)) {
          throw new Error(`Unknown starter pack id "${msg.packId}".`);
        }
        const result = await deployStarterPackInfra(
          msg.packId as keyof typeof STARTER_PACKS,
          {
            ...awsContext(),
            signal: controller.signal,
            onProgress: (progress) =>
              post({
                type: "starterPackInfraProgress",
                requestId: msg.requestId,
                message: progress.message,
                resources: progress.resources,
              } as never),
          },
        );
        post({
          type: "starterPackInfraResult",
          requestId: msg.requestId,
          dar: result.dar,
        } as never);
      } catch (e) {
        post({
          type: "starterPackInfraResult",
          requestId: msg.requestId,
          error: errMsg(e),
          cancelled: e instanceof CfnDeployCancelledError,
        } as never);
      } finally {
        starterPackControllers.delete(msg.requestId);
      }
      return;

    case "cancelStarterPackDeploy":
      starterPackControllers.get(msg.requestId)?.abort();
      return;

    case "generateWorkflow":
      try {
        const dar = await generateWorkflowDar(agentOpts(), msg.description);
        post({ type: "agentWorkflow", requestId: msg.requestId, dar } as never);
      } catch (e) {
        post({
          type: "agentWorkflow",
          requestId: msg.requestId,
          error: errMsg(e),
        } as never);
      }
      return;

    case "generateNodeCode":
      try {
        const code = await generateNodeCode(agentOpts(), {
          kind: msg.kind,
          field: msg.field,
          name: msg.name,
          description: msg.description,
          scope: msg.scope,
          inputType: msg.inputType,
          currentCode: msg.currentCode,
        });
        post({ type: "agentNodeCode", requestId: msg.requestId, code });
      } catch (e) {
        post({
          type: "agentNodeCode",
          requestId: msg.requestId,
          error: errMsg(e),
        });
      }
      return;

    case "editFunctionWorkflow":
      // The Functions view's "Edit in Workflow Studio" button.
      try {
        const raw = await getWorkflowDar(awsContext(), msg.functionName);
        if (raw == null) {
          await dialog.showMessageBox({
            type: "error",
            message: `"${msg.functionName}" has no embedded workflow.dar.ts.`,
          });
          return;
        }
        // Normalize whichever format was embedded (.dar.ts or the legacy
        // JSON .dar) to JSON-model text.
        const content = workflowFileToJsonText(raw);
        // Loaded from a deployed function — no real local file backs it, so
        // clear the tracked path (deploy won't wrongly write to a stale one).
        currentWorkflowPath = undefined;
        post({ type: "workflowLoaded", name: msg.functionName, content });
      } catch (e) {
        await dialog.showMessageBox({
          type: "error",
          message: `Couldn't open "${msg.functionName}"`,
          detail: errMsg(e),
        });
      }
      return;

    case "inferTypes":
      try {
        const types = inferResultTypes(
          msg.items as never,
          (msg.seedTypes as Record<string, string> | undefined) ?? {},
          msg.inputType as string | undefined,
        );
        post({ type: "inferTypesResult", requestId: msg.requestId, types });
      } catch {
        post({ type: "inferTypesResult", requestId: msg.requestId, types: {} });
      }
      return;

    case "newSession":
      queryService().clearConversation();
      post({ type: "sessionCleared" });
      return;

    case "setMode":
      writeSettings({ queryMode: msg.mode });
      return;

    case "deployWorkflow": {
      const ctx = awsContext();
      const settings = readSettings();
      const functionName = msg.functionName;
      deployAbort = new AbortController();
      try {
        const workflow = parseWorkflow(msg.workflow);
        // `.dar.ts` is the current first-class format for both authoring and
        // the deploy artifact (dar-ts-specification.md's Phase 2) — always
        // built and embedded, not just when debugging. Generated fresh on
        // every deploy from the webview's current JSON wire-format state
        // (same conversion the "Save" path already applies).
        //
        // Stamp the deployment record into the model FIRST so the generated
        // text's trailing `meta.deploy` block carries it (functionName +
        // region + timestamp) — mirrors extension.ts's onDeployWorkflow. That
        // record is what lets a reopened file reconnect to its Lambda for
        // one-click debugging.
        const workflowJsonWithDeploy = {
          ...(msg.workflow as Record<string, unknown>),
          deploy: {
            functionName,
            region: ctx.region,
            deployedAt: new Date().toISOString(),
          },
        };
        const darTsText = workflowToDarTs(workflowJsonWithDeploy as never);
        // Persist the deployment-stamped text back into the user's REAL
        // saved file (when one is open) BEFORE deploying — so `meta.deploy`
        // survives a reopen AND the on-disk == deployed invariant holds,
        // which is what darSourceAbsolutePath below relies on. `meta` sits
        // at the file's very bottom, so this never shifts function-body line
        // numbers (breakpoints stay valid).
        let darSourceAbsolutePath: string | undefined;
        if (currentWorkflowPath) {
          try {
            writeFileSync(currentWorkflowPath, darTsText, "utf-8");
            darSourceAbsolutePath = currentWorkflowPath;
          } catch {
            // Read-only/missing — deploy proceeds; only the reopen
            // convenience + real-file breakpoint binding are lost.
          }
        }
        post({
          type: "deployStatus",
          status: "progress",
          message: `Deploying "${functionName}" to ${ctx.region}…`,
        });
        // Mirrors extension.ts's onDeployWorkflow — kept in sync by hand (no
        // Debug info (source map + local artifacts) is ALWAYS generated now
        // — debugging a deployed workflow is a headline feature and the
        // .dar.ts source is embedded in every deploy regardless (see
        // extension.ts's onDeployWorkflow for the matching rationale). A
        // genuinely stable, persistent location — Electron has no "workspace
        // folder" concept the way VS Code does, so this uses the user's real
        // Documents folder rather than an OS temp dir (which would defeat
        // debugOutDir needing to outlive a single deploy call — see
        // deploy.ts's DeployOptions.debugOutDir doc comment).
        const debugOutDir = join(
          app.getPath("documents"),
          "WorkflowStudioDebug",
          requireLambdaFunctionName(functionName),
        );
        const darSourceFileName = `${functionName}.dar.ts`;
        const result = await deployWorkflow({
          region: ctx.region,
          credentials: ctx.credentials,
          functionName,
          roleArn: settings.lambdaRoleArn?.trim() || undefined,
          retentionDays: Number(settings.deployRetentionDays) || 7,
          workflow,
          darTsText,
          // Flat string store, so compare the string (see enableDagMode's doc).
          allowDagMode: settings.enableDagMode === "true",
          debugOutDir,
          darSourceFileName,
          darSourceAbsolutePath,
          onProgress: (message) =>
            post({ type: "deployStatus", status: "progress", message }),
          confirmOverwrite: async () => {
            const r = await dialog.showMessageBox({
              type: "warning",
              message: `Update existing function "${functionName}"?`,
              detail: `A Lambda named "${functionName}" already exists in ${ctx.region}. Deploying will update it and publish a new version.`,
              buttons: ["Update", "Cancel"],
              cancelId: 1,
              defaultId: 0,
            });
            return r.response === 0;
          },
          confirmPermissions: (analysis) =>
            requestPermissionsApproval(post, analysis, `${functionName}-role`),
          signal: deployAbort.signal,
        });
        post({ type: "deployStatus", status: "done", result } as never);
      } catch (e) {
        post({
          type: "deployStatus",
          status: "error",
          // A DeployCancelledError's message names what was already applied —
          // never flatten it, or "cancelled" reads as "nothing happened".
          message: errMsg(e),
        } as never);
      } finally {
        deployAbort = undefined;
      }
      return;
    }

    case "cancelDeploy": {
      cancelDeploy();
      return;
    }

    case "visualize":
      try {
        const spec = await generateChartSpec({
          ...agentOpts(),
          columns: msg.columns,
          numericColumns: msg.numericColumns,
          chartType: msg.chartType,
          description: msg.description,
        });
        post({ type: "chartSpec", spec, requestId: msg.requestId } as never);
      } catch (e) {
        post({
          type: "chartSpecError",
          message: errMsg(e),
          requestId: msg.requestId,
        } as never);
      }
      return;

    default:
      // AI generation and a few VS Code-only flows aren't ported in this PoC.
      // eslint-disable-next-line no-console
      console.warn(`[insight-desktop] unhandled message: ${msg.type}`);
      return;
  }
}

async function saveTextFile(
  defaultName: string,
  content: string,
  filters: { name: string; extensions: string[] }[],
): Promise<void> {
  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters,
  });
  if (res.canceled || !res.filePath) return;
  writeFileSync(res.filePath, content, "utf-8");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
