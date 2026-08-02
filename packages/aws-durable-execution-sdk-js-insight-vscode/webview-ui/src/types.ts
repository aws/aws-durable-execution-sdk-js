/** Query execution mode chosen in the composer. */
export type QueryMode = "query" | "ask" | "agent";

/** Result of a successful Studio deploy. */
export interface DeployResult {
  functionArn: string;
  version: string;
  aliasArn: string;
  region: string;
  executionTimeoutSeconds: number;
}

/** Deploy progress streamed from the host during a Studio deploy. */
export type DeployStatus =
  | { status: "progress"; message: string }
  | { status: "done"; result: DeployResult }
  | { status: "error"; message: string };

/**
 * One IAM statement inferred from the workflow's code, for review before it is
 * attached to the function's auto-created role. Mirrors the cdk's
 * `InferredStatement` — restated here because the webview bundle must not
 * import host-side packages.
 */
export interface DeployPermissionStatement {
  actions: string[];
  resources: string[];
  /** Human-readable origin, e.g. the node whose code implied it. */
  source: string;
}

/** A pending permissions review, blocking the deploy until answered. */
export interface DeployPermissionsRequest {
  requestId: string;
  roleName: string;
  statements: DeployPermissionStatement[];
  warnings: string[];
}

/** A durable function in the region (for the Durable Functions view picker). */
export interface FunctionSummary {
  name: string;
  runtime?: string;
  lastModified?: string;
  packageType?: string;
}

/** Metadata for a single durable function. */
export interface FunctionInfo {
  name: string;
  runtime?: string;
  memorySize?: number;
  timeout?: number;
  executionTimeoutSeconds?: number;
  retentionDays?: number;
  lastModified?: string;
  codeSize?: number;
  version?: string;
  handler?: string;
  description?: string;
  /** True when the package embeds an editable `.dar` (Workflow Studio). */
  editable?: boolean;
}

/** One durable execution row in the executions table. */
export interface ExecutionRow {
  arn: string;
  name: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

/** Full detail for a single durable execution (Execution Detail view). */
export interface ExecutionDetail {
  arn: string;
  name?: string;
  functionArn?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  version?: string;
  input?: string;
  result?: string;
  error?: string;
  history?: HistoryEvent[];
  operations?: OperationNode[];
}

/** One event in a durable execution's history (an operation / node event). */
export interface HistoryEvent {
  eventId?: number;
  type?: string;
  subType?: string;
  name?: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
}

/** An operation aggregated from its history events; nested via parentId. */
export interface OperationNode {
  id: string;
  parentId?: string;
  name?: string;
  kind?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  result?: string;
  error?: string;
  children?: OperationNode[];
}

/** A saved query the user can re-run from the composer. */
export interface Favorite {
  id: string;
  label: string;
  query: string;
  destinationType: string;
}

/** One operation of an AWS SDK client (from host reflection). */
export interface SdkAction {
  /** Operation name without the `Command` suffix, e.g. `PutItem`. */
  name: string;
  /** The command class name, e.g. `PutItemCommand`. */
  command: string;
}

/**
 * One third-party API in the Studio catalog, mirrored from the host's
 * `openApiCatalog.ts`. `authEnvVar` is only ever a variable NAME.
 */
export interface ApiVendor {
  id: string;
  label: string;
  specUrl: string;
  docsUrl: string;
  baseUrl?: string;
  auth: {
    kind: "none" | "bearer" | "header" | "basic" | "query";
    name?: string;
    envVar: string;
    hint?: string;
  };
}

/**
 * One entry in the community-indexed API directory. Uncurated: no auth config,
 * only the vendor's own spec location.
 */
export interface ApiDirectoryEntry {
  id: string;
  title: string;
  provider: string;
  specUrl: string;
}

/** One operation listed from a vendor's OpenAPI spec. */
export interface ApiOperation {
  /** "GET /v1/charges" — stable within its spec. */
  key: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  hasBody: boolean;
}

/** One reflected request parameter of an API operation. */
export interface ApiParam {
  name: string;
  /** "path" | "query" | "header". */
  location: string;
  required: boolean;
  type: string;
  description?: string;
}

/** One reflected top-level input member of an AWS SDK operation. */
export interface SdkField {
  name: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "blob"
    | "timestamp"
    | "list"
    | "map"
    | "struct"
    | "document"
    | "unknown";
  /** Best-effort binding-trait hint (client schemas omit `@required`). */
  required: boolean;
}

/**
 * Starter pack id; literal union so adding packs is a small extension. Kept
 * in sync with the host's own copy in
 * `src/starterPacks/registry.ts`'s `StarterPackId` (host and webview declare
 * their own type files by existing convention — see this file's other
 * "kept in sync" notes).
 */
export type StarterPackId =
  | "hl"
  | "tt"
  | "cbt"
  | "jsp"
  | "dpp"
  | "ebce"
  | "bpc";

// ---------------------------------------------------------------------------
// In-Studio debugger protocol
// ---------------------------------------------------------------------------
// The debug session renders INSIDE Workflow Studio (no VS Code debug tab), so
// both hosts — the VS Code extension AND the Electron desktop app — bridge the
// same event/command shapes from ../src/remoteDebug/debugRunner.ts to these
// messages. Kept in sync with the hosts' own copies (host and webview declare
// their own type files by existing convention — see this file's other
// "kept in sync" notes).

/** One frame of a paused call stack, in user (`.dar.ts`) coordinates.
 * `darLine` is null for frames outside the user's workflow source
 * (SDK/runtime code). Lines are 1-based. Webview copy of the host's
 * DebugCallStackFrame, minus `bundleLine` (the UI never shows bundle
 * coordinates). */
export interface DebugStackFrame {
  functionName: string;
  darLine: number | null;
}

/** One scope of the paused frame's scope chain (CDP scope types: "local",
 * "closure", "global", ...). `objectId` is the remote-object handle to fetch
 * the scope's variables with (absent for scopes with nothing to expand). */
export interface DebugScope {
  type: string;
  objectId?: string;
}

/** One event of a debug run, streamed host → webview (mirrors the host's
 * DebugRunnerEvents callbacks, plus `started`/`boundBreakpoints` which the
 * hosts synthesize around the runner's lifecycle). */
export type DebugEvent =
  | { kind: "status"; message: string }
  | { kind: "started"; functionName: string }
  | {
      kind: "paused";
      darLine: number | null;
      functionName?: string;
      /** The node whose `.dar.ts` DECLARATION line equals the paused `darLine`,
       *  if any (host computes it via a reverse lookup against
       *  locateDarTsNodeLines) — lets the canvas glow the paused node. Absent
       *  when the pause is on a code body line that isn't a node's decl line. */
      pausedNodeId?: string;
      callStack: DebugStackFrame[];
      scopes: DebugScope[];
    }
  | { kind: "resumed" }
  | { kind: "done"; statusCode?: number; payload: string; logTail?: string }
  | { kind: "error"; message: string }
  // The `.dar.ts` lines that actually bound after a (re)translation. Lines
  // mapping to no generated code are dropped host-side: blank/comment lines,
  // and the declaration line of a node the generator emits nothing for (a
  // `start` node). Not re-emitted when a run re-attaches to a new sandbox —
  // which lines CAN bind depends only on the deploy's source map, so the
  // answer is the same for every invocation of one run.
  | { kind: "boundBreakpoints"; darLines: number[] };

/** A variable's value summary (CDP RemoteObject slice): `objectId` present
 * means it has own properties and can be expanded lazily via
 * "debugGetProperties". */
export interface DebugPropertyValue {
  type: string;
  description?: string;
  objectId?: string;
}

/** One named property of an expanded scope/object. */
export interface DebugProperty {
  name: string;
  value: DebugPropertyValue;
}

/** Messages from webview → extension host */
export type OutboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string; mode: QueryMode }
  | { type: "setMode"; mode: QueryMode }
  | { type: "setConsent"; version: string }
  | { type: "newSession" }
  // Workflow Studio: the webview builds the .dar JSON text; the host shows a
  // save dialog and writes it (mirrors the exportData pattern).
  | { type: "saveWorkflow"; name: string; content: string }
  // Deploy the current workflow as a durable Lambda (host runs the pipeline and
  // streams back "deployStatus"). `workflow` is the .dar object.
  | { type: "deployWorkflow"; functionName: string; workflow: unknown }
  // One-click remote debug of an already-deployed workflow: the host attaches
  // the LDK debug layer, invokes the function, and attaches VS Code's
  // debugger (kept in sync with InboundMessage in ../src/extension.ts — host
  // and webview declare their own type files by existing convention).
  | {
      type: "runWorkflow";
      functionName: string;
      payload: string;
      executionName?: string;
      debug: boolean;
    }
  // In-Studio debugger (see the "In-Studio debugger protocol" section above).
  // A stepping/continue/stop command for the active debug session. Ignored
  // host-side when no session is active (e.g. a stale click racing "done").
  | {
      type: "debugCommand";
      command: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop";
    }
  // Lazily expand a paused frame's scope (or a nested object) — the host
  // replies with "debugProperties" correlated by `requestId`. `objectId` is
  // the remote-object handle from a "paused" event's scopes or a previous
  // "debugProperties" reply.
  | { type: "debugGetProperties"; requestId: string; objectId: string }
  // Answer to a "deployPermissionsRequest": the deploy is blocked until this
  // arrives. `approved: false` means deploy WITHOUT attaching the inferred
  // policy (the function still deploys — it just may lack permissions at
  // runtime), matching what dismissing the old native dialog did.
  | {
      type: "deployPermissionsResponse";
      requestId: string;
      approved: boolean;
    }
  // Stop the in-flight Studio deploy. COOPERATIVE: the host stops issuing
  // further Lambda/IAM calls at the next step boundary — there is no
  // CloudFormation stack to roll back, so anything already applied stays, and
  // the resulting error message says what that was.
  | { type: "cancelDeploy" }
  // The user toggled gutter breakpoints DURING an active session: the full
  // current 1-based `.dar.ts` line set (REPLACE semantics — the host
  // retranslates everything and answers with kind:'boundBreakpoints').
  // "breakpointsChanged" remains the source of truth for the line list
  // itself; this only pushes it into the live session.
  | { type: "debugSetBreakpoints"; darLines: number[] }
  // Workflow Studio's code view gutter: the user clicked a line's glyph
  // margin. `path` is the SAVED `.dar.ts` file's absolute path on disk (the
  // webview has no filesystem access — the host resolves/tracks this from
  // the last save/deploy); a click when no such path exists yet is a no-op
  // on the host side (nothing to set a real vscode.SourceBreakpoint against
  // — see extension.ts's onToggleBreakpoint). `line` is 1-based.
  | { type: "toggleBreakpoint"; path: string; line: number }
  // Workflow Studio's CANVAS: the user clicked a node's breakpoint dot. A
  // node breakpoint is modelled as a normal breakpoint on that node's
  // `.dar.ts` DECLARATION line — the host owns the nodeId <-> line
  // translation (it reads `path` and runs the cdk's locateDarTsNodeLines),
  // then toggles it in the SAME breakpoint store as code (body-line)
  // breakpoints. `path` is the SAVED `.dar.ts` file's absolute path (a click
  // when no such path exists yet is a no-op host-side, like toggleBreakpoint).
  | { type: "toggleNodeBreakpoint"; path: string; nodeId: string }
  // Requests the current real breakpoint set for `path` (sent once the code
  // view mounts, so it starts in sync with whatever VS Code already has —
  // e.g. breakpoints set via a normal editor tab before Studio was opened).
  | { type: "getBreakpoints"; path: string }
  // Durable Functions view.
  | { type: "listFunctions" }
  | { type: "getFunctionInfo"; functionName: string }
  | { type: "editFunctionWorkflow"; functionName: string }
  | { type: "listSdkActions"; clientPackage: string }
  | { type: "reflectSdkAction"; clientPackage: string; command: string }
  | { type: "listApiVendors" }
  /** `spec` is a catalog vendor id or a raw https:// OpenAPI spec URL. */
  | { type: "listApiOperations"; spec: string }
  | { type: "reflectApiOperation"; spec: string; key: string }
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
  // Ask the host to show an open dialog and read a .dar file back.
  | { type: "openWorkflow" }
  | { type: "listStateMachines"; requestId: string }
  | { type: "listEditableFunctions"; requestId: string }
  // Render the current workflow model as `.dar.ts` text (code view).
  | { type: "workflowCode"; requestId: string; workflow: unknown }
  // Parse edited `.dar.ts` text back into the JSON model (code view apply).
  | { type: "workflowFromCode"; requestId: string; text: string }
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
      packId: StarterPackId;
    }
  | {
      /** Cancels an in-flight `deployStarterPackInfra` and deletes its stack. */
      type: "cancelStarterPackDeploy";
      requestId: string;
    }
  | { type: "listResources"; requestId: string; resource: string }
  | {
      type: "inferTypes";
      requestId: string;
      items: {
        nodeId: string;
        resultName: string;
        code: string;
        codeKind: "step" | "condition";
        scope: string[];
      }[];
      seedTypes?: Record<string, string>;
      inputType?: string;
    }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "testDestination"; settings: Record<string, string> }
  | { type: "listModels"; settings: Record<string, string> }
  | { type: "downloadModel"; localModel?: string }
  // Save the result table to a file (host shows a save dialog). The webview
  // builds the CSV/JSON text; the host just writes it.
  | {
      type: "exportData";
      format: "csv" | "json";
      content: string;
      filename: string;
    }
  // Save the rendered chart (SVG text, or a PNG data URL) to a file.
  | {
      type: "exportChart";
      format: "svg" | "png";
      content: string;
      filename?: string;
    }
  // Save a query to favorites (host prompts for a name and persists it).
  | { type: "saveFavorite"; query: string; destinationType: string }
  | { type: "deleteFavorite"; id: string }
  // NOTE: keep this `visualize` shape in sync with the InboundMessage union in
  // src/extension.ts (host and webview message types are, as existing debt,
  // declared separately in each project's own `src`).
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

/** A single check within a destination connectivity test. Mirrors the
 * DestinationCheck shape produced by the host's destinationTest.ts. */
export interface DestinationCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

/** Result of a "Test connection" run, produced by the host. */
export interface DestinationTestReport {
  ok: boolean;
  summary: string;
  checks: DestinationCheck[];
}

/** A single SQS message, normalized for display. */
export interface SqsMessageRow {
  messageId: string;
  receivedAt: string;
  body: string;
  attributes: Record<string, string>;
}

/** Messages from extension host → webview */
/** Resource-level progress while a starter pack's CFN stack is being created. */
export interface StarterPackCfnResourceProgress {
  completed: number;
  total: number;
  currentResource?: string;
}

/** Progress update for a starter pack infra deploy (see `starterPackInfraProgress`). */
export interface StarterPackInfraProgress {
  message: string;
  resources?: StarterPackCfnResourceProgress;
}

export type InboundMessage =
  | {
      type: "config";
      settings: Settings;
      modelDownloaded?: boolean;
      /**
       * Whether the GitHub Copilot LLM provider (VS Code language-model API) is
       * available in this host. Absent => true (VS Code). The standalone desktop
       * host sets this false so Copilot is hidden while other providers remain.
       */
      copilotAvailable?: boolean;
    }
  | { type: "status"; text: string }
  | {
      type: "results";
      columns: string[];
      rows: string[][];
      count: number;
      /**
       * True if the extension host capped this result at its row ceiling
       * (MAX_SQL_ROWS). More rows matched than are shown, so `count`/`rows`
       * are a bounded prefix — the UI says so and the model is told not to
       * treat it as the complete result.
       */
      truncated?: boolean;
      explanation?: string;
      finalQuery?: string;
      suggestedCharts?: string[];
      /**
       * The column (if any) result rows carry a stable per-execution
       * identifier under, added by the extension host's identifier
       * injection (see queryShape.ts). Omitted for aggregate query results
       * (GROUP BY, bare COUNT/SUM/etc.) — there is no single execution a
       * summary row corresponds to, so no row-detail drill-down is offered
       * for those results.
       */
      idColumn?: string;
      /**
       * For the S3+Athena destination: the actual result-column names (if
       * present) carrying the row's year/month/day partition values, added
       * alongside idColumn so the row-detail fetch can prune to a single
       * partition instead of scanning the whole table on every click. Each
       * field is undefined if that partition column isn't in this result
       * set (e.g. an aggregate query, or a non-S3 destination).
       */
      partitionColumns?: { year?: string; month?: string; day?: string };
      /**
       * Columns the extension host injected purely so the row-detail fetch
       * has something to key/prune on (idColumn itself, plus S3+Athena's
       * year/month/day partition columns) — not because the user's question
       * asked for them. The UI hides these from the rendered table (they'd
       * otherwise show up as extra columns the user never asked to see) while
       * still keeping their values available on each row for the fetch.
       * Never includes a column the query already had for its own reasons —
       * only ones the host had to add.
       */
      hiddenColumns?: string[];
    }
  | { type: "detailResult"; fields: Record<string, string> }
  | { type: "chartSpec"; spec: Record<string, unknown>; requestId: number }
  | { type: "chartSpecError"; message: string; requestId: number }
  | {
      /**
       * One completed iteration of the run→verify→refine loop, streamed so
       * the webview can show the assistant's progress.
       */
      type: "agentStep";
      iteration: number;
      query: string;
      rowCount?: number;
      outcome:
        | "satisfied"
        | "unsatisfied"
        | "error"
        | "analyzed"
        | "ran"
        | "script";
      detail?: string;
    }
  | {
      /**
       * The final natural-language answer for a turn (from the tool loop's
       * finish, or the verify/refine path's analyze step). Shown above the
       * results table.
       */
      type: "agentAnswer";
      text: string;
    }
  | { type: "error"; message: string }
  | { type: "sessionCleared" }
  | { type: "settingsSaved" }
  | { type: "destinationTestResult"; result: DestinationTestReport }
  | { type: "bedrockModels"; models?: string[]; error?: string }
  | { type: "downloadProgress"; percent: number; done: boolean }
  | { type: "sqsStatus"; listening: boolean }
  | { type: "sqsMessages"; messages: SqsMessageRow[] }
  | { type: "favorites"; favorites: Favorite[] }
  // Workflow Studio: a .dar file the host read from disk (content is JSON text),
  // and a request to switch the top-level view (e.g. from the Open Studio cmd).
  // `path` is the real file's absolute path when one exists (a locally-opened
  // file) — omitted when loaded from a deployed function's embedded content
  // (no local file backs it, so the code-view gutter can't set breakpoints
  // until the user explicitly saves — see the "toggleBreakpoint" message).
  | { type: "workflowLoaded"; name: string; content: string; path?: string }
  // Confirms the host wrote the workflow file (updates the diff baseline).
  // `path` is the real saved file's absolute path — always present, since
  // this message only fires after a successful save.
  | { type: "workflowSaved"; path: string }
  // The real, current set of VS Code breakpoints for a `.dar.ts` file (1-based
  // line numbers) — sent in response to "getBreakpoints", after every
  // "toggleBreakpoint", AND whenever `vscode.debug.onDidChangeBreakpoints`
  // fires for a breakpoint the host maps back to this path (so a breakpoint
  // added/removed via a normal editor tab, or by VS Code itself — e.g. an
  // active debug session removing a breakpoint after it's hit and continued
  // past — also updates the webview's gutter, not just the reverse).
  | {
      type: "breakpointsChanged";
      path: string;
      lines: number[];
      /** The node ids whose `.dar.ts` DECLARATION line is currently in the
       *  breakpoint set — the host computes this by reverse-looking-up each
       *  breakpoint line against the cdk's locateDarTsNodeLines(path). Lets the
       *  canvas render a filled breakpoint dot on exactly those nodes, kept in
       *  sync with the code view's gutter (both are the same store). Absent =
       *  none (or a host that predates node breakpoints). */
      nodeIds?: string[];
      /** False when the host can't register real debugger breakpoints at all
       *  (the standalone desktop app — no `vscode.debug` in Electron). Lets
       *  the code view show an honest hint instead of inviting clicks that
       *  can never work. Absent/true from the VS Code extension. */
      supported?: boolean;
    }
  // In-Studio debugger (see the "In-Studio debugger protocol" section above).
  // One event of the active debug run, streamed as the host's debugRunner
  // emits them.
  | { type: "debugEvent"; event: DebugEvent }
  // Reply to "debugGetProperties": the object's own properties, or `error`
  // when the fetch failed (session gone, stale objectId after a resume, ...).
  | {
      type: "debugProperties";
      requestId: string;
      properties: DebugProperty[];
      error?: string;
    }
  | {
      type: "sdkActions";
      clientPackage: string;
      clientClass?: string;
      actions?: SdkAction[];
      error?: string;
    }
  | {
      type: "sdkActionShape";
      clientPackage: string;
      command: string;
      fields?: SdkField[];
      skeleton?: Record<string, unknown>;
      error?: string;
    }
  | {
      type: "apiVendors";
      vendors?: ApiVendor[];
      /** The wider community-indexed directory (vendor-hosted spec URLs). */
      directory?: ApiDirectoryEntry[];
      /** Date the directory INDEX was last regenerated (YYYY-MM-DD). */
      directoryGeneratedAt?: string;
      error?: string;
    }
  | {
      type: "apiOperations";
      specId: string;
      title?: string;
      version?: string;
      baseUrl?: string;
      operations?: ApiOperation[];
      error?: string;
    }
  | {
      type: "apiOperationShape";
      specId: string;
      key: string;
      method?: string;
      url?: string;
      operationId?: string;
      summary?: string;
      params?: ApiParam[];
      bodySkeleton?: Record<string, unknown> | null;
      error?: string;
    }
  | { type: "navigate"; view: "explorer" | "studio" }
  // Live content of a code block the user is editing in a VS Code tab.
  | ({ type: "deployStatus" } & DeployStatus)
  // Mid-deploy: the IAM permissions inferred from the workflow's code, for the
  // user to review and approve. The deploy BLOCKS on the matching
  // "deployPermissionsResponse" — previously this was a native OS dialog with
  // the statements crammed into its body text, which made a long list
  // unreadable and put the decision outside the deploy modal the user was
  // already looking at.
  | {
      type: "deployPermissionsRequest";
      requestId: string;
      /** Role the inline policy would be attached to, e.g. `my-fn-role`. */
      roleName: string;
      statements: DeployPermissionStatement[];
      /** Things the analyzer couldn't map confidently — never silent. */
      warnings: string[];
    }
  | {
      type: "functionsList";
      functions: FunctionSummary[];
      loading?: boolean;
      error?: string;
    }
  | { type: "functionInfo"; info: FunctionInfo | null; error?: string }
  | {
      type: "executionsList";
      functionName: string;
      executions: ExecutionRow[];
      nextMarker?: string;
      error?: string;
    }
  | {
      type: "executionStarted";
      functionName: string;
      durableExecutionArn?: string;
      statusCode?: number;
      error?: string;
    }
  | { type: "executionDetail"; detail: ExecutionDetail | null; error?: string }
  | { type: "executionWorkflow"; arn: string; dar?: string; error?: string }
  | {
      type: "workflowCodeResult";
      requestId: string;
      text?: string;
      error?: string;
    }
  | {
      type: "workflowFromCodeResult";
      requestId: string;
      dar?: string;
      error?: string;
    }
  | {
      type: "agentNodeCode";
      requestId: string;
      code?: string;
      error?: string;
    }
  | {
      type: "agentWorkflow";
      requestId: string;
      dar?: string;
      error?: string;
      /** ASL-import only: best-effort conversion notes + faithfulness flag. */
      notes?: string[];
      faithful?: boolean;
    }
  | {
      type: "importProgress";
      requestId: string;
      phase: "skeleton" | "code" | "validate" | "judge" | "done";
      detail: string;
    }
  | {
      type: "starterPackInfraProgress";
      requestId: string;
      message: string;
      /** Resource-level progress while the CFN stack is being created. */
      resources?: StarterPackCfnResourceProgress;
    }
  | {
      type: "starterPackInfraResult";
      requestId: string;
      dar?: string;
      error?: string;
      /** True when `error` is the result of a user-initiated cancel, not a real failure. */
      cancelled?: boolean;
    }
  | {
      type: "resourceList";
      requestId: string;
      items: { label: string; value: string }[];
      error?: string;
    }
  | {
      type: "inferTypesResult";
      requestId: string;
      types: Record<string, string>;
      error?: string;
    };

/**
 * One completed iteration of the advanced (agentic) run→verify→refine loop,
 * accumulated by the webview to render a progress transcript.
 */
export interface AgentStep {
  iteration: number;
  query: string;
  rowCount?: number;
  outcome:
    | "satisfied"
    | "unsatisfied"
    | "error"
    | "analyzed"
    | "ran"
    | "script";
  detail?: string;
}

/** Date/time display formats offered by DateView; the favorite is the default. */
export type DateFormat = "relative" | "local" | "utc" | "iso" | "unix";

/** Short vs. long rendering for formats that support it (relative/local). */
export type DateVariant = "short" | "long";

export interface Settings {
  region: string;
  destinationType: string;
  logGroupName: string;
  dynamodbTableName: string;
  auroraResourceArn: string;
  auroraSecretArn: string;
  auroraDatabase: string;
  auroraTable: string;
  redshiftWorkgroupName: string;
  redshiftClusterIdentifier: string;
  redshiftDbUser: string;
  redshiftSecretArn: string;
  redshiftDatabase: string;
  redshiftTable: string;
  redshiftSchema: string;
  opensearchEndpoint: string;
  opensearchIndex: string;
  sqsQueueUrl: string;
  sqsDeleteAfterRead: boolean;
  athenaDatabase: string;
  athenaTable: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
  athenaS3Location: string;
  llmProvider: string;
  awsProfile: string;
  bedrockModelId: string;
  localModel: string;
  localServerUrl: string;
  localServerModel: string;
  agenticMaxIterations: string;
  queryMode: string;
  aiDisclosureAcceptedVersion: string;
  /** Preferred date/time display format for DateView. */
  dateFormat: DateFormat;
  /** Short vs. long rendering for formats that support it. */
  dateVariant: DateVariant;
  /**
   * Reveals the Workflow Studio view. Off by default, and intentionally not
   * offered in the Settings modal — see `InsightConfig.showWorkflowStudio` for
   * how to enable it per host. Arrives as a real boolean from the extension host
   * and as the string "true" from the desktop app's flat JSON store, so read it
   * through `isStudioEnabled` rather than testing it directly.
   */
  showWorkflowStudio?: boolean | string;
  /**
   * Permit `dag` dependency mode. Off by default and not offered in Settings:
   * generated dag code calls a runtime the SDK does not implement yet. Same dual
   * encoding as `showWorkflowStudio` — boolean from the extension host, the
   * string "true" from the desktop app's flat JSON store.
   */
  enableDagMode?: boolean | string;
}

/**
 * Version of the AI-usage disclosure. Bump this whenever the notice wording
 * changes so previously-consented users are re-prompted.
 * LEGAL: wording is pending review by the Legal team (see tracked ticket).
 *
 * Currently "2": "1" was the initial gate (features + generic data notice);
 * "2" added the per-provider data-flow breakdown, so early adopters on "1"
 * re-accept the fuller disclosure.
 */
export const AI_DISCLOSURE_VERSION = "2";

/**
 * Curated Bedrock models shown as suggestions by default (before/without
 * fetching the full account list). Hand-picked from an internal benchmark of
 * the agent-mode query task ("group by … in execution input") run against real
 * data on BOTH the Aurora (PostgreSQL) and S3/Athena (Trino) destinations:
 * these reliably discovered the right JSON keys and produced correct,
 * multi-dimension grouped SQL in both dialects. (Some models that did well only
 * on Aurora — e.g. Mistral Pixtral Large — were excluded because they were weak
 * on Athena.) The full account list is still available via the "List available
 * models" button. `us.` (US cross-region) inference profiles are used;
 * `global.`/`eu.` equivalents work too if you prefer.
 */
export const RECOMMENDED_BEDROCK_MODELS: {
  value: string;
  description: string;
}[] = [
  {
    value: "us.anthropic.claude-sonnet-5",
    description: "Recommended default — top accuracy on query tasks",
  },
  {
    value: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    description: "Excellent; a lower-cost alternative to Sonnet 5",
  },
  {
    value: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    description: "Fast and accurate — strong low-cost pick",
  },
  {
    value: "us.anthropic.claude-opus-4-5-20251101-v1:0",
    description: "Highest capability (slower/pricier)",
  },
  {
    value: "us.amazon.nova-pro-v1:0",
    description: "Strong non-Claude option (correct on Aurora + Athena)",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  region: "us-east-1",
  destinationType: "cloudwatch-logs-exporter",
  logGroupName: "",
  dynamodbTableName: "",
  auroraResourceArn: "",
  auroraSecretArn: "",
  auroraDatabase: "postgres",
  auroraTable: "workflow_insight",
  redshiftWorkgroupName: "",
  redshiftClusterIdentifier: "",
  redshiftDbUser: "",
  redshiftSecretArn: "",
  redshiftDatabase: "dev",
  redshiftTable: "workflow_insight",
  redshiftSchema: "public",
  opensearchEndpoint: "",
  opensearchIndex: "workflow-insight",
  sqsQueueUrl: "",
  sqsDeleteAfterRead: false,
  athenaDatabase: "",
  athenaTable: "workflow_insight",
  athenaWorkgroup: "",
  athenaOutputLocation: "",
  athenaS3Location: "",
  llmProvider: "bedrock",
  awsProfile: "",
  bedrockModelId: "us.anthropic.claude-sonnet-5",
  localModel: "llama-3-groq-8b-tool-use",
  localServerUrl: "http://localhost:11434/v1",
  localServerModel: "llama3.1",
  agenticMaxIterations: "8",
  queryMode: "agent",
  aiDisclosureAcceptedVersion: "",
  dateFormat: "local",
  dateVariant: "long",
};
