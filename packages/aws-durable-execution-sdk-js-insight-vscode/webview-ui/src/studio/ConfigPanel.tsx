/**
 * Workflow-level settings, shown as the Studio's "Config" view.
 *
 * These are properties of the WORKFLOW rather than of any node, so they have no
 * home on the canvas or in the node inspector. Previously the name sat in a
 * permanent header above the canvas — costing vertical space on every view for a
 * field that is set once — and the event/input type was tucked into the node
 * inspector, which is misleading since it isn't a node property at all.
 *
 * Read-only facts about the workflow are summarised at the bottom rather than
 * being editable here: they are either derived from the graph (fan-out mode,
 * counts) or recorded by a past deploy.
 */
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import type { DarWorkflow } from "../studioTypes";

/** One read-only label/value pair in the summary grid. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{value}</Box>
    </div>
  );
}

export function ConfigPanel({
  wf,
  filePath,
  height,
  onRename,
  onSetComment,
  onSetInputType,
}: {
  wf: DarWorkflow;
  /** The real `.dar.ts` file backing this workflow, if it has been saved. */
  filePath?: string | null;
  /**
   * Height budget, matching what the Code and Diff views get. Those views bound
   * themselves and scroll internally; without the same treatment this panel just
   * overflowed, since the surrounding page is not itself a scroll container.
   */
  height?: number;
  onRename: (name: string) => void;
  onSetComment: (comment: string) => void;
  /** Absent when editing a nested scope, where the input type isn't editable. */
  onSetInputType?: (inputType: string) => void;
}) {
  const operationCount = wf.nodes.filter(
    (n) => n.kind !== "start" && n.kind !== "end",
  ).length;
  const deploy = wf.deploy;

  return (
    <div
      style={{
        maxHeight: height ?? undefined,
        overflowY: "auto",
        // Room for the focus ring on the last field, which `overflow` would
        // otherwise clip.
        padding: "2px",
      }}
    >
      <SpaceBetween size="l">
      <Container header={<Header variant="h3">Identity</Header>}>
        <SpaceBetween size="m">
          <FormField
            label="Workflow name"
            description="Default Lambda function name / construct id when deployed with CDK. Separate from the .dar.ts file name."
          >
            <Input
              value={wf.name}
              onChange={({ detail }) => onRename(detail.value)}
            />
          </FormField>
          <FormField
            label="Description"
            description="Optional. Kept in the file and emitted as a comment above the generated handler."
          >
            <Textarea
              value={wf.comment ?? ""}
              placeholder="What this workflow does…"
              rows={2}
              onChange={({ detail }) => onSetComment(detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Container>

      {onSetInputType && (
        <Container header={<Header variant="h3">Input</Header>}>
          <FormField
            label="Event / input type (TypeScript)"
            description="Types the workflow's `event`/`input` payload. Flows into every node's code editor and the generated handler. Blank = any."
          >
            <Input
              value={wf.inputType ?? ""}
              placeholder="{ orderId: string }"
              onChange={({ detail }) => onSetInputType(detail.value)}
            />
          </FormField>
        </Container>
      )}

      <Container
        header={
          <Header
            variant="h3"
            description="Derived from the graph or recorded by a past deploy — not editable here."
          >
            Summary
          </Header>
        }
      >
        <ColumnLayout columns={3} variant="text-grid">
          <Fact
            label="Fan-out mode"
            value={wf.dependencyMode === "dag" ? "DAG" : "Linear"}
          />
          <Fact label="Operations" value={String(operationCount)} />
          <Fact label="Connections" value={String(wf.edges.length)} />
          <Fact label="Format version" value={wf.darVersion} />
          <Fact label="File" value={filePath ?? "Not saved yet"} />
          <Fact
            label="Last deployed"
            value={
              deploy
                ? `${deploy.functionName} (${deploy.region})${
                    deploy.deployedAt
                      ? ` · ${new Date(deploy.deployedAt).toLocaleString()}`
                      : ""
                  }`
                : "Never"
            }
          />
        </ColumnLayout>
        <Box
          variant="small"
          color="text-status-inactive"
          padding={{ top: "s" }}
        >
          Execution timeout is calculated at deploy time from this workflow’s
          waits, so it is not set here.
        </Box>
      </Container>
    </SpaceBetween>
    </div>
  );
}
