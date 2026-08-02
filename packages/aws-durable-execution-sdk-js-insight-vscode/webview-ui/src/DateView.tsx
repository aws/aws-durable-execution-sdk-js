/**
 * Reusable date/time display. Renders the value in the user's favorite format
 * (from {@link useDateFormat}); hovering opens a popup listing every format —
 * Relative ("time ago"), Local, UTC, ISO, Unix — each with a copy button and a
 * star to make it the new default. A Short/Long toggle switches the compactness
 * of the formats that support it (Relative, Local); it's disabled for the
 * others (UTC/ISO/Unix are fixed).
 *
 * Inspired by GrapheneConsoleCommon's DateView, plus "time ago", a favoritable
 * default, and a short/long variant.
 */
import Popover from "@cloudscape-design/components/popover";
import Box from "@cloudscape-design/components/box";
import Icon from "@cloudscape-design/components/icon";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";
import { useDateFormat } from "./DateFormatContext";
import { relativeTime } from "./relativeTime";
import type { DateFormat, DateVariant } from "./types";

const FORMAT_META: { key: DateFormat; label: string }[] = [
  { key: "relative", label: "Relative" },
  { key: "local", label: "Local" },
  { key: "utc", label: "UTC" },
  { key: "iso", label: "ISO" },
  { key: "unix", label: "Unix" },
];

/** Whether a format renders differently in short vs. long. */
export function supportsVariant(fmt: DateFormat): boolean {
  return fmt === "relative" || fmt === "local";
}

/** Formats a Date in one of the supported display formats + variant. */
export function formatDate(
  d: Date,
  fmt: DateFormat,
  variant: DateVariant,
): string {
  const short = variant === "short";
  switch (fmt) {
    case "relative":
      return relativeTime(d, Date.now(), short);
    case "utc":
      return d.toUTCString();
    case "iso":
      return d.toISOString();
    case "unix":
      return String(d.getTime());
    case "local":
    default:
      return d.toLocaleString(
        undefined,
        short
          ? { dateStyle: "short", timeStyle: "short" }
          : { dateStyle: "full", timeStyle: "long" },
      );
  }
}

export interface DateViewProps {
  /** Epoch ms, an ISO/parseable string, or a Date. */
  date: number | string | Date | null | undefined;
}

export function DateView({ date }: DateViewProps) {
  const { format, setFormat, variant, setVariant } = useDateFormat();
  const d =
    date == null ? null : date instanceof Date ? date : new Date(date);
  if (!d || Number.isNaN(d.getTime())) return <span>-</span>;

  const variantApplies = supportsVariant(format);

  return (
    <Popover
      dismissButton={false}
      position="top"
      size="large"
      triggerType="text"
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SegmentedControl
            selectedId={variant}
            onChange={({ detail }) =>
              setVariant(detail.selectedId as DateVariant)
            }
            label="Short or long format"
            options={[
              { id: "short", text: "Short", disabled: !variantApplies },
              { id: "long", text: "Long", disabled: !variantApplies },
            ]}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {FORMAT_META.map((f) => {
              const value = formatDate(d, f.key, variant);
              const isDefault = f.key === format;
              return (
                <div
                  key={f.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    role="button"
                    title={
                      isDefault
                        ? "Default format"
                        : `Use ${f.label} as the default`
                    }
                    onClick={() => setFormat(f.key)}
                    style={{ cursor: "pointer", display: "inline-flex" }}
                  >
                    <Icon
                      name={isDefault ? "star-filled" : "star"}
                      variant={isDefault ? "warning" : "subtle"}
                    />
                  </span>
                  <span
                    style={{ minWidth: 60, color: "#8b949e", fontSize: 12 }}
                  >
                    {f.label}
                    {supportsVariant(f.key) ? "" : " *"}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {value}
                  </span>
                  <CopyToClipboard
                    variant="icon"
                    textToCopy={value}
                    copyButtonText={`Copy ${f.label}`}
                    copySuccessText="Copied"
                    copyErrorText="Failed to copy"
                  />
                </div>
              );
            })}
          </div>
          <Box variant="small" color="text-status-inactive">
            Star a format to make it the default. Short/Long applies to Relative
            and Local; * formats are fixed.
          </Box>
        </div>
      }
    >
      {formatDate(d, format, variant)}
    </Popover>
  );
}
