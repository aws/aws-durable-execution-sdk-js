import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import { useState } from "react";
import { RecordDetail } from "./RecordDetail";

interface Props {
  columns: string[];
  rows: string[][];
  explanation?: string;
  /**
   * When set, only these columns are shown in the table (in this order,
   * skipping any not present in `columns`); the rest of each record's fields
   * are still available by clicking the row, in a detail view. Omit to show
   * every column in the table with no detail view (previous behavior).
   */
  primaryColumns?: string[];
}

const PAGE_SIZE = 25;

export function ResultsTable({ columns, rows, explanation, primaryColumns }: Props) {
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

  const displayColumns = primaryColumns
    ? primaryColumns.filter((c) => columns.includes(c))
    : columns;
  // Only offer a detail view when there's actually something extra to show.
  const hasDetail = primaryColumns != null && displayColumns.length < columns.length;

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

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const pagedItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectItem = (item: Record<string, string> | null) => {
    setSelectedItems(item ? [item] : []);
    setDetailItem(item);
  };

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

      <RecordDetail
        visible={detailItem != null}
        onDismiss={() => selectItem(null)}
        fields={detailItem ?? {}}
        columns={columns}
      />
    </>
  );
}
