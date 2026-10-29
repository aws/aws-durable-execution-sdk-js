import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import { useEffect, useMemo, useState } from "react";
import {
  flattenOperations,
  formatDuration,
  historyToCsv,
  isTerminal,
  prettyJson,
} from "./executionFormat";
import {
  Copyable,
  Empty,
  Field,
  JsonView,
  Status,
  Timestamp,
} from "./ExecutionParts";
import type {
  ExecutionDetail,
  HistoryEvent,
  InvocationRow,
  OperationNode,
} from "./types";

interface Props {
  arn: string;
  detail: ExecutionDetail | null;
  error?: string;
  loading: boolean;
  stopping: boolean;
  stopError?: string;
  onRefresh: () => void;
  onStop: () => void;
  onStartNew: () => void;
  onOpenExecution: (arn: string) => void;
  onExportHistory: (format: "csv" | "json", content: string) => void;
}

/** One durable execution: summary, payloads, operation tree, and history. */
export function ExecutionDetailPage({
  arn,
  detail,
  error,
  loading,
  stopping,
  stopError,
  onRefresh,
  onStop,
  onStartNew,
  onOpenExecution,
  onExportHistory,
}: Props) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [selectedOp, setSelectedOp] = useState<OperationNode | null>(null);
  const operations = detail?.operations ?? [];
  const allOps = useMemo(() => flattenOperations(operations), [operations]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Expand the whole tree when a new execution is opened; keep the user's
  // choices across the refresh polls of the same one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ARN on purpose.
  useEffect(() => {
    setExpanded(new Set(allOps.map((o) => o.id)));
  }, [arn, allOps.length]);

  // A stop that completed closes the confirmation.
  useEffect(() => {
    if (!stopping) setConfirmStop(false);
  }, [stopping]);

  // An empty status is not "running"; polling also skips it.
  const live = detail && !!detail.status && !isTerminal(detail.status);
  const title = detail?.name || arn.split("/").pop() || "Execution";

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs" alignItems="center">
            {live && <StatusIndicator type="loading">Live</StatusIndicator>}
            {live && <Button onClick={() => setConfirmStop(true)}>Stop</Button>}
            {detail?.functionArn && (
              <Button iconName="add-plus" onClick={onStartNew}>
                Start new execution
              </Button>
            )}
            <Button
              iconName="refresh"
              ariaLabel="Refresh execution"
              loading={loading}
              onClick={onRefresh}
            />
          </SpaceBetween>
        }
      >
        {title}
      </Header>

      {error && (
        <Alert type="error" header="Couldn't load execution">
          {error}
        </Alert>
      )}
      {stopError && (
        <Alert type="error" header="Couldn't stop execution">
          {stopError}
        </Alert>
      )}
      {!detail && !error && (
        <Box textAlign="center" padding="xl">
          <Spinner size="large" />
        </Box>
      )}

      {detail && (
        <>
          <Container>
            <ColumnLayout columns={3} variant="text-grid">
              <Field label="Status" value={<Status status={detail.status} />} />
              <Field
                label="Started"
                value={<Timestamp iso={detail.startTime} />}
              />
              <Field label="Ended" value={<Timestamp iso={detail.endTime} />} />
              <Field
                label="Duration"
                value={formatDuration(detail.durationMs)}
              />
              <Field
                label="Invocations"
                value={String(detail.invocations.length)}
              />
              <Field label="Version" value={detail.version} />
              <Field
                label="Function"
                value={<Copyable value={detail.functionArn} />}
              />
              <Field
                label="Execution ARN"
                value={<Copyable value={detail.arn} />}
              />
            </ColumnLayout>
          </Container>

          {detail.historyError && (
            <Alert
              type="warning"
              header={
                detail.history.length > 0
                  ? "History incomplete"
                  : "History unavailable"
              }
            >
              {detail.history.length > 0
                ? `Reading the history failed after ${detail.history.length.toLocaleString()} events, so later operations are missing and some shown here may look unfinished: `
                : "The summary above loaded, but the history call failed, so operations are not shown: "}
              {detail.historyError}
            </Alert>
          )}
          {detail.historyTruncated && (
            <Alert type="info">
              This execution has more history than the viewer loads (
              {detail.history.length.toLocaleString()} events shown). Operations
              started after that point are missing, and some shown here may look
              unfinished because their later events were not loaded.
            </Alert>
          )}

          <Tabs
            tabs={[
              {
                id: "operations",
                label: `Operations (${allOps.length})`,
                content:
                  operations.length > 0 ? (
                    <OperationsTable
                      operations={operations}
                      allOps={allOps}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      onSelect={setSelectedOp}
                    />
                  ) : (
                    <Empty>No operations recorded.</Empty>
                  ),
              },
              {
                id: "input",
                label: "Input",
                content: prettyJson(detail.input) ? (
                  <JsonView value={prettyJson(detail.input)} />
                ) : (
                  <Empty>No input recorded.</Empty>
                ),
              },
              {
                id: "output",
                label: detail.error ? "Error" : "Output",
                content:
                  prettyJson(detail.result) || prettyJson(detail.error) ? (
                    <SpaceBetween size="l">
                      <JsonView value={prettyJson(detail.result)} />
                      <JsonView value={prettyJson(detail.error)} />
                    </SpaceBetween>
                  ) : (
                    <Empty>No output yet.</Empty>
                  ),
              },
              {
                id: "invocations",
                label: `Invocations (${detail.invocations.length})`,
                content: <InvocationsTable invocations={detail.invocations} />,
              },
              {
                id: "history",
                label: `History (${detail.history.length})`,
                content: (
                  <HistoryTable
                    events={detail.history}
                    onExport={(format) =>
                      onExportHistory(
                        format,
                        format === "csv"
                          ? historyToCsv(detail.history)
                          : JSON.stringify(detail.history, null, 2),
                      )
                    }
                  />
                ),
              },
            ]}
          />
        </>
      )}

      <OperationModal
        op={selectedOp}
        onDismiss={() => setSelectedOp(null)}
        onOpenExecution={(target) => {
          setSelectedOp(null);
          onOpenExecution(target);
        }}
      />

      <Modal
        visible={confirmStop}
        onDismiss={() => setConfirmStop(false)}
        header="Stop this execution?"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmStop(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={stopping} onClick={onStop}>
                Stop execution
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        Lambda ends the execution with status STOPPED. Operations still running
        do not complete, and the execution cannot be resumed.
      </Modal>
    </SpaceBetween>
  );
}

function OperationsTable({
  operations,
  allOps,
  expanded,
  setExpanded,
  onSelect,
}: {
  operations: OperationNode[];
  allOps: OperationNode[];
  expanded: Set<string>;
  setExpanded: (fn: (prev: Set<string>) => Set<string>) => void;
  onSelect: (op: OperationNode) => void;
}) {
  return (
    <Table
      items={operations}
      trackBy="id"
      variant="borderless"
      wrapLines
      expandableRows={{
        getItemChildren: (o) => o.children ?? [],
        isItemExpandable: (o) => !!o.children?.length,
        expandedItems: allOps.filter((o) => expanded.has(o.id)),
        onExpandableItemToggle: ({ detail }) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (detail.expanded) next.add(detail.item.id);
            else next.delete(detail.item.id);
            return next;
          }),
      }}
      columnDefinitions={[
        {
          id: "name",
          header: "Operation",
          cell: (o) => (
            <Button variant="inline-link" onClick={() => onSelect(o)}>
              {o.name || o.id.slice(0, 12)}
            </Button>
          ),
        },
        { id: "kind", header: "Kind", cell: (o) => o.kind ?? "—" },
        {
          id: "status",
          header: "Status",
          cell: (o) => <Status status={o.status} />,
        },
        {
          id: "started",
          header: "Started",
          cell: (o) => <Timestamp iso={o.startTime} />,
        },
        {
          id: "duration",
          header: "Duration",
          cell: (o) => formatDuration(o.durationMs),
        },
        {
          id: "attempt",
          header: "Attempt",
          cell: (o) => (o.attempt !== undefined ? String(o.attempt) : "—"),
        },
      ]}
    />
  );
}

function OperationModal({
  op,
  onDismiss,
  onOpenExecution,
}: {
  op: OperationNode | null;
  onDismiss: () => void;
  onOpenExecution: (arn: string) => void;
}) {
  return (
    <Modal
      visible={op !== null}
      onDismiss={onDismiss}
      header={op?.name || op?.id || "Operation"}
      size="large"
    >
      {op && (
        <SpaceBetween size="l">
          <ColumnLayout columns={3} variant="text-grid">
            <Field label="Kind" value={op.kind} />
            <Field label="Status" value={<Status status={op.status} />} />
            <Field label="Duration" value={formatDuration(op.durationMs)} />
            <Field label="Started" value={<Timestamp iso={op.startTime} />} />
            <Field label="Ended" value={<Timestamp iso={op.endTime} />} />
            <Field
              label="Attempt"
              value={op.attempt !== undefined ? String(op.attempt) : undefined}
            />
            <Field label="Operation ID" value={<Copyable value={op.id} />} />
            {op.parentId && <Field label="Parent ID" value={op.parentId} />}
            {op.nextAttemptTime && (
              <Field
                label="Next attempt"
                value={<Timestamp iso={op.nextAttemptTime} />}
              />
            )}
            {op.scheduledEndTime && (
              <Field
                label="Wait ends"
                value={<Timestamp iso={op.scheduledEndTime} />}
              />
            )}
            {op.callbackId && (
              <Field
                label="Callback ID"
                value={<Copyable value={op.callbackId} />}
              />
            )}
            {op.invokedFunction && (
              <Field label="Invoked function" value={op.invokedFunction} />
            )}
            {op.invokedExecutionArn && (
              <Field
                label="Invoked execution"
                value={
                  <Button
                    variant="inline-link"
                    onClick={() => onOpenExecution(op.invokedExecutionArn!)}
                  >
                    Open
                  </Button>
                }
              />
            )}
          </ColumnLayout>
          {op.payloadTruncated && (
            <Alert type="info">
              Lambda truncated this payload; what is shown is incomplete.
            </Alert>
          )}
          {prettyJson(op.result) !== null && (
            <Container header={<Header variant="h3">Result</Header>}>
              <JsonView value={prettyJson(op.result)} />
            </Container>
          )}
          {prettyJson(op.error) !== null && (
            <Container header={<Header variant="h3">Error</Header>}>
              <JsonView value={prettyJson(op.error)} />
            </Container>
          )}
        </SpaceBetween>
      )}
    </Modal>
  );
}

function InvocationsTable({ invocations }: { invocations: InvocationRow[] }) {
  return (
    <Table
      items={invocations}
      trackBy={(i) => i.requestId ?? `${i.startTime}`}
      variant="borderless"
      empty={<Empty>No completed invocations.</Empty>}
      columnDefinitions={[
        {
          id: "requestId",
          header: "Request ID",
          cell: (i) => i.requestId ?? "—",
        },
        {
          id: "started",
          header: "Started",
          cell: (i) => <Timestamp iso={i.startTime} />,
        },
        {
          id: "duration",
          header: "Duration",
          cell: (i) => formatDuration(i.durationMs),
        },
        {
          id: "error",
          header: "Error",
          cell: (i) => {
            if (!i.error) return "—";
            try {
              const e = JSON.parse(i.error) as {
                errorType?: string;
                errorMessage?: string;
              };
              return [e.errorType, e.errorMessage].filter(Boolean).join(": ");
            } catch {
              return i.error;
            }
          },
        },
      ]}
    />
  );
}

function HistoryTable({
  events,
  onExport,
}: {
  events: HistoryEvent[];
  onExport: (format: "csv" | "json") => void;
}) {
  return (
    <Table
      header={
        <Header
          actions={
            <ButtonDropdown
              disabled={events.length === 0}
              items={[
                { id: "csv", text: "Export as CSV" },
                { id: "json", text: "Export as JSON" },
              ]}
              onItemClick={({ detail }) =>
                onExport(detail.id as "csv" | "json")
              }
            >
              Export
            </ButtonDropdown>
          }
        >
          Events
        </Header>
      }
      items={events}
      trackBy={(e) => String(e.eventId)}
      variant="borderless"
      empty={<Empty>No history events.</Empty>}
      columnDefinitions={[
        {
          id: "eventId",
          header: "#",
          width: 70,
          cell: (e) => e.eventId ?? "—",
        },
        { id: "type", header: "Type", cell: (e) => e.type ?? "—" },
        { id: "subType", header: "Subtype", cell: (e) => e.subType || "—" },
        { id: "name", header: "Operation", cell: (e) => e.name || "—" },
        {
          id: "time",
          header: "Time",
          cell: (e) => <Timestamp iso={e.timestamp} />,
        },
      ]}
    />
  );
}
