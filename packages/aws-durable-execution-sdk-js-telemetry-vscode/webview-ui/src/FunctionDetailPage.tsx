import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import { formatDuration } from "./executionFormat";
import { Field, Status, Timestamp } from "./ExecutionParts";
import type { ExecutionRow, FunctionInfo } from "./types";

interface Props {
  functionName: string;
  info: FunctionInfo | null;
  infoError?: string;
  executions: ExecutionRow[];
  executionsError?: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onStart: () => void;
  onOpenExecution: (arn: string) => void;
}

/** One function's configuration and its executions, newest first. */
export function FunctionDetailPage({
  functionName,
  info,
  infoError,
  executions,
  executionsError,
  hasMore,
  loading,
  onLoadMore,
  onRefresh,
  onStart,
  onOpenExecution,
}: Props) {
  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description={info?.description}
            actions={
              <Button iconName="add-plus" onClick={onStart}>
                Start execution
              </Button>
            }
          >
            {functionName}
          </Header>
        }
      >
        {infoError ? (
          <Alert type="error" header="Couldn't load function">
            {infoError}
          </Alert>
        ) : (
          <ColumnLayout columns={3} variant="text-grid">
            <Field label="Runtime" value={info?.runtime} />
            <Field
              label="Memory"
              value={info?.memorySize ? `${info.memorySize} MB` : undefined}
            />
            <Field
              label="Invocation timeout"
              value={info?.timeout ? `${info.timeout}s` : undefined}
            />
            <Field
              label="Execution timeout"
              value={
                info?.executionTimeoutSeconds
                  ? formatDuration(info.executionTimeoutSeconds * 1000)
                  : undefined
              }
            />
            <Field
              label="History retention"
              value={
                info?.retentionDays ? `${info.retentionDays} days` : undefined
              }
            />
            <Field label="Handler" value={info?.handler} />
            <Field
              label="Last modified"
              value={<Timestamp iso={info?.lastModified} />}
            />
            <Field
              label="Code size"
              value={
                info?.codeSize
                  ? `${Math.round(info.codeSize / 1024)} KB`
                  : undefined
              }
            />
            <Field label="Version" value={info?.version} />
          </ColumnLayout>
        )}
      </Container>

      <Table
        header={
          <Header
            counter={`(${executions.length}${hasMore ? "+" : ""})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh executions"
                  loading={loading}
                  onClick={onRefresh}
                />
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
        variant="container"
        empty={
          executionsError ? (
            <Alert type="error" header="Couldn't list executions">
              {executionsError}
            </Alert>
          ) : (
            <Box textAlign="center" color="inherit">
              No executions found.
            </Box>
          )
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            cell: (e) => (
              <Button
                variant="inline-link"
                onClick={() => onOpenExecution(e.arn)}
              >
                {e.name || e.arn.split("/").pop() || e.arn}
              </Button>
            ),
          },
          {
            id: "status",
            header: "Status",
            cell: (e) => <Status status={e.status} />,
          },
          {
            id: "started",
            header: "Started",
            cell: (e) => <Timestamp iso={e.startTime} />,
          },
          {
            id: "ended",
            header: "Ended",
            cell: (e) => <Timestamp iso={e.endTime} />,
          },
          {
            id: "duration",
            header: "Duration",
            cell: (e) => formatDuration(e.durationMs),
          },
        ]}
      />
    </SpaceBetween>
  );
}
