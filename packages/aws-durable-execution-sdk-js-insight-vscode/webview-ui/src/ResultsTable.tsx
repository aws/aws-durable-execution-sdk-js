import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import { useState } from "react";

interface Props {
  columns: string[];
  rows: string[][];
  explanation?: string;
}

const PAGE_SIZE = 25;

export function ResultsTable({ columns, rows, explanation }: Props) {
  const [currentPage, setCurrentPage] = useState(1);

  if (columns.length === 0) {
    return (
      <Box textAlign="center" color="text-body-secondary" padding="l">
        No results.
      </Box>
    );
  }

  const columnDefs = columns.map((col) => ({
    id: col,
    header: col,
    cell: (item: Record<string, string>) => item[col] || "",
    sortingField: col,
  }));

  const items: Record<string, string>[] = rows.map((row) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? "";
    });
    return obj;
  });

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const pagedItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Table
      header={
        <Header
          counter={`(${items.length})`}
          description={explanation}
        >
          Results
        </Header>
      }
      columnDefinitions={columnDefs}
      items={pagedItems}
      sortingDisabled
      variant="container"
      wrapLines
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
  );
}
