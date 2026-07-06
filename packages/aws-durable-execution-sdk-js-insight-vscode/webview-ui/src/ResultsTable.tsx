import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import Spinner from "@cloudscape-design/components/spinner";
import Modal from "@cloudscape-design/components/modal";
import { useState } from "react";
import { RecordDetail } from "./RecordDetail";
import { postMessage } from "./vscode";

interface Props {
  columns: string[];
  rows: string[][];
  explanation?: string;
  /**
   * When set, only these columns are shown in the table (in this order,
   * skipping any not present in `columns`); the rest of each record's fields
   * are still available by clicking the row, in a detail view. Omit to show
   * every column in the table with no detail view (previous behavior).
   *
   * Mutually exclusive with `idColumn` in practice: this is for callers that
   * already have every field in memory (e.g. the SQS live view, which
   * parses the full message body) and just want to hide some by default.
   */
  primaryColumns?: string[];
  /**
   * When set, result rows carry a stable per-execution identifier under this
   * column (added by the extension host — see queryShape.ts), and clicking a
   * row fetches the *full* record on demand (via a "fetchDetail" message) —
   * unlike `primaryColumns`, the extra fields are NOT already in `rows`,
   * since the query that produced this result set may only have selected a
   * few columns. Omitted entirely for aggregate query results (GROUP BY,
   * COUNT, etc.), which have no single execution a row corresponds to.
   */
  idColumn?: string;
  /**
   * The actual result-column names (if present) carrying each row's
   * year/month/day partition value — passed straight through from the
   * "results" message. Only meaningful for the S3+Athena destination; lets
   * the row-detail fetch prune to one partition instead of scanning the
   * whole table on every click (see extension.ts's onFetchDetail and
   * athena.ts's fetchAthenaRecord).
   */
  partitionColumns?: { year?: string; month?: string; day?: string };
  /**
   * Columns to keep in `columns`/`rows` (so the fetch-on-click logic below
   * can still read their values off each row) but exclude from the rendered
   * table. Used for idColumn/partitionColumns.* when the query didn't
   * explicitly ask for them: the S3+Athena destination injects year/month/
   * day purely so the detail fetch can prune partitions (see
   * queryShape.ts's extraColumns), and those weren't part of what the user
   * asked their question about — showing them as extra table columns is
   * noise, not signal. idColumn is included here too when it wasn't already
   * part of the query's own SELECT list, for the same reason (DynamoDB/
   * Aurora inject only idColumn, so this is usually a 1-element array for
   * those, vs. up to 4 for S3+Athena's idColumn + 3 partition columns).
   */
  hiddenColumns?: string[];
  /** Full record fetched for the currently open detail view, or null while none is open. Only meaningful when `idColumn` is set. */
  detailFields?: Record<string, string> | null;
  /** True while a "fetchDetail" request is in flight. */
  detailLoading?: boolean;
  /** Called when the detail modal is dismissed, to let the caller clear `detailFields`. */
  onDetailDismiss?: () => void;
  /** Called right before a "fetchDetail" message is posted, so the caller can set loading state. */
  onDetailFetchStart?: () => void;
  /** Rows shown per page. Defaults to 25; the conversation view uses a small value to keep each table short. */
  pageSize?: number;
}

export function ResultsTable({
  columns,
  rows,
  explanation,
  primaryColumns,
  idColumn,
  partitionColumns,
  hiddenColumns,
  detailFields,
  detailLoading,
  onDetailDismiss,
  onDetailFetchStart,
  pageSize = 25,
}: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const [detailItem, setDetailItem] = useState<Record<string, string> | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, string>[]>([]);

  if (columns.length === 0) {
    return (
      <Box textAlign="center" color="text-body-secondary" padding="l">
        No results.
      </Box>
    );
  }

  const displayColumns = (
    primaryColumns ? primaryColumns.filter((c) => columns.includes(c)) : columns
  ).filter((c) => !hiddenColumns?.includes(c));
  // Two independent ways a row can have "more to show": primaryColumns (the
  // extra fields are already in this row, just hidden from the table) or
  // idColumn (the extra fields need to be fetched — nothing to show yet).
  // hiddenColumns alone (with no primaryColumns) still needs to trigger
  // hasInMemoryDetail's "there's more to show" treatment for the SQS case —
  // but hiddenColumns is only ever passed for the fetchable-detail (Ask
  // flow) case in practice, so hasFetchableDetail already covers it; the
  // length comparison below still holds even with hiddenColumns applied,
  // since it only ever shrinks displayColumns further.
  const hasInMemoryDetail = primaryColumns != null && displayColumns.length < columns.length;
  const hasFetchableDetail = idColumn != null && columns.includes(idColumn);
  const hasDetail = hasInMemoryDetail || hasFetchableDetail;

  const columnDefs = displayColumns.map((col) => ({
    id: col,
    header: col,
    cell: (item: Record<string, string>) => item[col] || "",
    sortingField: col,
  }));

  // __rowIndex (added below, then columns are applied) gives every row a
  // stable identity for selection, independent of column contents, which may
  // repeat or be empty. If a record ever has a real "__rowIndex" column, its
  // value below wins (it's applied last) — vanishingly unlikely given the
  // WorkflowInsightRecord shape, but the double-underscore keeps it clear
  // this key is synthetic if a reader spots it in the data.
  const items: Record<string, string>[] = rows.map((row, i) => {
    const obj: Record<string, string> = { __rowIndex: String(i) };
    columns.forEach((col, j) => {
      obj[col] = row[j] ?? "";
    });
    return obj;
  });

  const totalPages = Math.ceil(items.length / pageSize);
  const pagedItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selectItem = (item: Record<string, string> | null) => {
    setSelectedItems(item ? [item] : []);
    setDetailItem(item);
    if (item && hasFetchableDetail && idColumn) {
      const idValue = item[idColumn];
      if (idValue) {
        onDetailFetchStart?.();
        postMessage({
          type: "fetchDetail",
          idColumn,
          idValue,
          year: partitionColumns?.year ? item[partitionColumns.year] : undefined,
          month: partitionColumns?.month ? item[partitionColumns.month] : undefined,
          day: partitionColumns?.day ? item[partitionColumns.day] : undefined,
        });
      }
    } else if (!item) {
      onDetailDismiss?.();
    }
  };

  // In fetchable-detail mode, the modal's content is the freshly fetched
  // full record (detailFields), not the row's own (partial) fields — the row
  // only carries whatever columns the query selected, which is why a fetch
  // was needed in the first place. In in-memory mode (SQS), the row already
  // has everything.
  const modalFields = hasFetchableDetail ? detailFields ?? {} : detailItem ?? {};
  const modalColumns = hasFetchableDetail
    ? Object.keys(detailFields ?? {})
    : columns;
  const modalVisible = hasFetchableDetail
    ? detailItem != null && (detailLoading || detailFields != null)
    : detailItem != null;

  return (
    <>
      <Table
        header={
          <Header
            counter={`(${items.length})`}
            description={
              hasDetail
                ? [explanation, "Select a row to see all fields."].filter(Boolean).join(" — ")
                : explanation
            }
          >
            Results
          </Header>
        }
        columnDefinitions={columnDefs}
        items={pagedItems}
        trackBy="__rowIndex"
        selectionType={hasDetail ? "single" : undefined}
        selectedItems={selectedItems}
        onSelectionChange={
          hasDetail
            ? ({ detail }) => selectItem(detail.selectedItems[0] ?? null)
            : undefined
        }
        sortingDisabled
        variant="container"
        wrapLines
        onRowClick={hasDetail ? ({ detail }) => selectItem(detail.item) : undefined}
        pagination={
          totalPages > 1 ? (
            <Pagination
              currentPageIndex={currentPage}
              pagesCount={totalPages}
              onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
            />
          ) : undefined
        }
        empty={
          <Box textAlign="center" color="text-body-secondary">
            No results.
          </Box>
        }
      />

      {hasFetchableDetail && detailItem != null && detailLoading && detailFields == null ? (
        <Modal visible onDismiss={() => selectItem(null)} header="Record Details" size="large">
          <Box textAlign="center" padding="xl">
            <Spinner size="large" /> Loading record...
          </Box>
        </Modal>
      ) : (
        <RecordDetail
          visible={modalVisible}
          onDismiss={() => selectItem(null)}
          fields={modalFields}
          columns={modalColumns}
        />
      )}
    </>
  );
}
