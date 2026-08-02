/**
 * The start-input editor for an `awsJob` node. Renders the integration's
 * structured parameter fields (from the preset's `startParams`) with a "Edit as
 * JSON" escape hatch — mirroring the Step Functions builder's ParametersWithJson
 * toggle. The canonical value stays the serialized `startInput` string, so the
 * code generator is unaffected. Unknown keys in the JSON are preserved.
 *
 * Phase 1: `resource`-typed fields render as a text box (enter name/ARN). A
 * later phase can swap these for live account-populated pickers.
 */
import { useRef, useState } from "react";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import Box from "@cloudscape-design/components/box";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Toggle from "@cloudscape-design/components/toggle";
import type {
  JobParamField,
  ServiceIntegration,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { CodeArea } from "./CodeField";

/** Parses text into a plain JSON object, or null if it isn't one. */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function serialize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2);
}

function labelOf(field: JobParamField): string {
  return field.required ? `${field.label} *` : field.label;
}

/** Async lookup of account resources for a picker (always resolves). */
type ListResources = (resource: string) => Promise<{
  items: { label: string; value: string }[];
  error?: string;
}>;

/**
 * A `resource`-typed field: an Autosuggest that offers account resources but
 * always allows free text, so a user without list permission (or a cross-account
 * resource) can still type a name/ARN. Resources are fetched lazily on focus.
 */
function ResourceField({
  field,
  value,
  onChange,
  onList,
}: {
  field: JobParamField;
  value: unknown;
  onChange: (v: unknown) => void;
  onList: ListResources;
}) {
  const [options, setOptions] = useState<{ value: string; label?: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const loaded = useRef(false);

  const load = () => {
    if (loaded.current || !field.resource) return;
    loaded.current = true;
    setLoading(true);
    void onList(field.resource).then((r) => {
      setLoading(false);
      if (r.error) setError(r.error);
      else
        setOptions(r.items.map((i) => ({ value: i.value, label: i.label })));
    });
  };

  return (
    <FormField
      label={labelOf(field)}
      description={field.description}
      errorText={
        error
          ? `Couldn't list resources (${error}). Enter a name or ARN manually.`
          : undefined
      }
    >
      <Autosuggest
        value={typeof value === "string" ? value : ""}
        onChange={({ detail }) => onChange(detail.value || undefined)}
        onFocus={load}
        options={options}
        statusType={loading ? "loading" : "finished"}
        loadingText="Loading resources…"
        placeholder={field.placeholder ?? "name or ARN"}
        empty="No resources found — type a name or ARN"
        enteredTextLabel={(v) => `Use "${v}"`}
        filteringType="auto"
      />
    </FormField>
  );
}

/**
 * A JSON-valued parameter. Keeps a local text buffer so intermediate invalid
 * states while typing don't clobber the value; only valid JSON is propagated.
 */
function JsonParamField({
  field,
  value,
  onChange,
}: {
  field: JobParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <FormField
      label={labelOf(field)}
      description={field.description}
      errorText={error ?? undefined}
    >
      <CodeArea
        value={text}
        rows={4}
        onChange={(v) => {
          setText(v);
          if (v.trim() === "") {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(v);
            setError(null);
            onChange(parsed);
          } catch {
            setError("Invalid JSON");
          }
        }}
      />
    </FormField>
  );
}

/** One structured field editor for a JSON-object start-input parameter. */
function ParamField({
  field,
  value,
  onChange,
  onList,
}: {
  field: JobParamField;
  value: unknown;
  onChange: (v: unknown) => void;
  onList?: ListResources;
}) {
  if (field.type === "json") {
    return <JsonParamField field={field} value={value} onChange={onChange} />;
  }
  if (field.type === "resource" && onList) {
    return (
      <ResourceField
        field={field}
        value={value}
        onChange={onChange}
        onList={onList}
      />
    );
  }
  if (field.type === "text") {
    return (
      <FormField label={labelOf(field)} description={field.description}>
        <CodeArea
          value={typeof value === "string" ? value : ""}
          rows={4}
          onChange={(v) => onChange(v || undefined)}
        />
      </FormField>
    );
  }
  if (field.type === "number") {
    return (
      <FormField label={labelOf(field)} description={field.description}>
        <Input
          type="number"
          placeholder={field.placeholder}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={({ detail }) => {
            const t = detail.value.trim();
            const n = Number(t);
            onChange(t === "" || !Number.isFinite(n) ? undefined : n);
          }}
        />
      </FormField>
    );
  }
  // string | resource — resource is a plain text box in Phase 1.
  const description =
    field.type === "resource"
      ? `${field.description ? `${field.description} ` : ""}Enter the name or ARN.`
      : field.description;
  return (
    <FormField label={labelOf(field)} description={description}>
      <Input
        placeholder={field.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={({ detail }) => onChange(detail.value || undefined)}
      />
    </FormField>
  );
}

export function AwsJobParams({
  preset,
  startInput,
  onChange,
  onListResources,
}: {
  preset?: ServiceIntegration;
  startInput: string;
  onChange: (startInput: string) => void;
  onListResources?: ListResources;
}) {
  const parsed = parseObject(startInput);
  const hasSchema = !!preset?.startParams?.length;
  const canStructure = hasSchema && parsed !== null;
  const [jsonMode, setJsonMode] = useState(!canStructure);
  const effectiveJsonMode = jsonMode || !canStructure;

  const setKey = (name: string, value: unknown) => {
    const next: Record<string, unknown> = { ...(parsed ?? {}) };
    if (value === undefined || value === "") delete next[name];
    else next[name] = value;
    onChange(serialize(next));
  };

  return (
    <FormField label="Start input" description="Input for the start API call.">
      <SpaceBetween size="s">
        {hasSchema && (
          <Toggle
            checked={effectiveJsonMode}
            disabled={!canStructure}
            onChange={({ detail }) => setJsonMode(detail.checked)}
          >
            Edit as JSON
          </Toggle>
        )}
        {effectiveJsonMode ? (
          <CodeArea value={startInput} rows={6} onChange={onChange} />
        ) : (
          <SpaceBetween size="s">
            {(preset?.startParams ?? []).map((f) => (
              <ParamField
                key={f.name}
                field={f}
                value={parsed?.[f.name]}
                onChange={(v) => setKey(f.name, v)}
                onList={onListResources}
              />
            ))}
          </SpaceBetween>
        )}
        {hasSchema && parsed === null && (
          <Box variant="small" color="text-status-inactive">
            Structured editing needs valid JSON — editing raw for now.
          </Box>
        )}
      </SpaceBetween>
    </FormField>
  );
}
