import { useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tabs from "@cloudscape-design/components/tabs";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Table from "@cloudscape-design/components/table";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import CodeView from "@cloudscape-design/code-view/code-view";
import jsonHighlight from "@cloudscape-design/code-view/highlight/json";

interface OperationRecord {
  id: string;
  name?: string;
  type: string;
  subType?: string;
  parentId?: string;
  status: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  attempt?: number;
  error?: { name: string; message: string };
  result?: unknown;
  truncated?: boolean;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Every field of the record, as raw strings (matches ResultsTable's row shape). */
  fields: Record<string, string>;
  columns: string[];
}

const JSON_FIELDS = new Set(["input", "output", "error"]);

function tryParseJson(value: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function JsonView({ value }: { value: unknown }) {
  return (
    <CodeView
      content={JSON.stringify(value, null, 2)}
      highlight={jsonHighlight}
      wrapLines
    />
  );
}

function OperationsTable({ operations }: { operations: OperationRecord[] }) {
  const [selected, setSelected] = useState<OperationRecord | null>(null);

  const hasDetail = (o: OperationRecord) => o.result !== undefined || o.error !== undefined;

  // Operation `id` is unique per the SDK's OperationRecord contract, so it's a
  // safe trackBy key (unlike name, which can repeat across loop iterations).
  const columnDefs = [
    { id: "name", header: "Name", cell: (o: OperationRecord) => o.name ?? o.id },
    { id: "type", header: "Type", cell: (o: OperationRecord) => o.subType ?? o.type },
    { id: "status", header: "Status", cell: (o: OperationRecord) => o.status },
    {
      id: "durationMs",
      header: "Duration (ms)",
      cell: (o: OperationRecord) => (o.durationMs != null ? String(o.durationMs) : ""),
    },
    {
      id: "attempt",
      header: "Attempt",
      cell: (o: OperationRecord) => (o.attempt != null ? String(o.attempt) : ""),
    },
    {
      id: "detail",
      header: "Detail",
      // Makes it visible at a glance which rows actually have something to
      // click into, instead of some rows silently doing nothing on click —
      // result is opt-in per operation (see content.operations.overrides),
      // so it's expected and common for only some rows to have detail.
      cell: (o: OperationRecord) =>
        hasDetail(o) ? (
          <StatusIndicator type="info">View</StatusIndicator>
        ) : (
          <Box color="text-body-secondary">Not captured</Box>
        ),
    },
  ];

  const selectOperation = (o: OperationRecord | null) => setSelected(o && hasDetail(o) ? o : null);

  return (
    <>
      <Table
        columnDefinitions={columnDefs}
        items={operations}
        trackBy="id"
        selectionType="single"
        selectedItems={selected ? [selected] : []}
        isItemDisabled={(o) => !hasDetail(o)}
        onSelectionChange={({ detail }) => selectOperation(detail.selectedItems[0] ?? null)}
        variant="embedded"
        wrapLines
        onRowClick={({ detail }) => selectOperation(detail.item)}
        empty={
          <Box textAlign="center" color="text-body-secondary">
            No operations.
          </Box>
        }
      />

      <Modal
        visible={selected != null}
        onDismiss={() => setSelected(null)}
        header={selected ? `Operation: ${selected.name ?? selected.id}` : "Operation"}
        size="large"
      >
        {selected && (
          <SpaceBetween size="m">
            <KeyValuePairs
              columns={2}
              items={[
                { label: "Type", value: selected.type },
                { label: "Status", value: selected.status },
                { label: "Start Time", value: selected.startTime ?? "—" },
                { label: "End Time", value: selected.endTime ?? "—" },
              ]}
            />
            {selected.error && (
              <Box>
                <Box variant="awsui-key-label">Error</Box>
                <JsonView value={selected.error} />
              </Box>
            )}
            {selected.result !== undefined && (
              <Box>
                <Box variant="awsui-key-label">Result</Box>
                <JsonView value={selected.result} />
              </Box>
            )}
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}

/**
 * Full detail view for a single WorkflowInsightRecord. Unlike a flat
 * KeyValuePairs dump, this renders `operations` as its own table (row click
 * shows that operation's result/error), and `input`/`output`/`error` as
 * syntax-highlighted JSON instead of an inline stringified blob.
 */
export function RecordDetail({ visible, onDismiss, fields, columns }: Props) {
  const operations = tryParseJson(fields.operations ?? fields.operationsByName ?? "");
  const operationsList: OperationRecord[] | undefined = Array.isArray(operations)
    // Raw operations array (Aurora, and the "array"/"both" operationsFormat):
    // `id` is already unique per the SDK contract.
    ? operations
    : operations && typeof operations === "object"
      // operationsByName map (DynamoDB, CloudWatch direct): OperationSummary
      // has no `id` field, but the map key (name) is unique by construction —
      // use it as a synthetic id so the table can select rows reliably.
      ? Object.entries(operations as Record<string, unknown>).map(([name, v]) => ({
          id: name,
          name,
          ...(v as Omit<OperationRecord, "id" | "name">),
        }))
      : undefined;

  const otherColumns = columns.filter(
    (c) => c !== "operations" && c !== "operationsByName" && !JSON_FIELDS.has(c),
  );

  return (
    <Modal visible={visible} onDismiss={onDismiss} header="Record Details" size="max">
      <Tabs
        tabs={[
          {
            id: "fields",
            label: "Fields",
            content: (
              <KeyValuePairs
                columns={1}
                items={otherColumns.map((col) => ({
                  label: col,
                  value: fields[col] || <Box color="text-body-secondary">—</Box>,
                }))}
              />
            ),
          },
          ...(operationsList
            ? [
                {
                  id: "operations",
                  label: `Operations (${operationsList.length})`,
                  content: <OperationsTable operations={operationsList} />,
                },
              ]
            : []),
          ...(fields.input
            ? [
                {
                  id: "input",
                  label: "Input",
                  content: <JsonView value={tryParseJson(fields.input) ?? fields.input} />,
                },
              ]
            : []),
          ...(fields.output
            ? [
                {
                  id: "output",
                  label: "Output",
                  content: <JsonView value={tryParseJson(fields.output) ?? fields.output} />,
                },
              ]
            : []),
          ...(fields.error
            ? [
                {
                  id: "error",
                  label: "Error",
                  content: <JsonView value={tryParseJson(fields.error) ?? fields.error} />,
                },
              ]
            : []),
        ]}
      />
    </Modal>
  );
}
