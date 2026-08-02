import { CodeView } from "@cloudscape-design/code-view";
import { DateView } from "./DateView";
import jsonHighlight from "@cloudscape-design/code-view/highlight/json";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import Header from "@cloudscape-design/components/header";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Textarea from "@cloudscape-design/components/textarea";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, {
  type StatusIndicatorProps,
} from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { type ReactNode, useEffect, useState } from "react";
import { ExecutionGraph } from "./ExecutionGraph";
import { nextExecutionName } from "./nextExecutionName";
import type { DarWorkflow } from "./studioTypes";
import type { ExecutionDetail, HistoryEvent, OperationNode } from "./types";
import { postMessage } from "./vscode";

/** Depth-first flatten of the operations forest (for expand-all + lookups). */
function flattenOps(nodes: OperationNode[]): OperationNode[] {
  const out: OperationNode[] = [];
  const walk = (n: OperationNode) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

const HISTORY_COLS = [
  "eventId",
  "type",
  "subType",
  "name",
  "id",
  "parentId",
  "timestamp",
] as const;

function historyToCsv(events: HistoryEvent[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = events.map((e) =>
    [e.eventId, e.type, e.subType, e.name, e.id, e.parentId, e.timestamp]
      .map(esc)
      .join(","),
  );
  return [HISTORY_COLS.join(","), ...rows].join("\n");
}

interface ExecutionDetailPageProps {
  detail: ExecutionDetail | null;
  workflow: DarWorkflow | null;
  error?: string;
  loading: boolean;
  onRefresh: () => void;
  onStop: (arn: string) => void;
  /** Start a new execution of this function (functionName, payload, name?). */
  onStartExecution?: (
    functionName: string,
    payload: string,
    executionName?: string,
  ) => void;
  starting?: boolean;
  startError?: string;
  /** Edit this execution's function in Workflow Studio (only when it embeds a
   *  `.dar` — i.e. was deployed from Studio or the CDK construct). */
  onEditWorkflow?: (functionRef: string) => void;
}

const TERMINAL_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "STOPPED",
  "CANCELLED",
];
const isTerminal = (status?: string) =>
  !!status && TERMINAL_STATUSES.includes(status);

const STATUS_TYPE: Record<string, StatusIndicatorProps.Type> = {
  SUCCEEDED: "success",
  FAILED: "error",
  TIMED_OUT: "error",
  STOPPED: "stopped",
  RUNNING: "in-progress",
  PENDING: "pending",
};

function fmtDuration(ms?: number): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function pretty(json?: string): string | null {
  if (json === undefined || json === "") return null;
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{value ?? "—"}</div>
    </div>
  );
}

function JsonView({ value }: { value: string | null }) {
  if (value === null) return null;
  return (
    <div style={{ maxHeight: 500, overflow: "auto" }}>
      <CodeView
        content={value}
        highlight={jsonHighlight}
        lineNumbers
        wrapLines
        actions={
          <CopyToClipboard
            variant="icon"
            copyButtonText="Copy"
            copyErrorText="Failed to copy"
            copySuccessText="Copied"
            textToCopy={value}
          />
        }
      />
    </div>
  );
}

function CodePanel({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <Container header={<Header variant="h3">{label}</Header>}>
      <JsonView value={value} />
    </Container>
  );
}

export function ExecutionDetailPage({
  detail,
  workflow,
  error,
  loading,
  onRefresh,
  onStop,
  onStartExecution,
  starting,
  startError,
  onEditWorkflow,
}: ExecutionDetailPageProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [startPayload, setStartPayload] = useState("{}");
  const [startName, setStartName] = useState("");
  // Close the start modal once a new execution loads (start succeeded and the
  // view navigated to it).
  useEffect(() => {
    setStartOpen(false);
  }, [detail?.arn]);
  // Function reference to invoke: the execution's function ARN without its
  // version/alias qualifier (host defaults the qualifier to $LATEST).
  const functionRef = (() => {
    const arn = detail?.functionArn ?? "";
    const parts = arn.split(":");
    return parts.length >= 8 ? parts.slice(0, 7).join(":") : arn;
  })();
  const openStart = () => {
    setStartPayload(pretty(detail?.input) ?? detail?.input ?? "{}");
    setStartName(nextExecutionName(detail?.name));
    setStartOpen(true);
  };
  const exportHistory = (format: "csv" | "json") => {
    const events = detail?.history ?? [];
    postMessage({
      type: "exportData",
      format,
      content:
        format === "csv"
          ? historyToCsv(events)
          : JSON.stringify(events, null, 2),
      filename: `execution-history.${format}`,
    });
  };

  const operations = detail?.operations ?? [];
  const allOps = flattenOps(operations);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Expand the whole tree whenever a new execution's operations arrive.
  useEffect(() => {
    setExpandedIds(new Set(allOps.map((o) => o.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.arn, allOps.length]);
  const expandedItems = allOps.filter((o) => expandedIds.has(o.id));
  const [selectedOp, setSelectedOp] = useState<OperationNode | null>(null);

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            {detail && !isTerminal(detail.status) && (
              <>
                <StatusIndicator type="loading">Live</StatusIndicator>
                <Button iconName="close" onClick={() => onStop(detail.arn)}>
                  Stop
                </Button>
              </>
            )}
            {detail?.functionArn && onEditWorkflow && (
              <Button
                iconName="edit"
                onClick={() => onEditWorkflow(functionRef)}
              >
                Edit in Workflow Studio
              </Button>
            )}
            {detail && onStartExecution && (
              <Button iconName="add-plus" onClick={openStart}>
                Start new execution
              </Button>
            )}
            <Button iconName="refresh" loading={loading} onClick={onRefresh}>
              Refresh
            </Button>
          </SpaceBetween>
        }
      >
        Execution detail
      </Header>

      {error && (
        <Alert type="error" header="Couldn't load execution">
          {error}
        </Alert>
      )}

      {detail && (
        <Tabs
          tabs={[
            {
              id: "summary",
              label: "Summary",
              content: (
                <SpaceBetween size="l">
                  <Container>
                    <ColumnLayout columns={3} variant="text-grid">
                      <Field
                        label="Status"
                        value={
                          <StatusIndicator
                            type={STATUS_TYPE[detail.status] ?? "info"}
                          >
                            {detail.status || "—"}
                          </StatusIndicator>
                        }
                      />
                      <Field label="Name" value={detail.name} />
                      <Field label="Version" value={detail.version} />
                      <Field
                        label="Started"
                        value={<DateView date={detail.startTime} />}
                      />
                      <Field label="Ended" value={<DateView date={detail.endTime} />} />
                      <Field
                        label="Duration"
                        value={fmtDuration(detail.durationMs)}
                      />
                      <Field label="Function" value={detail.functionArn} />
                      <Field label="Execution ARN" value={detail.arn} />
                    </ColumnLayout>
                  </Container>
                </SpaceBetween>
              ),
            },
            {
              id: "input",
              label: "Input",
              content: pretty(detail.input) ? (
                <JsonView value={pretty(detail.input)} />
              ) : (
                <Box textAlign="center" color="text-status-inactive">
                  No input recorded.
                </Box>
              ),
            },
            {
              id: "output",
              label: "Output",
              content:
                pretty(detail.result) || pretty(detail.error) ? (
                  <SpaceBetween size="l">
                    {pretty(detail.result) && (
                      <JsonView value={pretty(detail.result)} />
                    )}
                    {pretty(detail.error) && (
                      <CodePanel label="Error" value={pretty(detail.error)} />
                    )}
                  </SpaceBetween>
                ) : (
                  <Box textAlign="center" color="text-status-inactive">
                    No output yet.
                  </Box>
                ),
            },
          ]}
        />
      )}

      {detail && (
        <Tabs
          tabs={[
            ...(workflow
              ? [
                  {
                    id: "graph",
                    label: "Graph",
                    content: (
                      <ExecutionGraph
                        workflow={workflow}
                        operations={operations}
                      />
                    ),
                  },
                ]
              : []),
            {
              id: "operations",
              label: "Operations",
              content:
                operations.length > 0 ? (
                  <Table
          header={<Header counter={`(${allOps.length})`}>Operations</Header>}
          items={operations}
          trackBy="id"
          variant="container"
          expandableRows={{
            getItemChildren: (item: OperationNode) => item.children ?? [],
            isItemExpandable: (item: OperationNode) =>
              !!item.children?.length,
            expandedItems,
            onExpandableItemToggle: ({ detail: d }) =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (d.expanded) next.add(d.item.id);
                else next.delete(d.item.id);
                return next;
              }),
          }}
          columnDefinitions={[
            {
              id: "name",
              header: "Operation",
              cell: (o: OperationNode) => (
                <Button variant="inline-link" onClick={() => setSelectedOp(o)}>
                  {o.name || o.id.slice(0, 8)}
                </Button>
              ),
            },
            {
              id: "kind",
              header: "Kind",
              cell: (o: OperationNode) => o.kind ?? "—",
            },
            {
              id: "status",
              header: "Status",
              cell: (o: OperationNode) => (
                <StatusIndicator type={STATUS_TYPE[o.status] ?? "info"}>
                  {o.status || "—"}
                </StatusIndicator>
              ),
            },
            {
              id: "started",
              header: "Started",
              cell: (o: OperationNode) => <DateView date={o.startTime} />,
            },
            {
              id: "duration",
              header: "Duration",
              cell: (o: OperationNode) => fmtDuration(o.durationMs),
            },
            {
              id: "detail",
              header: "Detail",
              width: 90,
              cell: (o: OperationNode) => (
                <Button
                  variant="inline-icon"
                  iconName="status-info"
                  ariaLabel={`View details for ${o.name ?? o.id}`}
                  onClick={() => setSelectedOp(o)}
                />
              ),
            },
          ]}
                  />
                ) : (
                  <Box textAlign="center" color="text-status-inactive">
                    No operations recorded.
                  </Box>
                ),
            },
            {
              id: "history",
              label: "History",
              content: (
        <Table
          header={
            <Header
              counter={`(${detail.history?.length ?? 0})`}
              actions={
                <ButtonDropdown
                  disabled={!detail.history?.length}
                  items={[
                    { id: "csv", text: "CSV" },
                    { id: "json", text: "JSON" },
                  ]}
                  onItemClick={(e) =>
                    exportHistory(e.detail.id as "csv" | "json")
                  }
                >
                  Export
                </ButtonDropdown>
              }
            >
              History
            </Header>
          }
          items={detail.history ?? []}
          trackBy="eventId"
          variant="container"
          empty={
            <Box textAlign="center" color="inherit">
              No history events.
            </Box>
          }
          columnDefinitions={[
            {
              id: "eventId",
              header: "#",
              width: 70,
              cell: (h: HistoryEvent) => h.eventId ?? "—",
            },
            {
              id: "type",
              header: "Type",
              cell: (h: HistoryEvent) => h.type ?? "—",
            },
            {
              id: "subType",
              header: "Subtype",
              cell: (h: HistoryEvent) => h.subType || "—",
            },
            {
              id: "name",
              header: "Operation",
              cell: (h: HistoryEvent) => h.name || "—",
            },
            {
              id: "time",
              header: "Time",
              cell: (h: HistoryEvent) => <DateView date={h.timestamp} />,
            },
          ]}
        />
              ),
            },
          ]}
        />
      )}

      <Modal
        visible={selectedOp !== null}
        onDismiss={() => setSelectedOp(null)}
        header={selectedOp?.name || selectedOp?.id || "Operation"}
        size="large"
        footer={
          <Box float="right">
            <Button variant="primary" onClick={() => setSelectedOp(null)}>
              Close
            </Button>
          </Box>
        }
      >
        {selectedOp && (
          <SpaceBetween size="l">
            <ColumnLayout columns={3} variant="text-grid">
              <Field label="Kind" value={selectedOp.kind ?? "—"} />
              <Field
                label="Status"
                value={
                  <StatusIndicator
                    type={STATUS_TYPE[selectedOp.status] ?? "info"}
                  >
                    {selectedOp.status || "—"}
                  </StatusIndicator>
                }
              />
              <Field
                label="Duration"
                value={fmtDuration(selectedOp.durationMs)}
              />
              <Field label="Started" value={<DateView date={selectedOp.startTime} />} />
              <Field label="Ended" value={<DateView date={selectedOp.endTime} />} />
              <Field label="Operation ID" value={selectedOp.id} />
              {selectedOp.parentId && (
                <Field label="Parent ID" value={selectedOp.parentId} />
              )}
            </ColumnLayout>
            <CodePanel label="Result" value={pretty(selectedOp.result)} />
            <CodePanel label="Error" value={pretty(selectedOp.error)} />
          </SpaceBetween>
        )}
      </Modal>

      <Modal
        visible={startOpen}
        onDismiss={() => setStartOpen(false)}
        header="Start new execution"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setStartOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={starting}
                onClick={() =>
                  onStartExecution?.(functionRef, startPayload, startName)
                }
              >
                Start (async)
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>
            Invokes the same function asynchronously, pre-filled with this
            execution's input.
          </Box>
          {startError && <Alert type="error">{startError}</Alert>}
          <FormField
            label="Execution name (optional)"
            description="A unique name for idempotency; reusing a name won't start a duplicate execution."
          >
            <Input
              value={startName}
              onChange={({ detail: d }) => setStartName(d.value)}
              placeholder="e.g. order-12345"
            />
          </FormField>
          <FormField label="Input payload (JSON)">
            <Textarea
              value={startPayload}
              onChange={({ detail: d }) => setStartPayload(d.value)}
              rows={8}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
