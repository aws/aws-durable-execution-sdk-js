/**
 * Inline code view for the Workflow Studio: shows the whole workflow as a
 * `.dar.ts` file in a Monaco editor. Plain TypeScript editing (no scaffold
 * markers — the entire file is the document); the parent owns serialization
 * (host round-trip) and applying edits back to the model.
 *
 * Also renders a click-to-toggle BREAKPOINT GUTTER (see `monacoSetup.ts`'s
 * `attachBreakpointGutter` for the rendering half). This editor line ↔ real
 * `.dar.ts` file line is an IDENTITY mapping (no translation needed) only
 * because `text` here is the exact same canonical `.dar.ts` text that gets
 * written to disk on save — see this feature's design notes on why
 * breakpoints require a save first: `filePath` is null until the workflow
 * has a real backing file, and a click is a no-op (with an explanatory
 * tooltip) until then, since there is nothing real to target a
 * `vscode.SourceBreakpoint` against.
 */
import { useEffect, useRef, useState } from "react";
import Button from "@cloudscape-design/components/button";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  attachBreakpointGutter,
  configureMonaco,
  initMonacoWorkers,
  setLayoutSectionHidden,
  setPausedLine,
  type BreakpointGutterHandle,
  type PausedLineHandle,
} from "./monacoSetup";

let modelSeq = 0;

export function WorkflowCodeView({
  text,
  onChange,
  onRevert,
  height,
  filePath,
  breakpointLines,
  breakpointsSupported,
  onToggleBreakpoint,
  pausedLine,
}: {
  /** The `.dar.ts` document to display (owned by the parent). */
  text: string;
  /** Called with the full document on every edit. */
  onChange: (value: string) => void;
  /** Reset the document to the last-serialized text (parent remounts). */
  onRevert: () => void;
  height: number;
  /** The real on-disk path backing `text`, or null if none exists yet (see
   *  this component's own doc comment — breakpoints need a save first). */
  filePath?: string | null;
  /** Current real breakpoint lines (1-based), mirrored from the host. */
  breakpointLines?: number[];
  /** False when the host can't register real debugger breakpoints at all
   *  (the standalone desktop app — no `vscode.debug` in Electron). */
  breakpointsSupported?: boolean;
  /** Fires with the clicked 1-based line when `filePath` is set. */
  onToggleBreakpoint?: (line: number) => void;
  /** The 1-based line the active debug session is paused at, or null/absent
   *  when not paused — rendered as a full-line highlight + glyph arrow (see
   *  monacoSetup.ts's setPausedLine) and revealed centered when it moves. */
  pausedLine?: number | null;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layoutHidden, setLayoutHidden] = useState(false);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null);
  const gutterRef = useRef<BreakpointGutterHandle | null>(null);
  const pausedRef = useRef<PausedLineHandle | null>(null);
  // Always current inside the mouse-down closure captured at mount time,
  // without re-attaching the gutter on every prop change.
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const onToggleRef = useRef(onToggleBreakpoint);
  onToggleRef.current = onToggleBreakpoint;
  const supportedRef = useRef(breakpointsSupported);
  supportedRef.current = breakpointsSupported;

  const statusText = `Edits apply when you switch back to Visual or Diff. ${
    breakpointsSupported === false
      ? "Breakpoints require the VS Code extension."
      : filePath
        ? "Click a line's margin to set a breakpoint."
        : "Save the workflow to set breakpoints."
  }`;

  useEffect(() => {
    if (editorRef.current && modelRef.current) {
      setLayoutSectionHidden(editorRef.current, modelRef.current, layoutHidden);
    }
  }, [layoutHidden]);

  // Keep the rendered gutter dots in sync with the host's real breakpoint
  // list (e.g. after "breakpointsChanged", or on first mount once the host
  // responds to "getBreakpoints").
  useEffect(() => {
    gutterRef.current?.setBreakpointLines(breakpointLines ?? []);
  }, [breakpointLines]);

  // Move/clear the paused-line highlight whenever the session's pause
  // position changes (setPausedLine also reveals the line centered). The
  // mount effect below re-applies the current value when the editor is
  // (re)created, so a pause that arrives before Monaco finishes loading —
  // or one carried across a code-view remount — still shows.
  useEffect(() => {
    pausedRef.current?.setPausedLine(pausedLine ?? null);
  }, [pausedLine]);
  // Always current inside the mount closure (same pattern as filePathRef).
  const pausedLineRef = useRef(pausedLine);
  pausedLineRef.current = pausedLine;

  useEffect(() => {
    if (!container) return;
    let cancelled = false;
    let ed: MonacoEditor.IStandaloneCodeEditor | null = null;
    let model: MonacoEditor.ITextModel | null = null;
    let changeSub: { dispose(): void } | undefined;

    void (async () => {
      try {
        const monaco = configureMonaco();
        await initMonacoWorkers();
        if (cancelled || !container) return;
        const uri = monaco.Uri.parse(`file:///workflow-${modelSeq++}.dar.ts`);
        model = monaco.editor.createModel(text, "typescript", uri);
        ed = monaco.editor.create(container, {
          model,
          language: "typescript",
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          tabSize: 2,
        });
        editorRef.current = ed;
        modelRef.current = model;
        const m = model;
        changeSub = m.onDidChangeContent(() => onChange(m.getValue()));
        gutterRef.current = attachBreakpointGutter(ed, m, (line) => {
          if (supportedRef.current === false) return; // desktop app — no real debugger
          if (!filePathRef.current) return; // no real file to target yet
          onToggleRef.current?.(line);
        });
        gutterRef.current.setBreakpointLines(breakpointLines ?? []);
        pausedRef.current = setPausedLine(ed, m);
        pausedRef.current.setPausedLine(pausedLineRef.current ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      changeSub?.dispose();
      gutterRef.current?.dispose();
      gutterRef.current = null;
      pausedRef.current?.dispose();
      pausedRef.current = null;
      editorRef.current = null;
      modelRef.current = null;
      ed?.dispose();
      model?.dispose();
    };
    // The document is only re-seeded when the parent remounts the view (keyed
    // by serialization nonce) — live edits flow up through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  return (
    <div
      style={{
        border: "1px solid #30363d",
        borderRadius: 8,
        overflow: "hidden",
        background: "#1e1e1e",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
          padding: "4px 8px",
          borderBottom: "1px solid #30363d",
          background: "#161b22",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <Button
            variant="icon"
            iconName="undo"
            ariaLabel="Undo"
            onClick={() => editorRef.current?.trigger("toolbar", "undo", null)}
          />
          <Button
            variant="icon"
            iconName="redo"
            ariaLabel="Redo"
            onClick={() => editorRef.current?.trigger("toolbar", "redo", null)}
          />
          <Button
            variant="icon"
            iconName="refresh"
            ariaLabel="Revert all changes"
            onClick={onRevert}
          />
          <Button
            variant="icon"
            iconName={layoutHidden ? "treeview-expand" : "treeview-collapse"}
            ariaLabel={
              layoutHidden ? "Show the layout section" : "Hide the layout section"
            }
            onClick={() => setLayoutHidden((v) => !v)}
          />
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#8b949e",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={statusText}
        >
          {statusText}
        </span>
      </div>
      {error && (
        <div style={{ color: "#f85149", padding: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
      <div ref={setContainer} style={{ height, width: "100%" }} />
    </div>
  );
}
