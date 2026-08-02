/**
 * Workflow-level DAG configuration editor (P3.4). Edits a scope workflow's (or
 * a dagContainer node's) `dagConfig`:
 *   - max concurrency (SDK default 40 when blank),
 *   - default trigger rule (applied to tasks that omit their own),
 *   - child-context nesting (NESTED / FLAT),
 *   - early-completion policy: threshold fields OR a custom `shouldComplete`
 *     predicate — the two are mutually exclusive in the UI (P3.4).
 *
 * Rendered inline inside the Properties (NodeInspector) panel — for a
 * dagContainer node it edits that node's own `dagConfig`, and for the root DAG
 * scope it edits the workflow's `dagConfig`. All edits flow back through a
 * single `onChange(next)` (undefined clears the config), keeping the owning
 * workflow/node the single source of truth (no parallel state).
 */
import Box from "@cloudscape-design/components/box";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { CodeArea } from "./CodeField";
import { TRIGGER_RULE_LABELS } from "./constants";
import { TRIGGER_RULES } from "../studioTypes";
import type {
  DagCompletionConfigSpec,
  DagConfigSpec,
  DagNestingKind,
  TriggerRule,
} from "../studioTypes";

const NESTING_OPTIONS: { label: string; value: DagNestingKind }[] = [
  { label: "Nested (per-task child context, default)", value: "NESTED" },
  { label: "Flat (cheaper, no per-task context)", value: "FLAT" },
];

type CompletionMode = "none" | "threshold" | "custom";

function completionModeOf(c: DagCompletionConfigSpec | undefined): CompletionMode {
  if (!c) return "none";
  if ("shouldComplete" in c) return "custom";
  return "threshold";
}

const COMPLETION_OPTIONS: { label: string; value: CompletionMode }[] = [
  { label: "Default (drain — run every task)", value: "none" },
  { label: "Threshold (min successful / tolerated failures)", value: "threshold" },
  { label: "Custom predicate (shouldComplete)", value: "custom" },
];

/** Drop a config to `undefined` when it carries no meaningful fields, so saved
 *  files stay clean (an empty `dagConfig: {}` is noise). */
function normalize(cfg: DagConfigSpec): DagConfigSpec | undefined {
  const hasCompletion =
    cfg.completionConfig !== undefined &&
    Object.keys(cfg.completionConfig).length > 0;
  if (
    cfg.maxConcurrency === undefined &&
    cfg.defaultTriggerRule === undefined &&
    cfg.nesting === undefined &&
    !hasCompletion
  ) {
    return undefined;
  }
  return cfg;
}

/**
 * Inline DAG configuration form fields (no Modal wrapper). Reusable from the
 * Properties panel for both a dagContainer node and the root DAG scope.
 */
export function DagConfigFields({
  value,
  onChange,
}: {
  value?: DagConfigSpec;
  /** Replace the owning workflow/node dagConfig (undefined clears it). */
  onChange: (next: DagConfigSpec | undefined) => void;
}) {
  const cfg: DagConfigSpec = value ?? {};
  const patch = (p: Partial<DagConfigSpec>) =>
    onChange(normalize({ ...cfg, ...p }));

  const completion = cfg.completionConfig;
  const mode = completionModeOf(completion);
  const threshold =
    completion && !("shouldComplete" in completion) ? completion : {};
  const custom =
    completion && "shouldComplete" in completion ? completion : null;

  // Numeric-field helper: blank clears (undefined), otherwise clamps ≥ min.
  const numThreshold =
    (key: "minSuccessful" | "toleratedFailureCount" | "toleratedFailurePercentage", max?: number) =>
    ({ detail }: { detail: { value: string } }) => {
      const v = detail.value.trim();
      const n = Number(v);
      const val =
        v === "" || !Number.isFinite(n)
          ? undefined
          : max === undefined
            ? Math.max(0, n)
            : Math.min(max, Math.max(0, n));
      patch({ completionConfig: { ...threshold, [key]: val } });
    };

  const setMode = (next: CompletionMode) => {
    if (next === "none") patch({ completionConfig: undefined });
    else if (next === "custom")
      patch({ completionConfig: { shouldComplete: custom?.shouldComplete ?? "" } });
    else patch({ completionConfig: { ...threshold } });
  };

  return (
    <SpaceBetween size="m">
      <Box color="text-status-inactive" fontSize="body-s">
        Applies to this scope's <code>context.dag(...)</code>. Blank fields
        take the SDK defaults (max concurrency 40, nesting NESTED, default
        trigger rule ALL_SUCCESS).
      </Box>

      <FormField
        label="Max concurrency"
        description="Maximum tasks running at once (blank = SDK default of 40)."
      >
        <Input
          type="number"
          placeholder="40"
          value={
            cfg.maxConcurrency === undefined ? "" : String(cfg.maxConcurrency)
          }
          onChange={({ detail }) => {
            const v = detail.value.trim();
            const n = Number(v);
            patch({
              maxConcurrency:
                v === "" || !Number.isFinite(n) ? undefined : Math.max(1, n),
            });
          }}
        />
      </FormField>

      <FormField
        label="Default trigger rule"
        description="Applied to tasks that don't set their own trigger rule."
      >
        <Select
          selectedOption={{
            value: cfg.defaultTriggerRule ?? "ALL_SUCCESS",
            label: TRIGGER_RULE_LABELS[cfg.defaultTriggerRule ?? "ALL_SUCCESS"],
          }}
          options={TRIGGER_RULES.map((r) => ({
            value: r,
            label: TRIGGER_RULE_LABELS[r],
          }))}
          onChange={({ detail }) => {
            const v = detail.selectedOption.value as TriggerRule;
            patch({ defaultTriggerRule: v === "ALL_SUCCESS" ? undefined : v });
          }}
        />
      </FormField>

      <FormField
        label="Nesting"
        description="How child contexts are created for the DAG's tasks."
      >
        <Select
          selectedOption={
            NESTING_OPTIONS.find((o) => o.value === (cfg.nesting ?? "NESTED")) ??
            NESTING_OPTIONS[0]
          }
          options={NESTING_OPTIONS}
          onChange={({ detail }) => {
            const v = detail.selectedOption.value as DagNestingKind;
            patch({ nesting: v === "NESTED" ? undefined : v });
          }}
        />
      </FormField>

      <FormField
        label="Completion policy"
        description="When the DAG completes early. Threshold and custom predicate are mutually exclusive."
      >
        <Select
          selectedOption={
            COMPLETION_OPTIONS.find((o) => o.value === mode) ??
            COMPLETION_OPTIONS[0]
          }
          options={COMPLETION_OPTIONS}
          onChange={({ detail }) =>
            setMode(detail.selectedOption.value as CompletionMode)
          }
        />
      </FormField>

      {mode === "threshold" && (
        <SpaceBetween size="s">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <FormField label="Min successful" description="blank = all.">
                <Input
                  type="number"
                  placeholder="all"
                  value={
                    threshold.minSuccessful === undefined
                      ? ""
                      : String(threshold.minSuccessful)
                  }
                  onChange={numThreshold("minSuccessful")}
                />
              </FormField>
            </div>
            <div style={{ flex: 1 }}>
              <FormField label="Tolerated failures" description="blank = 0.">
                <Input
                  type="number"
                  placeholder="0"
                  value={
                    threshold.toleratedFailureCount === undefined
                      ? ""
                      : String(threshold.toleratedFailureCount)
                  }
                  onChange={numThreshold("toleratedFailureCount")}
                />
              </FormField>
            </div>
          </div>
          <FormField
            label="Tolerated failure %"
            description="percentage 0-100 (blank = unused)."
          >
            <Input
              type="number"
              placeholder="unused"
              value={
                threshold.toleratedFailurePercentage === undefined
                  ? ""
                  : String(threshold.toleratedFailurePercentage)
              }
              onChange={numThreshold("toleratedFailurePercentage", 100)}
            />
          </FormField>
        </SpaceBetween>
      )}

      {mode === "custom" && (
        <FormField
          label="shouldComplete predicate (TypeScript)"
          description="Body of (status) => …; return true to complete the DAG early. Emitted as { shouldComplete: (status) => <body> }."
        >
          <CodeArea
            value={custom?.shouldComplete ?? ""}
            rows={4}
            onChange={(shouldComplete) =>
              patch({ completionConfig: { shouldComplete } })
            }
          />
        </FormField>
      )}
    </SpaceBetween>
  );
}
