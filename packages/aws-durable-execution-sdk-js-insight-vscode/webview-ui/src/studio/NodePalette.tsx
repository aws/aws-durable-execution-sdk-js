/**
 * The Workflow Studio palette: the left column of draggable building blocks,
 * split into two tabs — "Primitives" (start/step/wait/…) and "Jobs" (one entry
 * per AWS "Run a Job" service integration). Each item can be dragged onto the
 * canvas or clicked to add a node; placement of a clicked node is decided by
 * the caller via `onAdd`. Jobs add an `awsJob` node pre-configured with that
 * integration.
 */
import Tabs from "@cloudscape-design/components/tabs";
import Icon from "@cloudscape-design/components/icon";
import {
  API_VENDORS,
  AWS_SDK_SERVICES,
  SERVICE_INTEGRATION_LIST,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { KIND_COLORS, NODE_ICONS, paletteKinds } from "./constants";
import { NODE_KIND_LABELS } from "../studioTypes";
import type { DarNodeKind } from "../studioTypes";

const itemStyle = (accent: string) => ({
  cursor: "grab" as const,
  userSelect: "none" as const,
  display: "flex" as const,
  alignItems: "center" as const,
  gap: 8,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #30363d",
  borderLeft: `4px solid ${accent}`,
  background: "#161b22",
  color: "#e6edf3",
  fontSize: 13,
});

/** A vertical, scrollable list of draggable palette items. */
function PaletteList({
  children,
  maxHeight,
}: {
  children: React.ReactNode;
  maxHeight: number | string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxHeight,
        overflowY: "auto",
        paddingTop: 4,
      }}
    >
      {children}
    </div>
  );
}

export function NodePalette({
  onAdd,
  onBrowseSdk,
  onBrowseApi,
  canvasHeight,
  dagEnabled = false,
}: {
  onAdd: (kind: DarNodeKind, integration?: string) => void;
  /** Open the AWS SDK method browser, optionally drilled into a service. */
  onBrowseSdk: (clientPackage?: string) => void;
  /** Open the third-party API browser, optionally drilled into a vendor. */
  onBrowseApi: (spec?: string) => void;
  canvasHeight?: number;
  /** Whether dag mode is enabled; hides `dagContainer` when false. */
  dagEnabled?: boolean;
}) {
  // Fill the same vertical space as the canvas (minus the tab header), so the
  // Jobs list scrolls within all available height instead of a fixed slice.
  const listMaxHeight =
    typeof canvasHeight === "number" && canvasHeight > 0
      ? Math.max(160, canvasHeight - 44)
      : "70vh";
  return (
    <div style={{ flex: "0 0 140px" }}>
      <Tabs
        disableContentPaddings
        tabs={[
          {
            id: "primitives",
            label: (
              <span title="Primitives">
                <Icon name="grid-view" />
              </span>
            ),
            content: (
              <PaletteList maxHeight={listMaxHeight}>
                {paletteKinds(dagEnabled).map((kind) => (
                  <div
                    key={kind}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("application/dar-node", kind)
                    }
                    onClick={() => onAdd(kind)}
                    title={`Drag onto the canvas, or click to add a ${NODE_KIND_LABELS[kind]}`}
                    style={itemStyle(KIND_COLORS[kind])}
                  >
                    <Icon name={NODE_ICONS[kind]} size="small" />
                    <span>{NODE_KIND_LABELS[kind]}</span>
                  </div>
                ))}
              </PaletteList>
            ),
          },
          {
            id: "jobs",
            label: (
              <span title="Jobs (AWS service integrations)">
                <Icon name="play" />
              </span>
            ),
            content: (
              <PaletteList maxHeight={listMaxHeight}>
                {SERVICE_INTEGRATION_LIST.map((preset) => (
                  <div
                    key={preset.key}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/dar-node",
                        `awsJob:${preset.key}`,
                      )
                    }
                    onClick={() => onAdd("awsJob", preset.key)}
                    title={`${preset.label} — start the job and wait until it finishes.\nDrag onto the canvas, or click to add.`}
                    style={itemStyle(KIND_COLORS.awsJob)}
                  >
                    <Icon name={NODE_ICONS.awsJob} size="small" />
                    <span>{preset.shortLabel}</span>
                  </div>
                ))}
              </PaletteList>
            ),
          },
          {
            id: "awsSdk",
            label: (
              <span title="AWS SDK methods">
                <Icon name="search" />
              </span>
            ),
            content: (
              <PaletteList maxHeight={listMaxHeight}>
                <div
                  onClick={() => onBrowseSdk()}
                  title="Search all AWS SDK services and operations"
                  style={{
                    ...itemStyle(KIND_COLORS.awsSdkCall),
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <Icon name="search" size="small" />
                  <span>Search all…</span>
                </div>
                {AWS_SDK_SERVICES.map((s) => (
                  <div
                    key={s.clientPackage}
                    onClick={() => onBrowseSdk(s.clientPackage)}
                    title={`${s.label} — pick an operation (${s.clientPackage})`}
                    style={{
                      ...itemStyle(KIND_COLORS.awsSdkCall),
                      cursor: "pointer",
                    }}
                  >
                    <Icon name={NODE_ICONS.awsSdkCall} size="small" />
                    <span>{s.label}</span>
                  </div>
                ))}
              </PaletteList>
            ),
          },
          {
            id: "apis",
            label: (
              <span title="API methods (third-party REST APIs)">
                <Icon name="external" />
              </span>
            ),
            content: (
              <PaletteList maxHeight={listMaxHeight}>
                <div
                  onClick={() => onBrowseApi()}
                  title="Search third-party API operations from each vendor's own OpenAPI spec"
                  style={{
                    ...itemStyle(KIND_COLORS.httpCall),
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <Icon name="search" size="small" />
                  <span>Search all…</span>
                </div>
                {API_VENDORS.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => onBrowseApi(v.id)}
                    title={`${v.label} — pick an operation`}
                    style={{
                      ...itemStyle(KIND_COLORS.httpCall),
                      cursor: "pointer",
                    }}
                  >
                    <Icon name={NODE_ICONS.httpCall} size="small" />
                    <span>{v.label}</span>
                  </div>
                ))}
                <div
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("application/dar-node", "httpCall")
                  }
                  onClick={() => onAdd("httpCall")}
                  title="Add a blank API call to configure by hand"
                  style={itemStyle(KIND_COLORS.httpCall)}
                >
                  <Icon name={NODE_ICONS.httpCall} size="small" />
                  <span>Custom…</span>
                </div>
              </PaletteList>
            ),
          },
        ]}
      />
    </div>
  );
}
