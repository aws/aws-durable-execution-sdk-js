import Header from "@cloudscape-design/components/header";
import { useState, useEffect, useRef } from "react";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Input from "@cloudscape-design/components/input";
import FormField from "@cloudscape-design/components/form-field";
import Box from "@cloudscape-design/components/box";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import Textarea from "@cloudscape-design/components/textarea";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import Modal from "@cloudscape-design/components/modal";
import Table from "@cloudscape-design/components/table";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { DarWorkflow } from "./studioTypes";
import type {
  DeployStatus,
  DeployPermissionsRequest,
  StarterPackId,
  StarterPackInfraProgress,
  DebugProperty,
} from "./types";
import { parseWorkflow, scopeExtras } from "./studioTypes";
import { Canvas } from "./studio/Canvas";
import { CodeArea } from "./studio/CodeField";
import { NodePalette } from "./studio/NodePalette";
import { ImportStepFunctionsModal } from "./studio/ImportStepFunctionsModal";
import { StarterPackModal } from "./studio/StarterPackModal";
import { StarterPackPickerModal } from "./studio/StarterPackPickerModal";
import { AwsSdkBrowserModal } from "./studio/AwsSdkBrowserModal";
import { ApiBrowserModal } from "./studio/ApiBrowserModal";
import { ConfigPanel } from "./studio/ConfigPanel";
import { NodeInspector } from "./studio/NodeInspector";
import { StudioBreadcrumb } from "./studio/StudioBreadcrumb";
import {
  ValidationModal,
  ValidationSummary,
} from "./studio/ValidationPanel";
import { useWorkflowStudio } from "./studio/useWorkflowStudio";
import { WorkflowCodeView } from "./studio/WorkflowCodeView";
import { WorkflowDiffView } from "./studio/WorkflowDiffView";
import {
  DebugPanel,
  type DebugCommandName,
  type DebugSessionState,
} from "./studio/DebugPanel";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import { ExecutionGraph } from "./ExecutionGraph";
import { postMessage } from "./vscode";

/**
 * aria-label given to the deploy modal's dismiss "X" while the modal is locked.
 * Cloudscape always renders that button and offers no prop to hide it, so this
 * label doubles as the CSS hook (see {@link DEPLOY_LOCK_STYLE}) — it is our own
 * string rather than a generated Cloudscape class, so it's a stable selector.
 */
const DEPLOY_LOCK_LABEL = "Deploy in progress — cannot close";
const DEPLOY_LOCK_STYLE = `[aria-label="${DEPLOY_LOCK_LABEL}"] { display: none !important; }`;

interface StudioPageProps {
  /** A workflow loaded from a `.dar.ts` file by the host (null until one opens). */
  loaded: DarWorkflow | null;
  /** Bumped by the host each time a new workflow is loaded, to trigger replace. */
  loadNonce: number;
  /** Bumped by the host after each successful file save (diff baseline). */
  savedNonce?: number;
  /** The real on-disk path of the loaded/saved workflow, or null when none
   *  exists yet (e.g. loaded from a deployed function's embedded content,
   *  never saved locally) — see WorkflowCodeView's breakpoint gutter, which
   *  needs a real file to target a vscode.SourceBreakpoint against. */
  workflowFilePath?: string | null;
  /** Current real breakpoint lines (1-based) for `workflowFilePath`, mirrored
   *  from the host's actual vscode.debug breakpoint list — see
   *  "breakpointsChanged" in types.ts. */
  breakpointLines?: number[];
  /** False when the host can't register real debugger breakpoints at all
   *  (the standalone desktop app — see `supported` in types.ts). */
  breakpointsSupported?: boolean;
  /** The user clicked a gutter line in the code view; forwards to the host
   *  as a "toggleBreakpoint" message (no-op host-side if `workflowFilePath`
   *  is null — nothing real to target yet). */
  onToggleBreakpoint?: (line: number) => void;
  /** The node ids with an active breakpoint on their `.dar.ts` decl line
   *  (mirrored from the host — see "breakpointsChanged".nodeIds). Drives the
   *  canvas's filled breakpoint dots. */
  breakpointNodeIds?: string[];
  /** The user clicked a node's breakpoint dot on the canvas; forwards to the
   *  host as a "toggleNodeBreakpoint" message (no-op host-side without a real
   *  backing file, like onToggleBreakpoint). */
  onToggleNodeBreakpoint?: (nodeId: string) => void;
  onSave: (wf: DarWorkflow) => void;
  onOpen: () => void;
  /** Ask the host to pick a deployed durable function to edit (replaces the canvas). */
  onEditFunction: () => void;
  /** Generate a node's code from a description via the configured LLM provider. */
  onGenerateNodeCode: (req: {
    kind: string;
    field: string;
    name: string;
    description: string;
    scope: string[];
    inputType?: string;
    currentCode?: string;
  }) => Promise<string>;
  /** Generate a whole workflow from a description; loads it onto the canvas. */
  onGenerateWorkflow: (description: string) => Promise<void>;
  /** Serialize the model to `.dar.ts` text (host-side) for the code view. */
  onRenderWorkflowCode?: (workflow: unknown) => Promise<string>;
  /** Whether `dag` dependency mode is enabled (hides packs that need it). */
  dagEnabled?: boolean;
  /** Parse edited `.dar.ts` text back to model JSON (host-side). */
  onParseWorkflowCode?: (text: string) => Promise<string>;
  /** List the account's Step Functions state machines for the import picker. */
  onListStateMachines?: () => Promise<{ label: string; value: string }[]>;
  /** Import a state machine by ARN → convert to .dar → load onto the canvas. */
  onImportStateMachine?: (arn: string, inlineLambdas: boolean) => Promise<void>;
  /** Best-effort notes from the last Step Functions import. */
  importNotes?: string[] | null;
  /** Whether the last import was judged a faithful conversion. */
  importFaithful?: boolean | null;
  /** Current progress phase text during an import. */
  importPhase?: string;
  /** Deploy a Step Functions starter pack's CFN infra → resolve the pack's `.dar`. */
  onDeployStarterPackInfra?: (packId: StarterPackId) => Promise<string>;
  /** Current progress message text during a starter pack infra deploy. */
  starterPackInfraProgress?: StarterPackInfraProgress | null;
  /** Cancels the in-flight starter pack deploy (deletes its CFN stack). */
  onCancelStarterPackDeploy?: () => void;
  /** Parse a `.dar` string and load it onto the canvas (e.g. from a starter pack). */
  onLoadDar?: (dar: string) => void;
  /** List account resources of a kind for a job resource picker. */
  onListResources?: (resource: string) => Promise<{
    items: { label: string; value: string }[];
    error?: string;
  }>;
  onInferTypes?: (
    items: {
      nodeId: string;
      resultName: string;
      code: string;
      codeKind: "step" | "condition";
      scope: string[];
    }[],
    seedTypes?: Record<string, string>,
    inputType?: string,
  ) => Promise<Record<string, string>>;
  /** Deploy the workflow as a durable Lambda (host runs the pipeline). */
  onDeploy: (functionName: string, workflow: DarWorkflow) => void;
  /** Remote-debug the deployed function: invoke it with the debugger attached.
   *  Optional because only the VS Code host can drive a real debug session
   *  (the desktop app answers with a "requires VS Code" notice instead). */
  /**
   * Run the deployed Lambda: plain durable execution, or debug:true for a
   * remote debug session (VS Code extension only — see the host's
   * onRunWorkflow; the prop is absent in the desktop app for debug parity
   * reasons even though plain execute would work there).
   */
  onRun?: (
    functionName: string,
    payload: string,
    executionName: string | undefined,
    debug: boolean,
  ) => void;
  /** Latest deploy progress/result/error streamed from the host. */
  deployStatus: DeployStatus | null;
  /** Accumulated deploy progress lines for the current/last deploy. */
  deployLog: string[];
  /** A mid-deploy IAM review the host is blocked on, reviewed in the deploy
   *  modal itself. Null when nothing is pending. */
  deployPermissions?: DeployPermissionsRequest | null;
  /** Answers the review; `approved: false` deploys without the inline policy. */
  onRespondDeployPermissions?: (requestId: string, approved: boolean) => void;
  /** Stops the in-flight deploy at its next step boundary. */
  onCancelDeploy?: () => void;
  /** Switch to the Durable Functions view focused on a function. */
  onViewFunction: (functionName: string) => void;
  /** The in-Studio debug session (accumulated from "debugEvent" messages —
   *  see DebugPanel.tsx for the state shape). The panel renders while
   *  `active`; a 'paused' event also forces the code view so the user SEES
   *  where execution stopped. */
  debugSession?: DebugSessionState;
  /** Post a stepping/continue/stop command for the active session. */
  onDebugCommand?: (command: DebugCommandName) => void;
  /** Lazily fetch an object's own properties for the variables tree. */
  onDebugGetProperties?: (objectId: string) => Promise<DebugProperty[]>;
  /** Hide the panel after a finished run. */
  onDebugDismiss?: () => void;
  /** The 1-based `.dar.ts` line the session is paused at (null/absent when
   *  not paused) — threaded into WorkflowCodeView's highlight. */
  pausedLine?: number | null;
  /** The node the session is paused ON (its decl line == the paused line), or
   *  null/absent when not paused — threaded into the Canvas's paused glow. */
  pausedNodeId?: string | null;
}

/**
 * The Workflow Studio page: a thin composition of the palette, canvas and
 * inspector. All state and behavior live in {@link useWorkflowStudio}.
 */
export function StudioPage({
  loaded,
  loadNonce,
  savedNonce,
  workflowFilePath,
  breakpointLines,
  breakpointsSupported,
  onToggleBreakpoint,
  breakpointNodeIds,
  onToggleNodeBreakpoint,
  onSave,
  onOpen,
  onEditFunction,
  onGenerateNodeCode,
  onGenerateWorkflow,
  onRenderWorkflowCode,
  dagEnabled = false,
  onParseWorkflowCode,
  onListStateMachines,
  onImportStateMachine,
  importNotes,
  importFaithful,
  importPhase,
  onDeployStarterPackInfra,
  starterPackInfraProgress,
  onCancelStarterPackDeploy,
  onLoadDar,
  onListResources,
  onInferTypes,
  onDeploy,
  onRun,
  deployStatus,
  deployLog,
  deployPermissions,
  onRespondDeployPermissions,
  onCancelDeploy,
  onViewFunction,
  debugSession,
  onDebugCommand,
  onDebugGetProperties,
  onDebugDismiss,
  pausedLine,
  pausedNodeId,
}: StudioPageProps) {
  const {
    wf,
    rootWf,
    selected,
    selectedId,
    connectingFrom,
    confirmAction,
    validationOpen,
    zoom,
    canvasHeight,
    canvasRef,
    viewAreaRef,
    recomputeViewHeight,
    dropEdgeId,
    byId,
    issues,
    hasErrors,
    errorNodeIds,
    setSelectedId,
    setConnectingFrom,
    setValidationOpen,
    setConfirmAction,
    renameWorkflow,
    replaceRoot,
    getBaseline,
    markCommitted,
    setInputType,
    setWorkflowComment,
    addNode,
    addAwsSdkCall,
    addHttpCall,
    updateNode,
    applyCodeUpdate,
    addParallelBranch,
    deleteParallelBranch,
    deleteNode,
    setTerminal,
    deleteEdge,
    addBranch,
    addErrorRoute,
    setBranch,
    endBranch,
    startDrag,
    onNodeClick,
    onCanvasDrop,
    onEdgeDrop,
    zoomIn,
    zoomOut,
    autoFit,
    handleAutoLayout,
    layoutLocked,
    toggleLayoutLock,
    layoutDirection,
    setLayoutDirection,
    undo,
    redo,
    canUndo,
    canRedo,
    requestClear,
    requestOpen,
    requestEditFunction,
    confirmProceed,
    path,
    enterContainer,
    exitTo,
  } = useWorkflowStudio({ loaded, loadNonce, onOpen, onEditFunction });

  // Workflow Studio fills the viewport: the canvas is sized to the bottom
  // edge and the side panels (Properties/Debug) scroll their own bodies, so
  // the window itself must NOT scroll. Lock document overflow while this page
  // is mounted; the cleanup restores it when navigating to another view (which
  // unmounts StudioPage), where normal page scrolling is still wanted.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  // Agent (whole-workflow generation) modal.
  const [agentOpen, setAgentOpen] = useState(false);
  // The active scope's dependency mode drives every DAG UI affordance (P3).
  const dagMode = wf.dependencyMode === "dag";
  const [importOpen, setImportOpen] = useState(false);
  const [starterPackPickerOpen, setStarterPackPickerOpen] = useState(false);
  const [starterPackOpen, setStarterPackOpen] = useState(false);
  const [starterPackId, setStarterPackId] = useState<StarterPackId>("hl");
  const [sdkOpen, setSdkOpen] = useState(false);
  const [sdkInitial, setSdkInitial] = useState<string | null>(null);
  const [apiOpen, setApiOpen] = useState(false);
  const [apiInitial, setApiInitial] = useState<string | null>(null);
  const [agentDesc, setAgentDesc] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState("");
  const runAgentWorkflow = async () => {
    if (!agentDesc.trim()) return;
    setAgentBusy(true);
    setAgentError("");
    try {
      await onGenerateWorkflow(agentDesc.trim());
      setAgentOpen(false);
      setAgentDesc("");
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentBusy(false);
    }
  };

  // Deploy confirm modal (root-only); function name defaults from the workflow.
  const [deployOpen, setDeployOpen] = useState(false);
  // Whether a deploy was started from THIS modal session. `deployStatus` is
  // owned by App and persists after the modal closes, so the footer must not
  // read it directly: after one successful deploy, reopening the modal to
  // deploy under a different function name showed only "View deployed
  // function" and no way to deploy again.
  const [deployRequested, setDeployRequested] = useState(false);
  const [deployFnName, setDeployFnName] = useState("");
  // Run modal — shared by Execute and Debug (one flow, a debug flag; see
  // onRun). Payload/name reset every open; the flag comes from which
  // dropdown item opened it (still toggleable inside the modal).
  const [runOpen, setRunOpen] = useState(false);
  const [runDebug, setRunDebug] = useState(false);
  const [runPayload, setRunPayload] = useState("{}");
  const [runExecName, setRunExecName] = useState("");
  const deployBusy = deployStatus?.status === "progress";
  // The modal must stay put while a deploy is in flight (nothing outside it
  // reports progress) or while the host is blocked on a permissions review.
  const deployLocked = deployBusy || !!deployPermissions;
  // Set between clicking "Cancel deploy" and the deploy actually stopping —
  // cancellation is cooperative, so the host may still be mid-step and there is
  // a visible gap before the terminal status arrives.
  const [deployCancelling, setDeployCancelling] = useState(false);
  useEffect(() => {
    if (!deployBusy) setDeployCancelling(false);
  }, [deployBusy]);
  // The host BLOCKS its deploy on a permissions answer, so the review must be
  // visible even if the user closed the deploy modal after hitting Deploy —
  // otherwise the deploy hangs with nothing on screen explaining why.
  useEffect(() => {
    if (deployPermissions) setDeployOpen(true);
  }, [deployPermissions]);

  // Breadcrumb labels: root workflow name, then each map body along the path.
  const crumbLabels: string[] = [rootWf.name || "Workflow"];
  {
    let cur = rootWf;
    for (const seg of path) {
      let next: typeof cur | undefined;
      for (const n of cur.nodes) {
        if (
          (n.kind === "map" ||
            n.kind === "group" ||
            n.kind === "dagContainer") &&
          n.id === seg
        ) {
          crumbLabels.push(n.name || "child");
          next = n.body;
          break;
        }
        if (n.kind === "parallel") {
          const b = n.branches.find((br) => br.id === seg);
          if (b) {
            crumbLabels.push(`${n.name || "parallel"} / ${b.name || "branch"}`);
            next = b.body;
            break;
          }
        }
      }
      if (!next) break;
      cur = next;
    }
  }

  // --- Code view (whole workflow as a .dar.ts document) ---
  const [viewMode, setViewMode] = useState<
    "visual" | "code" | "diff" | "config"
  >(
    "visual",
  );
  // The canvas unmounts while viewMode is "code"/"diff" (see the render
  // ternary below), so the DOM node created when we return to "visual" starts
  // scrolled to (0, 0) again — without this, the graph sits outside the
  // initial viewport (the world div is offset by WORLD_ORIGIN) until the user
  // manually clicks "Fit to view". Only reacts to viewMode itself (not
  // autoFit's identity, which changes on every node edit) so it re-centers
  // exactly once per code/diff -> visual transition, not on every edit.
  useEffect(() => {
    // The anchor's top edge moves between views (different toolbars above it),
    // so re-measure before fitting rather than reusing a stale height.
    recomputeViewHeight();
    if (viewMode === "visual") autoFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  const [diffTexts, setDiffTexts] = useState<{
    original: string;
    modified: string;
  } | null>(null);
  const [codeText, setCodeText] = useState("");
  const [codeOriginal, setCodeOriginal] = useState("");
  // Text-based dirty: undoing back to the serialized original is clean again.
  const codeDirty = codeText !== codeOriginal;
  const [codeError, setCodeError] = useState("");
  const [codeNonce, setCodeNonce] = useState(0);
  const enterCodeView = async () => {
    if (!onRenderWorkflowCode) return;
    setCodeError("");
    try {
      const text = await onRenderWorkflowCode(rootWf);
      setCodeText(text);
      setCodeOriginal(text);
      setCodeNonce((n) => n + 1);
      setViewMode("code");
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : String(e));
    }
  };
  // A pause is shown in BOTH views now, so it must not yank the user out of
  // whichever one they are in: the code view highlights the paused `.dar.ts`
  // line in its gutter, and the visual canvas marches a dotted border around
  // the node that owns that line (the host resolves it via the cdk's
  // `darTsNodeIdForLine`, which covers a node's operation entry AND any line of
  // its code body). This deliberately replaces an earlier effect that switched
  // to the code view on every pause — stepping through a workflow while reading
  // the graph was impossible, because each step landing threw the user back to
  // the text.
  /** The exact workflow snapshot sent to save/deploy — committed as the diff
   *  baseline only when the async ack arrives (edits in between stay dirty). */
  const pendingCommitRef = useRef<DarWorkflow | null>(null);
  /** Save, applying unapplied code-view edits first (parse errors block). */
  const saveNow = async () => {
    let wf: DarWorkflow | null = rootWf;
    if (viewMode === "code" && codeDirty) wf = await applyCodeView(false);
    if (!wf) return;
    pendingCommitRef.current = wf;
    onSave(wf);
  };

  // Export the whole workflow (including every map/parallel child body) as a
  // static diagram — reuses the same renderer as the Execution Detail graph,
  // just with no operation statuses, fully expanded, and off-screen.
  const exportSvgRef = useRef<SVGSVGElement | null>(null);
  const filenameBase = () =>
    (rootWf.name || "workflow").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "workflow";
  const exportGraph = (format: "svg" | "png") => {
    const svg = exportSvgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    if (format === "svg") {
      const content = xml.startsWith("<?xml")
        ? xml
        : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
      postMessage({
        type: "exportChart",
        format: "svg",
        content,
        filename: `${filenameBase()}.svg`,
      });
      return;
    }
    // PNG: rasterize the SVG via an offscreen <img>/<canvas> (no server round
    // trip — the browser's own SVG renderer draws it).
    const width = Number(svg.getAttribute("width")) || svg.clientWidth || 800;
    const height = Number(svg.getAttribute("height")) || svg.clientHeight || 600;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // 2x scale for a crisp export on high-DPI displays.
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, width, height);
      postMessage({
        type: "exportChart",
        format: "png",
        content: canvas.toDataURL("image/png"),
        filename: `${filenameBase()}.png`,
      });
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  /** Open the deploy dialog, applying unapplied code-view edits first. */
  const openDeploy = async () => {
    if (viewMode === "code" && codeDirty) {
      const wf = await applyCodeView(false);
      if (!wf) return;
    }
    setDeployFnName(
      // A previously deployed workflow keeps its function name in the file's
      // meta.deploy record — reuse it so redeploys/debug target the same
      // Lambda across VS Code restarts. Fall back to a name derived from the
      // workflow's display name for first-time deploys.
      rootWf.deploy?.functionName ||
        (rootWf.name || "workflow")
          .replace(/[^\w.-]+/g, "-")
          .replace(/^-+|-+$/g, "") ||
        "workflow",
    );
    // A stale "done" from an earlier deploy must not be presented as this
    // session's outcome — but a deploy still RUNNING (the user closed the modal
    // and reopened it) should keep streaming into the modal.
    setDeployRequested(deployStatus?.status === "progress");
    setDeployOpen(true);
  };
  const enterDiffView = async (current?: DarWorkflow) => {
    if (!onRenderWorkflowCode) return;
    setCodeError("");
    try {
      const [original, modified] = await Promise.all([
        onRenderWorkflowCode(getBaseline()),
        onRenderWorkflowCode(current ?? rootWf),
      ]);
      setDiffTexts({ original, modified });
      setViewMode("diff");
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : String(e));
    }
  };
  // A successful save or deploy commits the current graph as the diff base.
  useEffect(() => {
    if (savedNonce) markCommitted(pendingCommitRef.current ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedNonce]);
  useEffect(() => {
    if (deployStatus?.status === "done")
      markCommitted(pendingCommitRef.current ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployStatus?.status]);
  const applyCodeView = async (
    thenVisual: boolean,
  ): Promise<DarWorkflow | null> => {
    if (!onParseWorkflowCode) return null;
    setCodeError("");
    if (!codeDirty) {
      if (thenVisual) setViewMode("visual");
      return rootWf;
    }
    try {
      const dar = await onParseWorkflowCode(codeText);
      const wf = parseWorkflow(JSON.parse(dar));
      replaceRoot(wf);
      setCodeOriginal(codeText);
      if (thenVisual) setViewMode("visual");
      return wf;
    } catch (e) {
      // Parse errors keep you in the code view with the message shown.
      setCodeError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  return (
    <SpaceBetween size="m">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* The workflow name lives in the Config view now — a field that is set
            once should not cost vertical space on every other view. Shown here
            as a compact heading so you can still see WHICH workflow is open. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Box
            variant="h3"
            padding="n"
            fontSize="heading-s"
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
              }}
              title={wf.comment ? `${wf.name} — ${wf.comment}` : wf.name}
            >
              {wf.name || "Untitled workflow"}
            </span>
          </Box>
        </div>
        <SpaceBetween direction="horizontal" size="xs">
          {path.length === 0 && onRenderWorkflowCode && (
            <SegmentedControl
              selectedId={viewMode}
              options={[
                { id: "visual", text: "Visual" },
                { id: "code", text: "Code" },
                { id: "diff", text: "Diff" },
                { id: "config", text: "Config" },
              ]}
              onChange={({ detail }) => {
                if (detail.selectedId === "code") {
                  void enterCodeView();
                } else if (detail.selectedId === "diff") {
                  if (viewMode === "code") {
                    // Apply edits first so the diff shows what you typed;
                    // a parse error keeps you in the code view.
                    void applyCodeView(false).then(
                      (wf) => wf && enterDiffView(wf),
                    );
                  } else {
                    void enterDiffView();
                  }
                } else if (detail.selectedId === "config") {
                  // Leaving the code view must not silently drop typed edits.
                  if (viewMode === "code" && codeDirty) {
                    void applyCodeView(false).then((w) => {
                      if (w) setViewMode("config");
                    });
                  } else {
                    setViewMode("config");
                  }
                } else if (viewMode === "code") {
                  void applyCodeView(true);
                } else {
                  setViewMode("visual");
                }
              }}
            />
          )}
          {path.length === 0 && (
            <Button
              iconName="gen-ai"
              onClick={() => {
                setAgentDesc("");
                setAgentError("");
                setAgentOpen(true);
              }}
            >
              Agent
            </Button>
          )}
          <ButtonDropdown
            items={[
              { id: "file", text: "Open File", iconName: "folder-open" },
              {
                id: "function",
                text: "Edit durable Function",
                iconName: "share",
              },
              ...(onImportStateMachine && onListStateMachines
                ? [
                    {
                      id: "import-sfn",
                      text: "Import Step Functions",
                      iconName: "share" as const,
                    },
                  ]
                : []),
              ...(onDeployStarterPackInfra
                ? [
                    {
                      id: "starter-pack",
                      text: "Deploy Starter Pack…",
                      iconName: "gen-ai" as const,
                    },
                  ]
                : []),
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === "file") requestOpen();
              else if (detail.id === "function") requestEditFunction();
              else if (detail.id === "import-sfn") setImportOpen(true);
              else if (detail.id === "starter-pack")
                setStarterPackPickerOpen(true);
            }}
          >
            Open…
          </ButtonDropdown>
          <ButtonDropdown
            disabled={rootWf.nodes.length === 0}
            items={[
              { id: "svg", text: "Export as SVG" },
              { id: "png", text: "Export as PNG" },
            ]}
            onItemClick={({ detail }) => exportGraph(detail.id as "svg" | "png")}
          >
            Export…
          </ButtonDropdown>
          <ButtonDropdown
            variant="primary"
            mainAction={{
              text: "Save",
              onClick: () => void saveNow(),
              disabled: rootWf.nodes.length === 0,
            }}
            items={[
              {
                id: "deploy",
                text: "Deploy…",
                iconName: "upload",
                disabled:
                  rootWf.nodes.length === 0 || deployBusy || path.length !== 0,
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === "deploy") void openDeploy();
            }}
          />
          {/* Execute/Debug are EXECUTION actions against the already-deployed
              function — one shared modal + host flow with a debug flag (see
              onRun's doc comment). VS Code extension only; the prop is
              absent in the desktop app. */}
          {onRun && (
            <ButtonDropdown
              items={[
                {
                  id: "execute",
                  text: "Execute…",
                  iconName: "play" as const,
                  disabled:
                    rootWf.nodes.length === 0 ||
                    deployBusy ||
                    path.length !== 0,
                },
                {
                  id: "debug",
                  text: "Debug…",
                  iconName: "bug" as const,
                  disabled:
                    rootWf.nodes.length === 0 ||
                    deployBusy ||
                    path.length !== 0,
                },
              ]}
              onItemClick={({ detail }) => {
                if (detail.id !== "execute" && detail.id !== "debug") return;
                setRunDebug(detail.id === "debug");
                setRunPayload("{}");
                setRunExecName("");
                setRunOpen(true);
              }}
            >
              Run
            </ButtonDropdown>
          )}
          <Button
            iconName="remove"
            disabled={rootWf.nodes.length === 0}
            onClick={requestClear}
          >
            Clear
          </Button>
        </SpaceBetween>
      </div>

      {path.length > 0 && (
        <StudioBreadcrumb labels={crumbLabels} onExitTo={exitTo} />
      )}

      {/* Stable anchor for the height measurement: present in every view, so a
          window resize is picked up even when the canvas is unmounted. */}
      <div ref={viewAreaRef}>
      {viewMode === "config" ? (
        <ConfigPanel
          wf={wf}
          filePath={workflowFilePath ?? null}
          height={Math.max(300, canvasHeight - 40)}
          onRename={renameWorkflow}
          onSetComment={setWorkflowComment}
          onSetInputType={path.length === 0 ? setInputType : undefined}
        />
      ) : viewMode === "diff" ? (
        <SpaceBetween size="s">
          {codeError && (
            <Alert type="error" header="Couldn't build the diff">
              {codeError}
            </Alert>
          )}
          {diffTexts && (
            <WorkflowDiffView
              original={diffTexts.original}
              modified={diffTexts.modified}
              height={Math.max(300, canvasHeight - 64)}
            />
          )}
        </SpaceBetween>
      ) : viewMode === "code" ? (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SpaceBetween size="s">
              {codeError && (
                <Alert type="error" header="Couldn't apply the code">
                  {codeError}
                </Alert>
              )}
              <WorkflowCodeView
                key={codeNonce}
                text={codeOriginal}
                height={Math.max(300, canvasHeight - 40)}
                onChange={(v) => setCodeText(v)}
                onRevert={() => {
                  setCodeError("");
                  setCodeText(codeOriginal);
                  setCodeNonce((n) => n + 1);
                }}
                filePath={workflowFilePath ?? null}
                breakpointLines={breakpointLines}
                breakpointsSupported={breakpointsSupported}
                onToggleBreakpoint={onToggleBreakpoint}
                pausedLine={pausedLine}
              />
            </SpaceBetween>
          </div>
          {debugSession?.active &&
            onDebugCommand &&
            onDebugGetProperties &&
            onDebugDismiss && (
              <div
                style={{
                  flex: "0 0 340px",
                  height: Math.max(300, canvasHeight - 40),
                }}
              >
                <DebugPanel
                  session={debugSession}
                  onCommand={onDebugCommand}
                  onGetProperties={onDebugGetProperties}
                  onDismiss={onDebugDismiss}
                  fitHeight
                />
              </div>
            )}
        </div>
      ) : (
      <SpaceBetween size="s">
        {/* DAG scope bar (corrected model). DAG-ness comes from exactly one
            place: the `dagContainer` node kind, whose body is always DAG. There
            is no mode toggle anywhere. So:
              - ROOT scope and group/map/parallel bodies are always linear:
                nothing DAG-related renders.
              - a dagContainer body (drilled into): read-only "DAG" indicator
                + informational hint (its mode is fixed to DAG). */}
        {dagMode ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {/* A dagContainer body: its mode is fixed to DAG (no toggle). */}
            <StatusIndicator type="info">DAG</StatusIndicator>
            <Box fontSize="body-s" color="text-status-inactive">
              This is a DAG Container scope — always DAG, multiple dependencies
              allowed.
            </Box>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Palette */}
        <NodePalette
              dagEnabled={dagEnabled}
          canvasHeight={canvasHeight}
          onAdd={(kind, integration) =>
            addNode(
              kind,
              40 + wf.nodes.length * 24,
              40 + wf.nodes.length * 24,
              integration,
            )
          }
          onBrowseSdk={(clientPackage) => {
            setSdkInitial(clientPackage ?? null);
            setSdkOpen(true);
          }}
          onBrowseApi={(spec) => {
            setApiInitial(spec ?? null);
            setApiOpen(true);
          }}
        />

        {/* Canvas */}
        <Canvas
          canvasRef={canvasRef}
          canvasHeight={canvasHeight}
          zoom={zoom}
          wf={wf}
          byId={byId}
          selectedId={selectedId}
          connectingFrom={connectingFrom}
          errorNodeIds={errorNodeIds}
          breakpointNodeIds={breakpointNodeIds}
          breakpointsSupported={breakpointsSupported}
          onToggleNodeBreakpoint={onToggleNodeBreakpoint}
          pausedNodeId={pausedNodeId}
          onDrop={onCanvasDrop}
          onDropOnEdge={onEdgeDrop}
          pointerInsertEdgeId={dropEdgeId}
          onAddParallelBranch={addParallelBranch}
          onDeleteParallelBranch={deleteParallelBranch}
          onClearConnecting={() => setConnectingFrom(null)}
          onNodeClick={onNodeClick}
          onNodePointerDown={startDrag}
          onConnectFrom={setConnectingFrom}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
          onEnterContainer={enterContainer}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onAutoFit={autoFit}
          onAutoLayout={handleAutoLayout}
          layoutLocked={layoutLocked}
          onToggleLayoutLock={toggleLayoutLock}
          direction={layoutDirection}
          onSetDirection={setLayoutDirection}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />

        {/* Inspector */}
        <div
          style={{
            flex: "0 0 320px",
            // Bound the column to the canvas height so a tall Properties form
            // scrolls INSIDE the panel instead of growing the row past the
            // viewport (which made the whole page scroll vertically).
            height: canvasHeight,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <ValidationSummary
              issues={issues}
              hasErrors={hasErrors}
              onView={() => setValidationOpen(true)}
            />
          </div>
          {/* Debug sits ABOVE Properties: while a session is running it is
              the panel the user is actually reading (status, call stack,
              variables, stepping), and pushing it below a tall Properties
              form put it off-screen exactly when it mattered. Properties
              stays mounted underneath. Both share the column height and
              scroll their own bodies (fitHeight) so neither pushes the page. */}
          {debugSession?.active &&
            onDebugCommand &&
            onDebugGetProperties &&
            onDebugDismiss && (
              <div style={{ flex: "1 1 0", minHeight: 0 }}>
                <DebugPanel
                  session={debugSession}
                  onCommand={onDebugCommand}
                  onGetProperties={onDebugGetProperties}
                  onDismiss={onDebugDismiss}
                  fitHeight
                />
              </div>
            )}
          <div style={{ flex: "1 1 0", minHeight: 0 }}>
            <Container
              fitHeight
              header={<Header variant="h3">Properties</Header>}
            >
              {selected ? (
                <NodeInspector
                  node={selected}
                  nodes={wf.nodes}
                  edges={wf.edges}
                  scopeSymbols={scopeExtras(rootWf, path)}
                  onChange={(patch) => updateNode(selected.id, patch)}
                  inputType={rootWf.inputType}
                  onApplyCode={applyCodeUpdate}
                  onGenerateNodeCode={(req) =>
                    onGenerateNodeCode({ ...req, inputType: rootWf.inputType })
                  }
                  onListResources={onListResources}
                  onInferTypes={
                    onInferTypes
                      ? (items, seedTypes) =>
                          onInferTypes(items, seedTypes, rootWf.inputType)
                      : undefined
                  }
                  onApplyResultTypes={(types) => {
                    for (const [id, rt] of Object.entries(types)) {
                      updateNode(id, {
                        resultType: rt,
                        resultTypeInferred: true,
                      });
                    }
                  }}
                  onSetInputType={path.length === 0 ? setInputType : undefined}
                  onSetTerminal={setTerminal}
                  onAddBranch={addBranch}
                  onAddErrorRoute={addErrorRoute}
                  onSetBranch={setBranch}
                  onEndBranch={endBranch}
                  onDeleteBranch={deleteEdge}
                  onEnterContainer={enterContainer}
                  dagMode={dagMode}
                />
              ) : (
                <Box color="text-status-inactive">
                  Select a node to edit its properties.
                </Box>
              )}
            </Container>
          </div>
        </div>
      </div>
      </SpaceBetween>
      )}
      </div>

      {onImportStateMachine && onListStateMachines && (
        <ImportStepFunctionsModal
          visible={importOpen}
          onDismiss={() => setImportOpen(false)}
          onList={onListStateMachines}
          onImport={onImportStateMachine}
          phase={importPhase}
          notes={importNotes}
          faithful={importFaithful}
        />
      )}

      {onDeployStarterPackInfra && onLoadDar && (
        <StarterPackPickerModal
          dagEnabled={dagEnabled}
          visible={starterPackPickerOpen}
          onDismiss={() => setStarterPackPickerOpen(false)}
          onSelect={(packId) => {
            setStarterPackId(packId);
            setStarterPackPickerOpen(false);
            setStarterPackOpen(true);
          }}
        />
      )}

      {onDeployStarterPackInfra && onLoadDar && (
        <StarterPackModal
          visible={starterPackOpen}
          packId={starterPackId}
          onDismiss={() => setStarterPackOpen(false)}
          onDeployInfra={onDeployStarterPackInfra}
          onCancel={onCancelStarterPackDeploy}
          onLoadDar={onLoadDar}
          progress={starterPackInfraProgress}
        />
      )}

      <AwsSdkBrowserModal
        visible={sdkOpen}
        onDismiss={() => setSdkOpen(false)}
        onAdd={addAwsSdkCall}
        initialClientPackage={sdkInitial}
      />

      <ApiBrowserModal
        visible={apiOpen}
        onDismiss={() => setApiOpen(false)}
        onAdd={addHttpCall}
        initialSpec={apiInitial ?? undefined}
      />

      <Modal
        visible={agentOpen}
        onDismiss={() => setAgentOpen(false)}
        header="Generate a workflow with AI"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setAgentOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={agentBusy}
                disabled={!agentDesc.trim()}
                onClick={runAgentWorkflow}
              >
                Generate
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField
            label="Describe the workflow to build"
            description="The model returns a workflow which replaces the current canvas. Review before deploying."
          >
            <Textarea
              value={agentDesc}
              onChange={({ detail }) => setAgentDesc(detail.value)}
              rows={5}
              placeholder="e.g. Fetch an order by id, in parallel run a fraud check and inventory check, then if approved charge the card and email the customer"
            />
          </FormField>
          {agentBusy && (
            <Box color="text-status-inactive">
              <Spinner /> Generating…
            </Box>
          )}
          {agentError && (
            <Alert type="error" header="Couldn't generate the workflow">
              {agentError}
            </Alert>
          )}
        </SpaceBetween>
      </Modal>

      <Modal
        visible={confirmAction !== null}
        onDismiss={() => setConfirmAction(null)}
        header={
          confirmAction === "clear"
            ? "Clear the workflow?"
            : confirmAction === "editFunction"
              ? "Edit a deployed function?"
              : "Open a different workflow?"
        }
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmProceed}>
                {confirmAction === "clear" ? "Clear" : "Discard and open"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {confirmAction === "clear"
          ? "This resets the canvas to the default start → step1 → end workflow. Any unsaved changes will be lost."
          : confirmAction === "editFunction"
            ? "Editing a deployed function replaces the workflow currently on the canvas. Any unsaved changes will be lost."
            : "Opening a workflow file replaces the workflow currently on the canvas. Any unsaved changes will be lost."}
      </Modal>

      {deployLocked && <style>{DEPLOY_LOCK_STYLE}</style>}
      <Modal
        visible={deployOpen}
        // Locked while a deploy is running (nothing outside this modal reports
        // progress any more) and while a permissions review is outstanding (the
        // host's deploy is blocked awaiting the answer). Cloudscape has no prop
        // to hide its dismiss "X", so the one lever available is its
        // aria-label: it becomes DEPLOY_LOCK_LABEL, which the style rule below
        // hides. Keeping onDismiss guarded too, so the Esc key can't close it
        // either.
        onDismiss={() => {
          if (!deployLocked) setDeployOpen(false);
        }}
        closeAriaLabel={deployLocked ? DEPLOY_LOCK_LABEL : "Close"}
        header="Deploy workflow"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              {deployPermissions ? (
                // While a review is pending the host's deploy is BLOCKED on an
                // answer, so these replace the normal actions entirely —
                // dismissing the modal would strand the deploy mid-flight.
                <>
                  <Button
                    onClick={() =>
                      onRespondDeployPermissions?.(
                        deployPermissions.requestId,
                        false,
                      )
                    }
                  >
                    Skip
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      onRespondDeployPermissions?.(
                        deployPermissions.requestId,
                        true,
                      )
                    }
                  >
                    Attach permissions
                  </Button>
                </>
              ) : (
                <>
                  {!deployLocked && (
                    <Button variant="link" onClick={() => setDeployOpen(false)}>
                      Close
                    </Button>
                  )}
                  {deployBusy && onCancelDeploy && (
                    <Button
                      loading={deployCancelling}
                      disabled={deployCancelling}
                      onClick={() => {
                        setDeployCancelling(true);
                        onCancelDeploy();
                      }}
                    >
                      {deployCancelling ? "Cancelling…" : "Cancel deploy"}
                    </Button>
                  )}
                  {deployRequested && deployStatus?.status === "done" ? (
                    <Button
                      variant="primary"
                      iconName="external"
                      onClick={() => {
                        onViewFunction(deployFnName.trim());
                        setDeployOpen(false);
                      }}
                    >
                      View deployed function
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      loading={deployBusy}
                      disabled={!deployFnName.trim() || deployBusy}
                      onClick={() => {
                        pendingCommitRef.current = rootWf;
                        setDeployRequested(true);
                        onDeploy(deployFnName.trim(), rootWf);
                      }}
                    >
                      Deploy
                    </Button>
                  )}
                </>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>
            This creates or updates a durable Lambda in your configured AWS
            account/region (from Workflow Insight settings) and points a
            <code> live </code> alias at a new version. It performs real,
            billable AWS changes.
          </Box>
          <FormField
            label="Function name"
            description="Also the execution role name prefix when auto-created."
          >
            <Input
              value={deployFnName}
              disabled={deployBusy}
              onChange={({ detail }) => {
                setDeployFnName(detail.value);
                // Editing the target name means the previous result no longer
                // describes what would happen, so re-arm Deploy without making
                // the user close and reopen the modal.
                if (!deployBusy) setDeployRequested(false);
              }}
            />
          </FormField>
          {deployRequested && deployLog.length > 0 && (
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                maxHeight: 200,
                overflow: "auto",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 8,
              }}
            >
              {deployLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          {deployPermissions && (
            <SpaceBetween size="xs">
              <Alert
                type="info"
                header={`Review IAM permissions for "${deployPermissions.roleName}"`}
              >
                These were inferred from your workflow's code. Attaching them
                adds a single inline policy
                (<code>workflow-inferred-permissions</code>) to the
                auto-created execution role. Skipping still deploys the
                function — it may just lack permissions at runtime.
              </Alert>
              <Table
                variant="embedded"
                items={deployPermissions.statements}
                trackBy={(s) => `${s.source}:${s.actions.join(",")}`}
                empty={
                  <Box color="text-status-inactive">
                    No permissions inferred from this workflow's code.
                  </Box>
                }
                columnDefinitions={[
                  {
                    id: "actions",
                    header: "Actions",
                    cell: (s) => (
                      <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {s.actions.join(", ")}
                      </span>
                    ),
                  },
                  {
                    id: "resources",
                    header: "Resources",
                    cell: (s) => (
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          wordBreak: "break-all",
                        }}
                      >
                        {s.resources.join(", ")}
                      </span>
                    ),
                  },
                  {
                    id: "source",
                    header: "Inferred from",
                    cell: (s) => s.source,
                  },
                ]}
              />
              {deployPermissions.warnings.length > 0 && (
                <Alert type="warning" header="Couldn't infer everything">
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {deployPermissions.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </SpaceBetween>
          )}
          {deployRequested && deployStatus && (
            <StatusIndicator
              type={
                deployStatus.status === "done"
                  ? "success"
                  : deployStatus.status === "error"
                    ? "error"
                    : "in-progress"
              }
            >
              {deployStatus.status === "done"
                ? // Full detail lives here, and only here — this used to be a
                  // banner above the canvas, where it lingered long after the
                  // deploy and cluttered the editor.
                  `Deployed → ${deployStatus.result.aliasArn} (executionTimeout ${deployStatus.result.executionTimeoutSeconds}s)`
                : deployStatus.status === "error"
                  ? `Deploy failed: ${deployStatus.message}`
                  : deployStatus.message}
            </StatusIndicator>
          )}
        </SpaceBetween>
      </Modal>

      {onRun && (
        <Modal
          visible={runOpen}
          onDismiss={() => setRunOpen(false)}
          header={runDebug ? "Debug workflow" : "Execute workflow"}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setRunOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  iconName={runDebug ? "bug" : "play"}
                  onClick={() => {
                    // Targets, in priority order: the file's persisted
                    // meta.deploy record (survives editor restarts), the name
                    // entered in the deploy modal this session, then the same
                    // workflow-name default the deploy modal starts from.
                    onRun(
                      rootWf.deploy?.functionName ||
                        deployFnName.trim() ||
                        (rootWf.name || "workflow")
                          .replace(/[^\w.-]+/g, "-")
                          .replace(/^-+|-+$/g, "") ||
                        "workflow",
                      runPayload,
                      runExecName.trim() || undefined,
                      runDebug,
                    );
                    setRunOpen(false);
                  }}
                >
                  {runDebug ? "Debug" : "Execute"}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="s">
            <Box>
              {runDebug
                ? "Invokes the deployed function synchronously under a remote debug session — breakpoints set in the code view will pause it. Requires a deploy with \"Deploy With Debug Info\" enabled."
                : "Starts a new durable execution of the deployed function (asynchronous — returns immediately with the execution ARN)."}
            </Box>
            <FormField
              label="Execution name"
              description="Optional idempotency name (--durable-execution-name): the same name never starts the same execution twice."
            >
              <Input
                value={runExecName}
                placeholder="order-12345"
                onChange={({ detail }) => setRunExecName(detail.value)}
              />
            </FormField>
            <FormField label="Payload" description="JSON event for the execution.">
              <Textarea
                value={runPayload}
                rows={5}
                onChange={({ detail }) => setRunPayload(detail.value)}
              />
            </FormField>
            <Checkbox
              checked={runDebug}
              onChange={({ detail }) => setRunDebug(detail.checked)}
            >
              Debug (pause at breakpoints via a remote debug session)
            </Checkbox>
          </SpaceBetween>
        </Modal>
      )}

      <ValidationModal
        open={validationOpen}
        issues={issues}
        onClose={() => setValidationOpen(false)}
        onSelectNode={setSelectedId}
      />

      {/* Off-screen, fully-expanded render of the whole workflow (including
          every map/parallel child body) — its <svg> is what Export SVG/PNG
          serializes. Kept mounted (not just rendered on click) so the export
          is instant and always reflects the current graph. */}
      <div
        style={{
          position: "absolute",
          top: -100000,
          left: -100000,
          pointerEvents: "none",
        }}
        aria-hidden
      >
        <ExecutionGraph
          workflow={rootWf}
          operations={[]}
          svgRef={exportSvgRef}
          fixedZoom={1}
          hideToolbar
        />
      </div>
    </SpaceBetween>
  );
}
