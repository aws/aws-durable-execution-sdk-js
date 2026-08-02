/**
 * TypeScript code-editing widgets for the Workflow Studio inspector:
 *   - CodeArea:  an inline monospace textarea (JSON/small snippets).
 *   - CodeField: a read-only preview plus an "Edit in VS Code" button.
 */
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import SpaceBetween from "@cloudscape-design/components/space-between";

const MONO =
  "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** A monospace code editor for TypeScript blocks (native textarea, themed). */
export function CodeArea({
  value,
  onChange,
  rows = 8,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        boxSizing: "border-box",
        fontFamily: MONO,
        fontSize: 12,
        lineHeight: 1.5,
        color: "#e6edf3",
        background: "#0d1117",
        border: "1px solid #30363d",
        borderRadius: 6,
        padding: 8,
        resize: "vertical",
      }}
    />
  );
}

/** A code-block field: a read-only preview plus an "Edit in VS Code" button. */
export function CodeField({
  label,
  description,
  value,
  onEdit,
  onAgent,
}: {
  label: string;
  description?: string;
  value: string;
  onEdit: () => void;
  onAgent?: () => void;
}) {
  return (
    <FormField label={label} description={description}>
      <SpaceBetween size="xs">
        <pre
          style={{
            margin: 0,
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: 1.5,
            color: "#e6edf3",
            background: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: 6,
            padding: 8,
          }}
        >
          {value.trim() ? value : "// empty — click “Edit code”"}
        </pre>
        <SpaceBetween direction="horizontal" size="xs">
          <Button iconName="edit" onClick={onEdit}>
            Edit code
          </Button>
          {onAgent && (
            <Button iconName="gen-ai" onClick={onAgent}>
              Agent
            </Button>
          )}
        </SpaceBetween>
      </SpaceBetween>
    </FormField>
  );
}
