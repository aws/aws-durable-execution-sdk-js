import { useState, useMemo, useEffect, useRef } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select, { SelectProps } from "@cloudscape-design/components/select";
import Box from "@cloudscape-design/components/box";
import Alert from "@cloudscape-design/components/alert";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Modal from "@cloudscape-design/components/modal";
import Table from "@cloudscape-design/components/table";
import { VegaChart } from "./VegaChart";
import { postMessage } from "./vscode";

interface Props {
  columns: string[];
  rows: string[][];
  suggestedCharts?: string[];
  onBack: () => void;
}

type PresetType = "bar" | "stacked-bar" | "line" | "area" | "scatter" | "heatmap" | "histogram" | "pie" | "boxplot";

// Constant list of every selectable chart type (order = fallback dropdown order).
const ALL_PRESETS: { id: PresetType; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "stacked-bar", label: "Stacked Bar" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "scatter", label: "Scatter" },
  { id: "heatmap", label: "Heatmap" },
  { id: "histogram", label: "Histogram" },
  { id: "pie", label: "Pie" },
  { id: "boxplot", label: "Box Plot" },
];

// Give up on an in-flight visualize request after this long so a hung model
// call can't wedge the UI (the host normally always replies).
const REQUEST_TIMEOUT_MS = 60_000;

export function VisualizePage({ columns, rows, suggestedCharts, onBack }: Props) {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [selectedType, setSelectedType] = useState<SelectProps.Option | null>(
    null,
  );
  // Monotonic id per request; a reply is applied only if it matches the latest
  // request, so a slow response can't clobber a newer one (Bedrock latency
  // varies, and requests can overlap).
  const reqIdRef = useRef(0);
  // Clears loading if the host never replies (e.g. a hung/stalled model call)
  // so the UI can't wedge with the Select/Button/Enter all disabled.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Both the chart-type dropdown and the free-text box are answered by the
  // model (see extension host onVisualize). Listen for its reply here rather
  // than routing through App's handler, so the feature stays self-contained;
  // App ignores these message types.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type !== "chartSpec" && msg?.type !== "chartSpecError") return;
      // Ignore stale replies from a superseded request.
      if (msg.requestId !== reqIdRef.current) return;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (msg.type === "chartSpec") {
        setSpec(msg.spec);
        setLlmLoading(false);
        setLlmError("");
      } else {
        setLlmError(
          msg.message || "Could not build a chart from that description.",
        );
        setLlmLoading(false);
      }
      // Reset the dropdown selection after every reply (success or error).
      // Cloudscape Select only fires onChange when the value changes, so
      // leaving it set would make re-picking the same type a silent no-op;
      // clearing it lets the user re-generate the same chart type. The chart
      // itself stays rendered below.
      setSelectedType(null);
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // All chart types are always offered in the dropdown; the ones the model
  // suggested for this result are floated to the top and tagged "Recommended"
  // (previously only the suggested ones were shown, hiding the rest).
  const chartOptions: SelectProps.Option[] = useMemo(() => {
    const recommended = new Set(suggestedCharts ?? []);
    return [
      ...ALL_PRESETS.filter((p) => recommended.has(p.id)),
      ...ALL_PRESETS.filter((p) => !recommended.has(p.id)),
    ].map((p) => ({
      label: p.label,
      value: p.id,
      ...(recommended.has(p.id) ? { labelTag: "Recommended" } : {}),
    }));
  }, [suggestedCharts]);

  // Convert rows to objects with numeric coercion
  const data = useMemo(
    () =>
      rows.map((row) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => {
          const val = row[i] ?? "";
          const num = Number(val);
          obj[col] = val !== "" && !isNaN(num) ? num : val;
        });
        return obj;
      }),
    [columns, rows],
  );

  // Guess which columns are numeric (a hint sent to the model).
  const numericCols = useMemo(
    () =>
      columns.filter((col) => {
        const sample = data.find((d) => d[col] !== "" && d[col] != null);
        return sample && typeof sample[col] === "number";
      }),
    [columns, data],
  );

  // Both the chart-type dropdown and the free-text box are answered by the
  // model: given the columns (and which are numeric) plus the request, it
  // decides the field for each channel and any styling (axis scale/min, color
  // scheme, sort). Row data is never sent. A dropdown pick sends chartType; the
  // text box sends its description (letting the model choose the type from the
  // words); both are sent together when a type is picked while text is typed.
  const requestSpec = (req: { chartType?: string; description?: string }) => {
    const description = req.description?.trim() ?? "";
    if (!req.chartType && !description) return;
    const requestId = ++reqIdRef.current;
    setLlmLoading(true);
    setLlmError("");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // Only fire if this is still the in-flight request (no reply arrived).
      if (reqIdRef.current !== requestId) return;
      // Advance the id so a reply that lands after the timeout is treated as
      // stale and ignored (rather than popping a chart in over the error).
      reqIdRef.current++;
      timeoutRef.current = null;
      setLlmLoading(false);
      setSelectedType(null);
      setLlmError("The chart request timed out. Please try again.");
    }, REQUEST_TIMEOUT_MS);
    postMessage({
      type: "visualize",
      columns,
      numericColumns: numericCols,
      chartType: req.chartType,
      description,
      requestId,
    });
  };

  return (
    <SpaceBetween size="l">
      <Button variant="link" onClick={onBack}>← Back to data</Button>

      <Container header={<Header variant="h2">Visualize</Header>}>
        <SpaceBetween size="m">
          <Box>
            <strong>Columns:</strong> {columns.join(", ")} ({rows.length} rows)
            {suggestedCharts && suggestedCharts.length > 0 && (
              <span> · <strong>Suggested:</strong> {suggestedCharts.join(", ")}</span>
            )}
            {(!suggestedCharts || suggestedCharts.length === 0) && (
              <span> · <em>(no chart suggestions from LLM — showing all)</em></span>
            )}
          </Box>

          <FormField
            label="Chart type"
            description="Pick a type and the model builds the chart — choosing the fields and styling for these columns. Types tagged “Recommended” fit best."
          >
            <SpaceBetween direction="horizontal" size="s">
              <Select
                selectedOption={selectedType}
                onChange={({ detail }) => {
                  setSelectedType(detail.selectedOption);
                  requestSpec({
                    chartType: detail.selectedOption.value,
                    description: customPrompt,
                  });
                }}
                options={chartOptions}
                placeholder="Choose a chart type"
                disabled={llmLoading}
                expandToViewport
              />
              <Button
                variant="icon"
                iconName="status-info"
                onClick={() => setGuideOpen(true)}
              />
            </SpaceBetween>
          </FormField>

          <FormField
            label="Or describe how to visualize"
            description="Uses the model to map your request onto the fetched columns — e.g. 'record_count as data, product_category and hour_bucket as axis, stacked bar'."
          >
            <Input
              value={customPrompt}
              onChange={({ detail }) => setCustomPrompt(detail.value)}
              onKeyDown={({ detail }) => {
                if (detail.key === "Enter" && !llmLoading)
                  requestSpec({ description: customPrompt });
              }}
              placeholder="stacked bar chart colored by status"
            />
          </FormField>
          <Button
            onClick={() => requestSpec({ description: customPrompt })}
            disabled={!customPrompt.trim() || llmLoading}
          >
            Visualize
          </Button>

          {llmError && (
            <Alert type="error" header="Couldn't build the chart">
              {llmError}
            </Alert>
          )}
        </SpaceBetween>
      </Container>

      {llmLoading && (
        <StatusIndicator type="loading">Generating chart…</StatusIndicator>
      )}
      {spec && <VegaChart spec={spec} data={data} />}

      <Modal
        visible={guideOpen}
        onDismiss={() => setGuideOpen(false)}
        header="Visualization Guide"
        size="large"
      >
        <SpaceBetween size="m">
          <Box>Pick a chart type or describe what you want in the text field — either way the model maps your request onto the result columns and picks sensible fields and styling. No new data query is run; the chart is built from the rows already fetched.</Box>

          <Table
            columnDefinitions={[
              { id: "chart", header: "Chart Type", cell: (item) => <strong>{item.chart}</strong> },
              { id: "best", header: "Best For", cell: (item) => item.best },
              { id: "needs", header: "Data Needed", cell: (item) => item.needs },
            ]}
            items={[
              { chart: "Bar Chart", best: "Comparing values across categories (e.g., count by status)", needs: "1 categorical + 1 numeric column" },
              { chart: "Stacked Bar", best: "Composition within categories (e.g., status breakdown per customer)", needs: "2 categorical + 1 numeric column" },
              { chart: "Line Chart", best: "Trends over time or ordered sequences", needs: "1 ordered/time column + 1 numeric column" },
              { chart: "Area Chart", best: "Trends with volume emphasis (filled area under line)", needs: "1 ordered/time column + 1 numeric column" },
              { chart: "Scatter Plot", best: "Relationship between two numeric variables", needs: "2 numeric columns" },
              { chart: "Heatmap", best: "Two-dimensional comparisons (e.g., customer × category)", needs: "2 categorical + 1 numeric column" },
              { chart: "Histogram", best: "Distribution of a single numeric variable", needs: "1 numeric column" },
              { chart: "Pie / Donut", best: "Proportions of a whole (few categories)", needs: "1 categorical + 1 numeric column" },
              { chart: "Box Plot", best: "Statistical distribution (median, quartiles, outliers)", needs: "1 categorical + 1 numeric column" },
            ]}
            variant="embedded"
          />

          <Header variant="h3">Tips</Header>
          <Box variant="p">
            • Pick a chart type from the dropdown or describe what you want; the model chooses which columns map to each axis/value and adds styling.
          </Box>
          <Box variant="p">
            • For grouped/stacked bars, make sure your query returns a second categorical column for the model to use as the color/series.
          </Box>
          <Box variant="p">
            • Heatmaps work best with 2 categorical columns + 1 numeric. Query example: "count by customerName and productCategory from input".
          </Box>
          <Box variant="p">
            • Charts can be exported as PNG or SVG using the "⋯" menu on the chart.
          </Box>
          <Box variant="p">
            • If the chart looks wrong, refine your description, or go back and adjust your query to return the right columns.
          </Box>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
