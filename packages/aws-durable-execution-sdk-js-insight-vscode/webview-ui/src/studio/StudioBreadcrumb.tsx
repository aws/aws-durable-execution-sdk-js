/**
 * Breadcrumb for drill-in navigation through nested map bodies. Shows the path
 * (root › map1 › …); clicking a crumb navigates back to that depth. Only the
 * ancestors are clickable — the last crumb is the level currently being edited.
 */
import { Fragment } from "react";

export function StudioBreadcrumb({
  labels,
  onExitTo,
}: {
  labels: string[];
  onExitTo: (depth: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: "#8b949e",
      }}
    >
      {labels.map((label, i) => {
        const isLast = i === labels.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span>›</span>}
            {isLast ? (
              <span style={{ color: "#e6edf3", fontWeight: 600 }}>{label}</span>
            ) : (
              <span
                role="button"
                onClick={() => onExitTo(i)}
                style={{ cursor: "pointer", color: "#58a6ff" }}
              >
                {label}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
