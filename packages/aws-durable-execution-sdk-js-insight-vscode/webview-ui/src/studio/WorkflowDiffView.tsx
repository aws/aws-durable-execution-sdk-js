/**
 * Read-only diff view for the Workflow Studio: the last committed workflow
 * (loaded / saved / deployed) vs the current one, both rendered as `.dar.ts`
 * text, in Monaco's side-by-side diff editor.
 */
import { useEffect, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import Button from "@cloudscape-design/components/button";
import {
  configureMonaco,
  initMonacoWorkers,
  setLayoutSectionHidden,
} from "./monacoSetup";

let diffSeq = 0;

export function WorkflowDiffView({
  original,
  modified,
  height,
}: {
  /** The committed baseline as `.dar.ts` text. */
  original: string;
  /** The current workflow as `.dar.ts` text. */
  modified: string;
  height: number;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layoutHidden, setLayoutHidden] = useState(false);
  const diffRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);

  const applyLayoutHidden = (hidden: boolean) => {
    const d = diffRef.current;
    if (!d) return;
    const o = d.getOriginalEditor();
    const m = d.getModifiedEditor();
    const om = o.getModel();
    const mm = m.getModel();
    if (om) setLayoutSectionHidden(o, om, hidden);
    if (mm) setLayoutSectionHidden(m, mm, hidden);
  };
  useEffect(() => {
    applyLayoutHidden(layoutHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutHidden]);

  useEffect(() => {
    if (!container) return;
    let cancelled = false;
    let ed: MonacoEditor.IStandaloneDiffEditor | null = null;
    let a: MonacoEditor.ITextModel | null = null;
    let b: MonacoEditor.ITextModel | null = null;

    void (async () => {
      try {
        const monaco = configureMonaco();
        await initMonacoWorkers();
        if (cancelled || !container) return;
        const n = diffSeq++;
        a = monaco.editor.createModel(
          original,
          "typescript",
          monaco.Uri.parse(`file:///wf-diff-${n}-base.dar.ts`),
        );
        b = monaco.editor.createModel(
          modified,
          "typescript",
          monaco.Uri.parse(`file:///wf-diff-${n}-current.dar.ts`),
        );
        ed = monaco.editor.createDiffEditor(container, {
          theme: "vs-dark",
          automaticLayout: true,
          readOnly: true,
          originalEditable: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          renderSideBySide: true,
        });
        ed.setModel({ original: a, modified: b });
        diffRef.current = ed;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      diffRef.current = null;
      ed?.dispose();
      a?.dispose();
      b?.dispose();
    };
  }, [container, original, modified]);

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
        <Button
          variant="icon"
          iconName={layoutHidden ? "treeview-expand" : "treeview-collapse"}
          ariaLabel={
            layoutHidden ? "Show the layout section" : "Hide the layout section"
          }
          onClick={() => setLayoutHidden((v) => !v)}
        />
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#8b949e" }}>
          Last committed on the left — current on the right.
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
