import { useRef, useEffect, useState } from "react";
import embed, { type Result } from "vega-embed";
import * as vegaInterpreter from "vega-interpreter";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Box from "@cloudscape-design/components/box";
import { postMessage } from "./vscode";

interface Props {
  spec: Record<string, unknown>;
  data: Record<string, unknown>[];
}

export function VegaChart({ spec, data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Result | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!containerRef.current) return;
    setError("");

    const fullSpec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      width: 500,
      height: 300,
      ...spec,
      data: { values: data },
      config: {
        background: "transparent",
        axis: { labelColor: "#ccc", titleColor: "#ccc", gridColor: "#444" },
        legend: { labelColor: "#ccc", titleColor: "#ccc" },
        title: { color: "#ccc" },
        arc: { stroke: "#333" },
      },
    };

    embed(containerRef.current, fullSpec as any, {
      actions: false,
      renderer: "svg",
      ast: true,
      expr: vegaInterpreter,
    })
      .then((result) => {
        viewRef.current = result;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [spec, data]);

  const exportSVG = async () => {
    if (!viewRef.current) return;
    const svg = await viewRef.current.view.toSVG();
    postMessage({ type: "exportChart", format: "svg", content: svg } as any);
  };

  const exportPNG = async () => {
    if (!viewRef.current) return;
    const canvas = await viewRef.current.view.toCanvas();
    const dataUrl = canvas.toDataURL("image/png");
    postMessage({ type: "exportChart", format: "png", content: dataUrl } as any);
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={exportSVG} iconName="download">SVG</Button>
              <Button onClick={exportPNG} iconName="download">PNG</Button>
            </SpaceBetween>
          }
        >
          Chart
        </Header>
      }
    >
      <div ref={containerRef} style={{ minHeight: "320px" }} />
      {error && (
        <Box color="text-status-error" padding={{ top: "s" }}>
          {error}
        </Box>
      )}
    </Container>
  );
}
