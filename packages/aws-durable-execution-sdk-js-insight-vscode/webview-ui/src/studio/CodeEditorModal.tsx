// Built-in code editor (Monaco) shown in a modal overlay, replacing the old
// round-trip to a VS Code tab. Provides real TypeScript type-checking +
// autocomplete via an in-browser TS worker seeded with the node's scaffold
// context. On close it hands the final value back (which saves it + re-infers).
//
// We use a plain fixed-position overlay rather than Cloudscape's <Modal> so the
// editor's container is in the DOM immediately with a deterministic size —
// Cloudscape's Modal mounts into a portal and constrains body height, which
// left Monaco rendering blank.
import { useEffect, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  buildScaffold,
  CODE_BEGIN,
  configureMonaco,
  extractBody,
  initMonacoWorkers,
  validateModel,
  type CodeKind,
} from "./monacoSetup";

let modelSeq = 0;

export function CodeEditorModal({
  open,
  title,
  value,
  codeKind,
  scope,
  scopeTypes,
  inputType,
  depsType,
  onClose,
}: {
  open: boolean;
  title: string;
  value: string;
  codeKind: CodeKind;
  scope: string[];
  scopeTypes: Record<string, string>;
  inputType?: string;
  /** DAG scopes only: TS object-type literal for the injected `deps` map. */
  depsType?: string;
  onClose: (value: string) => void;
}) {
  // Gate editor creation on the container actually mounting (ref-callback →
  // state) so creation never races the DOM.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] =
    useState<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = () =>
    onClose(editor ? extractBody(editor.getValue()) : value);

  // Surface any async failures (worker load, unhandled errors/rejections) that
  // would otherwise leave the editor silently blank.
  useEffect(() => {
    if (!open) return;
    const onMonaco = (e: Event) =>
      setError(String((e as CustomEvent<string>).detail));
    const onErr = (e: ErrorEvent) =>
      setError(`${e.message}${e.filename ? ` [${e.filename}]` : ""}`);
    const onRej = (e: PromiseRejectionEvent) =>
      setError(`Unhandled rejection: ${String(e.reason)}`);
    window.addEventListener("monaco-error", onMonaco as EventListener);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("monaco-error", onMonaco as EventListener);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !container) return;
    let cancelled = false;
    let ed: MonacoEditor.IStandaloneCodeEditor | null = null;
    let model: MonacoEditor.ITextModel | null = null;
    let raf = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let changeSub: { dispose(): void } | undefined;

    void (async () => {
      try {
        const monaco = configureMonaco();
        // Fetch + cache the worker sources before creating the editor so the
        // synchronous getWorker can hand back a ready same-origin blob worker.
        await initMonacoWorkers();
        if (cancelled || !container) return;

        const uri = monaco.Uri.parse(`file:///wf-block-${modelSeq++}.ts`);
        const doc = buildScaffold(codeKind, scope, scopeTypes, inputType, value, depsType);
        model = monaco.editor.createModel(doc, "typescript", uri);
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
        setEditor(ed);

        // Drop the cursor onto the first editable line (just after the marker).
        const beginIdx = doc.indexOf(CODE_BEGIN);
        if (beginIdx !== -1) {
          const bodyLine = model.getPositionAt(beginIdx).lineNumber + 1;
          ed.setPosition({ lineNumber: bodyLine, column: 1 });
          ed.revealLineInCenterIfOutsideViewport(bodyLine);
        }

        const created = ed;
        raf = requestAnimationFrame(() => {
          created.layout();
          created.focus();
        });
        t = setTimeout(() => created.layout(), 250);

        // Drive diagnostics explicitly: initial pass + debounced on every edit.
        const activeModel = model;
        const validate = () =>
          void validateModel(activeModel).catch((e) =>
            setError(
              `Type checking unavailable: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          );
        validate();
        changeSub = activeModel.onDidChangeContent(() => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(validate, 400);
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? (e.stack ?? e.message) : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
      if (debounce) clearTimeout(debounce);
      changeSub?.dispose();
      ed?.dispose();
      model?.dispose();
      setEditor(null);
    };
    // Editor is created once per open; value/scope are captured at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container, codeKind, title]);

  // Escape closes (saving), matching the old dismiss behavior.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editor]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "80vw",
          maxWidth: 1100,
          height: "78vh",
          display: "flex",
          flexDirection: "column",
          background: "#1e1e1e",
          border: "1px solid #30363d",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid #30363d",
            color: "#e6edf3",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>{title}</span>
          <button
            onClick={finish}
            style={{
              cursor: "pointer",
              background: "#0e639c",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "4px 14px",
              fontSize: 12,
            }}
          >
            Done
          </button>
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div ref={setContainer} style={{ position: "absolute", inset: 0 }} />
          {error && (
            <pre
              style={{
                position: "absolute",
                inset: 0,
                margin: 0,
                padding: 12,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "#2d1416",
                color: "#ffb4b4",
                fontFamily:
                  "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                fontSize: 12,
                lineHeight: 1.5,
                zIndex: 1,
              }}
            >
              {`Code editor failed to initialize:\n\n${error}`}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
