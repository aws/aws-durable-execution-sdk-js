import { useState, useMemo } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Box from "@cloudscape-design/components/box";
import Modal from "@cloudscape-design/components/modal";
import Table from "@cloudscape-design/components/table";
import { VegaChart } from "./VegaChart";

interface Props {
  columns: string[];
  rows: string[][];
  suggestedCharts?: string[];
  onBack: () => void;
}

type PresetType = "bar" | "stacked-bar" | "line" | "area" | "scatter" | "heatmap" | "histogram" | "pie" | "boxplot";

export function VisualizePage({ columns, rows, suggestedCharts, onBack }: Props) {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  const allPresets: { id: PresetType; label: string }[] = [
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

  // Show only suggested charts if the LLM provided them, otherwise show all
  const visiblePresets = suggestedCharts && suggestedCharts.length > 0
    ? allPresets.filter((p) => suggestedCharts.includes(p.id))
    : allPresets;

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

  // Guess which columns are numeric vs categorical
  const numericCols = columns.filter((col) => {
    const sample = data.find((d) => d[col] !== "" && d[col] != null);
    return sample && typeof sample[col] === "number";
  });
  const categoricalCols = columns.filter((col) => !numericCols.includes(col));

  const applyCustom = () => {
    const desc = customPrompt.toLowerCase();
    // Detect chart type from description
    let type: PresetType = "bar";
    if (desc.includes("heatmap")) type = "heatmap";
    else if (desc.includes("scatter")) type = "scatter";
    else if (desc.includes("pie") || desc.includes("donut")) type = "pie";
    else if (desc.includes("histogram") || desc.includes("distribution")) type = "histogram";
    else if (desc.includes("area")) type = "area";
    else if (desc.includes("line") || desc.includes("trend")) type = "line";
    else if (desc.includes("stacked")) type = "stacked-bar";
    else if (desc.includes("box")) type = "boxplot";

    // Try to extract field names mentioned in the description
    const mentionedCols = columns.filter((col) => desc.includes(col.toLowerCase()));
    if (mentionedCols.length >= 2 && type === "heatmap") {
      setSpec({
        mark: "rect",
        encoding: {
          x: { field: mentionedCols[0], type: "nominal" },
          y: { field: mentionedCols[1], type: "nominal" },
          color: { field: mentionedCols[2] ?? numericCols[0] ?? columns[2], type: "quantitative" },
        },
      });
    } else if (mentionedCols.length >= 1) {
      // Use mentioned columns in the preset
      applyPreset(type);
    } else {
      applyPreset(type);
    }
  };

  const applyPreset = (type: PresetType) => {
    const xCol = categoricalCols[0] ?? columns[0];
    const yCol = numericCols[0] ?? columns[1];
    const colorCol = categoricalCols[1] ?? categoricalCols[0];

    switch (type) {
      case "bar":
        setSpec({
          mark: "bar",
          encoding: {
            x: { field: xCol, type: "nominal" },
            y: { field: yCol, type: "quantitative" },
            color: colorCol !== xCol ? { field: colorCol, type: "nominal" } : undefined,
          },
        });
        break;
      case "stacked-bar":
        setSpec({
          mark: "bar",
          encoding: {
            x: { field: xCol, type: "nominal" },
            y: { field: yCol, type: "quantitative", stack: "zero" },
            color: { field: colorCol ?? xCol, type: "nominal" },
          },
        });
        break;
      case "line":
        setSpec({
          mark: { type: "line", point: true },
          encoding: {
            x: { field: xCol, type: "nominal" },
            y: { field: yCol, type: "quantitative" },
          },
        });
        break;
      case "area":
        setSpec({
          mark: { type: "area", opacity: 0.7 },
          encoding: {
            x: { field: xCol, type: "nominal" },
            y: { field: yCol, type: "quantitative" },
          },
        });
        break;
      case "scatter":
        setSpec({
          mark: "point",
          encoding: {
            x: { field: numericCols[0] ?? columns[0], type: "quantitative" },
            y: { field: numericCols[1] ?? numericCols[0] ?? columns[1], type: "quantitative" },
            color: categoricalCols[0] ? { field: categoricalCols[0], type: "nominal" } : undefined,
          },
        });
        break;
      case "heatmap":
        setSpec({
          mark: "rect",
          encoding: {
            x: { field: categoricalCols[0] ?? columns[0], type: "nominal" },
            y: { field: categoricalCols[1] ?? columns[1], type: "nominal" },
            color: { field: numericCols[0] ?? columns[2], type: "quantitative" },
          },
        });
        break;
      case "histogram":
        setSpec({
          mark: "bar",
          encoding: {
            x: { field: numericCols[0] ?? columns[0], bin: true, type: "quantitative" },
            y: { aggregate: "count", type: "quantitative" },
          },
        });
        break;
      case "pie":
        setSpec({
          mark: { type: "arc", innerRadius: 30 },
          encoding: {
            theta: { field: yCol, type: "quantitative" },
            color: { field: xCol, type: "nominal" },
          },
        });
        break;
      case "boxplot":
        setSpec({
          mark: "boxplot",
          encoding: {
            x: { field: categoricalCols[0] ?? columns[0], type: "nominal" },
            y: { field: numericCols[0] ?? columns[1], type: "quantitative" },
          },
        });
        break;
    }
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

          <SpaceBetween direction="horizontal" size="s">
            {visiblePresets.map((p) => (
              <Button key={p.id} onClick={() => applyPreset(p.id)}>{p.label}</Button>
            ))}
            <Button variant="icon" iconName="status-info" onClick={() => setGuideOpen(true)} />
          </SpaceBetween>

          <FormField label="Or describe how to visualize" description="e.g. 'heatmap with customerName on x and productCategory on y'">
            <Input
              value={customPrompt}
              onChange={({ detail }) => setCustomPrompt(detail.value)}
              placeholder="stacked bar chart colored by status"
            />
          </FormField>
          <Button onClick={() => applyCustom()} disabled={!customPrompt.trim()}>
            Visualize
          </Button>
        </SpaceBetween>
      </Container>

      {spec && <VegaChart spec={spec} data={data} />}

      <Modal
        visible={guideOpen}
        onDismiss={() => setGuideOpen(false)}
        header="Visualization Guide"
        size="large"
      >
        <SpaceBetween size="m">
          <Box>Choose a preset or describe what you want in the text field. The chart renders instantly from the data already fetched — no additional query.</Box>

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
              { chart: "Tick / Strip", best: "Individual data points along an axis", needs: "1 numeric column (+ optional category)" },
            ]}
            variant="embedded"
          />

          <Header variant="h3">Tips</Header>
          <Box variant="p">
            • Presets auto-detect which columns are numeric (used for values) and which are categorical (used for labels/axes).
          </Box>
          <Box variant="p">
            • For grouped/stacked bar charts, make sure your query returns at least 2 categorical columns (the second becomes the color).
          </Box>
          <Box variant="p">
            • Heatmaps need exactly 2 categorical columns + 1 numeric. Query example: "count by customerName and productCategory from input".
          </Box>
          <Box variant="p">
            • Charts can be exported as PNG or SVG using the "⋯" menu on the chart.
          </Box>
          <Box variant="p">
            • If the chart looks wrong, go back and adjust your query to return the right columns.
          </Box>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
