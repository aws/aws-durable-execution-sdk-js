import Alert from "@cloudscape-design/components/alert";
import { DateView } from "./DateView";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator, {
  type StatusIndicatorProps,
} from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { type ReactNode, useState } from "react";
import type { ExecutionRow, FunctionInfo } from "./types";

interface FunctionDetailPageProps {
  /** The function this detail page is showing. */
  functionName: string;
  info: FunctionInfo | null;
  infoError?: string;
  executions: ExecutionRow[];
  executionsError?: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onRefreshExecutions: () => void;
  onStartExecution: (payload: string, executionName?: string) => void;
  onOpenExecution: (arn: string) => void;
  /** Open this function's embedded workflow in Workflow Studio (editable only). */
  onEditWorkflow?: (functionName: string) => void;
  starting: boolean;
  startError?: string;
}

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
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div>{value ?? "—"}</div>
    </div>
  );
}

/**
 * Level 2 of the Durable Functions drill-down: one function's info + its
 * executions. Click an execution to open its detail (level 3).
 */
export function FunctionDetailPage({
  functionName,
  info,
  infoError,
  executions,
  executionsError,
  hasMore,
  loading,
  onLoadMore,
  onRefreshExecutions,
  onStartExecution,
  onOpenExecution,
  onEditWorkflow,
  starting,
  startError,
}: FunctionDetailPageProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [payload, setPayload] = useState("{}");
  const [execName, setExecName] = useState("");

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {info?.editable && onEditWorkflow && (
                  <Button
                    iconName="edit"
                    onClick={() => onEditWorkflow(functionName)}
                  >
                    Edit in Workflow Studio
                  </Button>
                )}
                <Button iconName="add-plus" onClick={() => setStartOpen(true)}>
                  Start execution
                </Button>
              </SpaceBetween>
            }
          >
            {functionName}
          </Header>
        }
      >
        <SpaceBetween size="m">
          {infoError && (
            <Alert type="error" header="Couldn't load function">
              {infoError}
            </Alert>
          )}
          {info && (
            <ColumnLayout columns={3} variant="text-grid">
              <Field label="Runtime" value={info.runtime} />
              <Field
                label="Memory"
                value={info.memorySize ? `${info.memorySize} MB` : undefined}
              />
              <Field
                label="Lambda timeout"
                value={info.timeout ? `${info.timeout}s` : undefined}
              />
              <Field
                label="Execution timeout"
                value={
                  info.executionTimeoutSeconds
                    ? `${info.executionTimeoutSeconds}s`
                    : undefined
                }
              />
              <Field
                label="History retention"
                value={
                  info.retentionDays ? `${info.retentionDays} days` : undefined
                }
              />
              <Field label="Version" value={info.version} />
              <Field label="Handler" value={info.handler} />
              <Field label="Last modified" value={<DateView date={info.lastModified} />} />
              <Field
                label="Code size"
                value={
                  info.codeSize
                    ? `${Math.round(info.codeSize / 1024)} KB`
                    : undefined
                }
              />
            </ColumnLayout>
          )}
        </SpaceBetween>
      </Container>

      <Table
        header={
          <Header
            counter={`(${executions.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  loading={loading}
                  onClick={onRefreshExecutions}
                >
                  Refresh
                </Button>
                {hasMore && (
                  <Button loading={loading} onClick={onLoadMore}>
                    Load more
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            Executions
          </Header>
        }
        loading={loading && executions.length === 0}
        loadingText="Loading executions…"
        items={executions}
        trackBy="arn"
        empty={
          executionsError ? (
            <Alert type="error">{executionsError}</Alert>
          ) : (
            <Box textAlign="center" color="inherit">
              No executions found.
            </Box>
          )
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name / Id",
            cell: (e: ExecutionRow) => (
              <Button variant="inline-link" onClick={() => onOpenExecution(e.arn)}>
                {e.name || e.arn.split("/").pop() || e.arn}
              </Button>
            ),
          },
          {
            id: "status",
            header: "Status",
            cell: (e: ExecutionRow) => (
              <StatusIndicator type={STATUS_TYPE[e.status] ?? "info"}>
                {e.status || "—"}
              </StatusIndicator>
            ),
          },
          {
            id: "started",
            header: "Started",
            cell: (e: ExecutionRow) => <DateView date={e.startTime} />,
          },
          {
            id: "ended",
            header: "Ended",
            cell: (e: ExecutionRow) => <DateView date={e.endTime} />,
          },
          {
            id: "duration",
            header: "Duration",
            cell: (e: ExecutionRow) => fmtDuration(e.durationMs),
          },
        ]}
      />

      <Modal
        visible={startOpen}
        onDismiss={() => setStartOpen(false)}
        header="Start execution"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setStartOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={starting}
                onClick={() => onStartExecution(payload, execName)}
              >
                Start (async)
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>
            Invokes <b>{functionName}</b> asynchronously and opens the new
            execution's detail.
          </Box>
          {startError && <Alert type="error">{startError}</Alert>}
          <FormField
            label="Execution name (optional)"
            description="A unique name for idempotency; reusing a name won't start a duplicate execution."
          >
            <Input
              value={execName}
              onChange={({ detail }) => setExecName(detail.value)}
              placeholder="e.g. order-12345"
            />
          </FormField>
          <FormField label="Input payload (JSON)">
            <Textarea
              value={payload}
              onChange={({ detail }) => setPayload(detail.value)}
              rows={6}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
