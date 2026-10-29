/** Small presentational pieces shared by the execution viewer pages. */
import { CodeView } from "@cloudscape-design/code-view";
import jsonHighlight from "@cloudscape-design/code-view/highlight/json";
import Box from "@cloudscape-design/components/box";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";
import { formatTimestamp, statusType } from "./executionFormat";

export function Status({ status }: { status?: string }) {
  return (
    <StatusIndicator type={statusType(status)}>{status || "—"}</StatusIndicator>
  );
}

/** Local time, with the exact ISO instant on hover. */
export function Timestamp({ iso }: { iso?: string }) {
  return <span title={iso}>{formatTimestamp(iso)}</span>;
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <div style={{ wordBreak: "break-all" }}>{value ?? "—"}</div>
    </div>
  );
}

/** A copyable value, e.g. an ARN. */
export function Copyable({ value }: { value?: string }) {
  if (!value) return <>—</>;
  return (
    <CopyToClipboard
      variant="inline"
      textToCopy={value}
      copyButtonText="Copy"
      copySuccessText="Copied"
      copyErrorText="Failed to copy"
    />
  );
}

export function JsonView({ value }: { value: string | null }) {
  if (value === null) return null;
  return (
    <div style={{ maxHeight: 500, overflow: "auto" }}>
      <CodeView
        content={value}
        highlight={jsonHighlight}
        lineNumbers
        wrapLines
        actions={
          <CopyToClipboard
            variant="icon"
            copyButtonText="Copy"
            copyErrorText="Failed to copy"
            copySuccessText="Copied"
            textToCopy={value}
          />
        }
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Box textAlign="center" color="text-status-inactive" padding="m">
      {children}
    </Box>
  );
}
