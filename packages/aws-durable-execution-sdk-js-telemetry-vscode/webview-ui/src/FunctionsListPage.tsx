import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useState } from "react";
import { Timestamp } from "./ExecutionParts";
import type { FunctionSummary } from "./types";

interface Props {
  region: string;
  functions: FunctionSummary[];
  error?: string;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (name: string) => void;
}

/** Every durable function in the configured region. */
export function FunctionsListPage({
  region,
  functions,
  error,
  loading,
  onRefresh,
  onSelect,
}: Props) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? functions.filter((f) => f.name.toLowerCase().includes(needle))
    : functions;

  return (
    <Table
      header={
        <Header
          counter={
            needle
              ? `(${shown.length}/${functions.length})`
              : `(${functions.length})`
          }
          description={`Functions with durable execution enabled in ${region}.`}
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh functions"
              loading={loading}
              onClick={onRefresh}
            />
          }
        >
          Durable functions
        </Header>
      }
      filter={
        <TextFilter
          filteringText={filter}
          onChange={({ detail }) => setFilter(detail.filteringText)}
          filteringPlaceholder="Find a function by name"
          filteringAriaLabel="Find a durable function by name"
          countText={`${shown.length} match${shown.length === 1 ? "" : "es"}`}
        />
      }
      loading={loading && functions.length === 0}
      loadingText="Loading durable functions…"
      items={shown}
      trackBy="name"
      variant="full-page"
      empty={
        error ? (
          <Alert type="error" header="Couldn't list functions">
            {error}
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
          cell: (f) => (
            <Button variant="inline-link" onClick={() => onSelect(f.name)}>
              {f.name}
            </Button>
          ),
        },
        { id: "runtime", header: "Runtime", cell: (f) => f.runtime ?? "—" },
        {
          id: "packageType",
          header: "Package type",
          cell: (f) => f.packageType ?? "—",
        },
        {
          id: "lastModified",
          header: "Last modified",
          cell: (f) => <Timestamp iso={f.lastModified} />,
        },
      ]}
    />
  );
}
