// Monaco configuration for the built-in code editor.
//
// Runs Monaco's TypeScript language service in-browser so code blocks get real
// type-checking + autocomplete — the same context the old "Edit in VS Code"
// scaffold provided (StepCtx/WaitCtx/Logger, a typed `event`/`input`, and typed
// upstream result consts), fed to the TS worker as an extra library.
//
// We import the tree-shaken `editor.api` build for a smaller bundle and pull in
// only the TypeScript language + basic-language contributions. The `typescript`
// namespace types live on the bare "monaco-editor" module, so the runtime
// object is cast to those full types.
import * as monaco from "monaco-editor";

// Full module type; the runtime `languages.typescript` is the real service even
// though its *type* is a deprecated stub (the good types live at top-level
// `typescript`). Bridge below.
type MonacoModule = typeof monaco;

// Runtime keeps the TS language service under `languages.typescript`, but the
// full module types expose it at the top-level `typescript` export. Bridge the
// two: read the runtime object, view it with the correct type.
type TsNamespace = MonacoModule["typescript"];
function tsNamespace(): TsNamespace {
  return (monaco.languages as unknown as { typescript: TsNamespace })
    .typescript;
}

/** Register an ambient extra lib with the TS worker. Returns its disposable. */
export function addScaffoldExtraLib(content: string, path: string) {
  return tsNamespace().typescriptDefaults.addExtraLib(content, path);
}

/** Resolves once the TS worker is reachable; rejects if it failed to start. */
export async function ensureTsWorker(): Promise<void> {
  await tsNamespace().getTypeScriptWorker();
}

const IGNORE_CODES = new Set([1108, 1375, 1378]);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

interface DiagChain {
  messageText: string;
  next?: DiagChain[];
}
function flattenMessage(m: string | DiagChain): string {
  if (typeof m === "string") return m;
  let out = m.messageText;
  for (const n of m.next ?? []) out += "\n  " + flattenMessage(n);
  return out;
}

/**
 * Pull TS syntactic + semantic diagnostics from the worker and render them as
 * model markers (red/yellow squiggles). Returns the marker count; throws with a
 * clear label if the worker never responds, so callers surface a broken worker
 * instead of silently showing nothing. We drive markers explicitly because the
 * automatic adapter isn't reliably wired in this bundling setup.
 */
export async function validateModel(
  model: monaco.editor.ITextModel,
): Promise<number> {
  const uriStr = model.uri.toString();
  const getWorker = await withTimeout(
    tsNamespace().getTypeScriptWorker(),
    8000,
    "TS worker startup",
  );
  const client = await withTimeout(
    getWorker(model.uri),
    8000,
    "TS worker attach",
  );
  const [syntactic, semantic] = await Promise.all([
    withTimeout(
      client.getSyntacticDiagnostics(uriStr),
      8000,
      "syntactic diagnostics",
    ),
    withTimeout(
      client.getSemanticDiagnostics(uriStr),
      8000,
      "semantic diagnostics",
    ),
  ]);
  const markers = [...syntactic, ...semantic]
    .filter((d) => !IGNORE_CODES.has(d.code))
    .map((d) => {
      const start = model.getPositionAt(d.start ?? 0);
      const end = model.getPositionAt((d.start ?? 0) + (d.length ?? 0));
      return {
        severity:
          d.category === 1
            ? monaco.MarkerSeverity.Error
            : d.category === 0
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        message: flattenMessage(d.messageText as string | DiagChain),
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        code: String(d.code),
      };
    });
  monaco.editor.setModelMarkers(model, "ts-live", markers);
  return markers.length;
}

// Markers delimiting the editable body inside the scaffold (kept identical in
// spirit to the old VS Code round-trip so behavior matches).
export const CODE_BEGIN =
  "// ==== your code below (saved back to the node) ====";
export const CODE_END = "// ==== your code above ====";

/**
 * What shape of code a field holds, which decides the scaffold wrapped around it
 * for type-checking. `"expression"` is a single VALUE (an API call's query /
 * headers / body object) rather than a statement block, so it is wrapped in a
 * `return ( … )` instead of a function body.
 */
export type CodeKind =
  | "step"
  | "condition"
  | "submitter"
  | "fallback"
  | "expression"
  | "duration"
  | "durationExpression";

// The extension injects the webview-resource base for the bundled workers.
declare global {
  // eslint-disable-next-line no-var
  var __MONACO_WORKER_BASE__: string | undefined;
}

let configured = false;

// Same-origin blob URLs for the bundled workers, built by fetching the worker
// source and wrapping it in a blob. This avoids cross-origin `importScripts`
// (which hangs under the webview CSP) — the worker runs its full code inline.
const workerBlobUrls: Record<string, string> = {};

async function loadWorkerBlob(file: string): Promise<string> {
  if (workerBlobUrls[file]) return workerBlobUrls[file];
  const base = globalThis.__MONACO_WORKER_BASE__ ?? "";
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Monaco worker ${file}: HTTP ${res.status}`,
    );
  }
  const code = await res.text();
  const url = URL.createObjectURL(
    new Blob([code], { type: "application/javascript" }),
  );
  workerBlobUrls[file] = url;
  return url;
}

/**
 * Preload the worker sources into same-origin blobs. Must be awaited before the
 * editor is created so the synchronous `getWorker` can hand back a ready blob.
 */
export async function initMonacoWorkers(): Promise<void> {
  await Promise.all([
    loadWorkerBlob("editor.worker.js"),
    loadWorkerBlob("ts.worker.js"),
  ]);
}

/** Idempotent one-time Monaco/worker/TS-service configuration. */
export function configureMonaco(): MonacoModule {
  if (configured) return monaco;
  configured = true;

  (
    self as unknown as {
      MonacoEnvironment: import("monaco-editor").Environment;
    }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const file =
        label === "typescript" || label === "javascript"
          ? "ts.worker.js"
          : "editor.worker.js";
      const url = workerBlobUrls[file];
      if (!url) {
        const msg = `Monaco worker ${file} not preloaded (call initMonacoWorkers first)`;
        window.dispatchEvent(new CustomEvent("monaco-error", { detail: msg }));
        throw new Error(msg);
      }
      const worker = new Worker(url);
      worker.onerror = (e) => {
        const msg = `Monaco worker error (${label}): ${e.message || "failed"}`;
        // eslint-disable-next-line no-console
        console.error(msg, e);
        window.dispatchEvent(new CustomEvent("monaco-error", { detail: msg }));
      };
      return worker;
    },
  };

  const ts = tsNamespace();
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: false,
    esModuleInterop: true,
    lib: ["es2020", "dom"],
  });
  // We render diagnostics ourselves (see validateModel), so disable Monaco's
  // automatic adapter to avoid duplicate/competing markers. Completions + hover
  // still come from the worker independently of these flags.
  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    diagnosticCodesToIgnore: [
      1108, // A 'return' statement can only be used within a function body.
      1375, // 'await' at top level.
      1378, // top-level await module flag.
    ],
  });

  return monaco;
}

/**
 * A full, editable scaffold document (same shape as the old "Edit in VS Code"
 * round-trip): the block's context types, a typed `event`/`input`, typed
 * upstream result consts, and the async function wrapper — with the user's body
 * between marker lines. Rendered directly in the editor so the developer SEES
 * the context and gets real type-checking + autocomplete from in-file
 * declarations. `extractBody` recovers just the body on save.
 *
 * `depsType` (DAG scopes only) is a TypeScript object-type literal for the
 * `deps` map the generated DAG task body provides — e.g. `{ "a": A; "b": any }`.
 * When present, the scaffold also declares `declare const deps: <depsType>;`, so
 * `deps["a"]` / `deps.a` type-check + autocomplete exactly like the generated
 * body `async (deps, ctx) => { const a = deps["a"]; … }`. Omitted (linear) =>
 * behaves exactly as before (bare upstream consts only, no `deps`).
 */
export function buildScaffold(
  codeKind: CodeKind,
  scope: string[],
  scopeTypes: Record<string, string> = {},
  inputType: string | undefined,
  body: string,
  depsType?: string,
): string {
  const hasInputType =
    typeof inputType === "string" && inputType.trim().length > 0;
  const typedInput = new Set(["event", "input"]);
  const provided =
    codeKind === "fallback"
      ? ["err"]
      : codeKind === "condition"
        ? ["state"]
        : codeKind === "submitter"
          ? ["callbackId"]
          : [];
  const signature =
    codeKind === "step"
      ? "async function workflowStudioBlock(stepCtx: StepCtx): Promise<unknown> {"
      : codeKind === "condition"
        ? "async function workflowStudioBlock(state: any, ctx: WaitCtx): Promise<unknown> {"
        : codeKind === "fallback"
          ? "async function workflowStudioBlock(err: Error): Promise<unknown> {"
          : codeKind === "durationExpression"
            ? // A wait duration written as a single EXPRESSION (`12`,
              // `get_order.retryAfter`). Typed `number` so the unit mistake —
              // returning a string or a Date — is caught in the editor.
              "function workflowStudioBlock(): number {\n  return ("
            : codeKind === "duration"
              ? // A wait's dynamic duration is inlined into `{ seconds: (() => {
                // … })() }` — a SYNCHRONOUS, parameterless IIFE returning a
                // number of seconds. Typed to match exactly: `number` so a string
                // or object is rejected, and NOT async because `await` here is a
                // hard SyntaxError in the emitted code (and would in any case be
                // non-deterministic work outside a step, which the replay model
                // forbids).
                "function workflowStudioBlock(): number {"
              : codeKind === "expression"
                ? // The edited region is an EXPRESSION, so it must sit in a value
                  // position for TypeScript to check it (and for Monaco to offer
                  // completions on the upstream consts declared above).
                  "function workflowStudioBlock(): unknown {\n  return ("
                : "async function workflowStudioBlock(callbackId: string, ctx: WaitCtx): Promise<void> {";
  const inScope = scope.filter((name) => !provided.includes(name));
  const typeAlias = hasInputType
    ? [`type WorkflowInput = ${inputType!.trim()};`]
    : [];
  const upstream = inScope.map((name) => {
    const t =
      hasInputType && typedInput.has(name)
        ? "WorkflowInput"
        : (scopeTypes[name] ?? "any");
    return `declare const ${name}: ${t}; // in scope here`;
  });
  // DAG scopes only: the typed `deps` map the generated task body provides
  // (`async (deps, ctx) => …`). Declared alongside the bare upstream consts so
  // `deps["A"]` / `deps.A` type-check + autocomplete. Absent in linear scopes.
  const depsDecl =
    typeof depsType === "string" && depsType.trim().length > 0
      ? [`declare const deps: ${depsType.trim()}; // direct dependencies`]
      : [];
  return [
    "// Workflow Studio — edit your code between the marker lines below.",
    "// The surrounding scaffold (bindings + async function) is only here so",
    "// your code type-checks; it is NOT saved. Only the marked region is",
    "// written back to the workflow node.",
    "export {};",
    "type Logger = { debug(...a: any[]): void; info(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };",
    "/** The step's StepContext: current attempt number + a durable logger. */",
    "type StepCtx = { attempt: number; logger: Logger; [k: string]: any };",
    "type WaitCtx = { logger: Logger; [k: string]: any };",
    ...typeAlias,
    ...depsDecl,
    ...upstream,
    signature,
    CODE_BEGIN,
    body,
    CODE_END,
    codeKind === "expression" || codeKind === "durationExpression"
      ? "  );\n}"
      : "}",
  ].join("\n");
}

/** Recover the editable region from a scaffold document (see buildScaffold). */
export function extractBody(text: string): string {
  const b = text.indexOf(CODE_BEGIN);
  const e = text.lastIndexOf(CODE_END);
  if (b === -1 || e === -1 || e < b) return text; // markers removed → save as-is
  const bodyStart = text.indexOf("\n", b);
  if (bodyStart === -1) return text;
  return text.slice(bodyStart + 1, e).replace(/\n+$/, "");
}

/**
 * Shows/hides the trailing `export const meta` section of a `.dar.ts`
 * document (layout + deployment record) by hiding its line range in the
 * editor (Monaco's hidden-areas mechanism, the same one peek views use). The
 * text itself is untouched — edits and round-trips still carry the meta.
 */
export function setLayoutSectionHidden(
  editor: monaco.editor.ICodeEditor,
  model: monaco.editor.ITextModel,
  hidden: boolean,
): void {
  let start = -1;
  const total = model.getLineCount();
  for (let i = 1; i <= total; i += 1) {
    if (model.getLineContent(i).startsWith("export const meta")) {
      start = i;
      break;
    }
  }
  const ranges =
    hidden && start !== -1
      ? [
          {
            startLineNumber: start,
            startColumn: 1,
            endLineNumber: total,
            endColumn: 1,
          },
        ]
      : [];
  // setHiddenAreas exists on ICodeEditor but isn't in the public typings.
  (editor as unknown as { setHiddenAreas(r: unknown[]): void }).setHiddenAreas(
    ranges,
  );
}

// ---------------------------------------------------------------------------
// Breakpoint gutter
// ---------------------------------------------------------------------------
// Standalone Monaco (running inside the webview, with NO awareness of VS
// Code's own debug/breakpoint system — confirmed this is a hard sandboxing
// boundary, not a configuration gap: a Monaco maintainer states plainly that
// "Monaco runs on the browser. It's not going to have access to your...
// executable" i.e. no Debug Adapter Protocol visibility at all) can still
// render a clickable gutter and dispatch which LINE was clicked; the
// extension host (which DOES have `vscode.debug` access) is the one that
// turns that line into a real `vscode.SourceBreakpoint` against the actual
// `.dar.ts` file on disk. This module only owns the glyph-margin
// rendering/click-detection half — see `WorkflowCodeView.tsx` for how clicks
// get relayed to the host, and `extension.ts` for the `vscode.debug` side.
const BREAKPOINT_GLYPH_CLASS = "workflow-studio-breakpoint-glyph";
const BREAKPOINT_GLYPH_CSS_INJECTED = "workflow-studio-breakpoint-glyph-css";

/** Injects the breakpoint dot's CSS once per document (idempotent). */
function ensureBreakpointGlyphCss(): void {
  if (document.getElementById(BREAKPOINT_GLYPH_CSS_INJECTED)) return;
  const style = document.createElement("style");
  style.id = BREAKPOINT_GLYPH_CSS_INJECTED;
  style.textContent = `
    .${BREAKPOINT_GLYPH_CLASS} {
      background: #e51400;
      border-radius: 50%;
      width: 10px !important;
      height: 10px !important;
      margin-left: 5px;
      margin-top: 5px;
    }
  `;
  document.head.appendChild(style);
}

export interface BreakpointGutterHandle {
  /** Replaces the full set of rendered breakpoint lines (1-based). */
  setBreakpointLines(lines: number[]): void;
  dispose(): void;
}

/**
 * Wires a click-to-toggle breakpoint gutter onto `editor`/`model`. Rendering
 * only — this component holds no breakpoint state of its own; the caller
 * (`WorkflowCodeView.tsx`) is the source of truth (mirroring the extension
 * host's real `vscode.debug` breakpoint list) and calls
 * `setBreakpointLines` whenever that list changes, including in response to
 * the host's own `onDidChangeBreakpoints` (so a breakpoint added/removed via
 * a normal editor tab, or by VS Code itself, still shows up here).
 * `onToggle` fires with the clicked 1-based line number; the caller decides
 * what that means (send a host message, or no-op/show a tooltip if the
 * document hasn't been saved to a real file yet — see this feature's design
 * notes on requiring a save first).
 */
export function attachBreakpointGutter(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  onToggle: (lineNumber: number) => void,
): BreakpointGutterHandle {
  ensureBreakpointGlyphCss();
  editor.updateOptions({ glyphMargin: true });

  let decorationIds: string[] = [];
  const lineToDecorationId = new Map<number, string>();

  const mouseDownSub = editor.onMouseDown((e) => {
    if (
      e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
      e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
    ) {
      return;
    }
    const line = e.target.position?.lineNumber;
    if (line != null) onToggle(line);
  });

  function setBreakpointLines(lines: number[]): void {
    const newDecorations: monaco.editor.IModelDeltaDecoration[] = lines.map(
      (line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: BREAKPOINT_GLYPH_CLASS,
          glyphMarginHoverMessage: { value: "Breakpoint" },
        },
      }),
    );
    decorationIds = model.deltaDecorations(decorationIds, newDecorations);
    lineToDecorationId.clear();
    lines.forEach((line, i) => lineToDecorationId.set(line, decorationIds[i]));
  }

  return {
    setBreakpointLines,
    dispose() {
      mouseDownSub.dispose();
      if (decorationIds.length > 0) model.deltaDecorations(decorationIds, []);
    },
  };
}

// ---------------------------------------------------------------------------
// Paused-line decoration (debugger)
// ---------------------------------------------------------------------------
// Renders where the in-Studio debug session is currently paused: a full-line
// background highlight + a glyph-margin arrow. Deliberately a DIFFERENT CSS
// class pair from the breakpoint dot above — a line can be both a breakpoint
// AND the paused line at once, and the two decorations must stack (red dot
// under the arrow, like VS Code's own editor).
const PAUSED_LINE_CLASS = "workflow-studio-paused-line";
const PAUSED_GLYPH_CLASS = "workflow-studio-paused-glyph";
const PAUSED_LINE_CSS_INJECTED = "workflow-studio-paused-line-css";

/** Injects the paused-line CSS once per document (idempotent). */
function ensurePausedLineCss(): void {
  if (document.getElementById(PAUSED_LINE_CSS_INJECTED)) return;
  const style = document.createElement("style");
  style.id = PAUSED_LINE_CSS_INJECTED;
  // Colors match VS Code's dark-theme "top stack frame" look: a translucent
  // yellow line wash + a yellow arrow. The arrow is a CSS triangle so no
  // icon asset is needed inside the webview.
  style.textContent = `
    .${PAUSED_LINE_CLASS} {
      background: rgba(255, 214, 0, 0.12);
    }
    .${PAUSED_GLYPH_CLASS}::after {
      content: "";
      display: block;
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      border-left: 8px solid #ffcc00;
      margin-left: 4px;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}

export interface PausedLineHandle {
  /** Moves the highlight to `line` (1-based) or clears it with null. */
  setPausedLine(line: number | null): void;
  dispose(): void;
}

/**
 * Manages the single paused-line decoration for `editor`/`model`. Owns its
 * decoration ids the same delta-decorations way as the breakpoint gutter (a
 * decoration *collection* would also work, but matching the sibling pattern
 * keeps this file consistent). Also reveals the line centered whenever it
 * moves, so a step/continue landing off-screen scrolls into view.
 */
export function setPausedLine(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
): PausedLineHandle {
  ensurePausedLineCss();
  editor.updateOptions({ glyphMargin: true });

  let decorationIds: string[] = [];

  return {
    setPausedLine(line: number | null): void {
      const decorations: monaco.editor.IModelDeltaDecoration[] =
        line == null
          ? []
          : [
              {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                  isWholeLine: true,
                  className: PAUSED_LINE_CLASS,
                  glyphMarginClassName: PAUSED_GLYPH_CLASS,
                  glyphMarginHoverMessage: { value: "Paused here" },
                },
              },
            ];
      decorationIds = model.deltaDecorations(decorationIds, decorations);
      if (line != null) editor.revealLineInCenter(line);
    },
    dispose() {
      if (decorationIds.length > 0) model.deltaDecorations(decorationIds, []);
      decorationIds = [];
    },
  };
}
