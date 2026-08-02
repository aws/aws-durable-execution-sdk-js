import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Box from "@cloudscape-design/components/box";
import { useState } from "react";
import { DateView } from "./DateView";
import type { FunctionSummary } from "./types";

interface FunctionsListPageProps {
  functions: FunctionSummary[];
  functionsError?: string;
  functionsLoading: boolean;
  onRefresh: () => void;
  /** Drill into a single function's detail (level 2). */
  onSelect: (name: string) => void;
}

/**
 * Level 1 of the Durable Functions drill-down: every durable function in the
 * region, as a table. Click a name to open its detail (info + executions).
 */
export function FunctionsListPage({
  functions,
  functionsError,
  functionsLoading,
  onRefresh,
  onSelect,
}: FunctionsListPageProps) {
  const [filterText, setFilterText] = useState("");
  const filtered = filterText.trim()
    ? functions.filter((f) =>
        f.name.toLowerCase().includes(filterText.trim().toLowerCase()),
      )
    : functions;

  return (
    <Table
      header={
        <Header
          counter={
            filterText.trim()
              ? `(${filtered.length}/${functions.length})`
              : `(${functions.length})`
          }
          actions={
            <Button
              iconName="refresh"
              loading={functionsLoading}
              onClick={onRefresh}
            >
              Refresh
            </Button>
          }
        >
          Durable functions
        </Header>
      }
      filter={
        <TextFilter
          filteringText={filterText}
          onChange={({ detail }) => setFilterText(detail.filteringText)}
          filteringPlaceholder="Find a function by name"
          filteringAriaLabel="Find a durable function by name"
          countText={`${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
        />
      }
      loading={functionsLoading && functions.length === 0}
      loadingText="Loading durable functions…"
      items={filtered}
      trackBy="name"
      empty={
        functionsError ? (
          <Alert type="error" header="Couldn't list functions">
            {functionsError}
          </Alert>
        ) : (
          <Box textAlign="center" color="inherit">
            No durable functions found in this region.
          </Box>
        )
      }
      columnDefinitions={[
        {
          id: "name",
          header: "Name",
          cell: (f: FunctionSummary) => (
            <Button variant="inline-link" onClick={() => onSelect(f.name)}>
              {f.name}
            </Button>
          ),
        },
        {
          id: "runtime",
          header: "Runtime",
          cell: (f: FunctionSummary) => f.runtime ?? "—",
        },
        {
          id: "packageType",
          header: "Package type",
          cell: (f: FunctionSummary) => f.packageType ?? "—",
        },
        {
          id: "lastModified",
          header: "Last modified",
          cell: (f: FunctionSummary) => <DateView date={f.lastModified} />,
        },
      ]}
    />
  );
}
