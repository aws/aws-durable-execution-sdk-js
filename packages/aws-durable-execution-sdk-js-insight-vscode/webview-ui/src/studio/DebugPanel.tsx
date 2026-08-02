/**
 * In-Studio debug session panel: shown next to (or below) the code view while
 * a remote debug run is active. Renders the session's status stream, the
 * stepping toolbar, the paused call stack, a lazily-expanded variables tree,
 * and the run's final result/error — everything the old VS Code debug tab
 * showed, but inside Workflow Studio so the SAME UI works in both hosts (the
 * VS Code extension and the Electron desktop app).
 *
 * Self-contained by design: the parent (App) owns the session state — this
 * component only renders it and calls back with commands/property fetches.
 * The message protocol behind those callbacks lives in ../types.ts (see the
 * "In-Studio debugger protocol" section there).
 */
import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type {
  DebugProperty,
  DebugScope,
  DebugStackFrame,
} from "../types";

/** A stepping/continue/stop command name — mirrors the "debugCommand"
 * outbound message's `command` field in ../types.ts. */
export type DebugCommandName =
  | "continue"
  | "stepOver"
  | "stepInto"
  | "stepOut"
  | "stop";

/** The last surfaced pause of the session (from a kind:'paused' event). */
export interface DebugPauseInfo {
  darLine: number | null;
  functionName?: string;
  callStack: DebugStackFrame[];
  scopes: DebugScope[];
}

/**
 * The whole debug session as App accumulates it from "debugEvent" messages.
 * Declared here (not in App) so the panel stays self-contained — App imports
 * the shape it must produce rather than the panel importing App's internals.
 */
export interface DebugSessionState {
  /** Panel visible: true from run start until the user dismisses it (kept
   *  true through done/error so the result stays readable). */
  active: boolean;
  /** Session live host-side: true until kind:'done'/'error' arrives. */
  running: boolean;
  /** True between a surfaced 'paused' event and the following 'resumed' —
   *  the only window in which stepping/continue make sense. */
  paused: boolean;
  /** The function being debugged (from kind:'started'), if known yet. */
  functionName: string | null;
  /** The most recent pause (kept after resume for the call-stack display,
   *  but the variables cache and paused-line highlight clear on resume). */
  lastPaused: DebugPauseInfo | null;
  /** Bumped on every 'paused' event — invalidates the variables cache and
   *  collapses the tree, since every pause has fresh objectIds. */
  pauseNonce: number;
  /** Accumulated kind:'status' progress lines, oldest first. */
  statusLines: string[];
  /** The run's final result (kind:'done'), or null while running/failed. */
  result: { statusCode?: number; payload: string; logTail?: string } | null;
  /** The run's failure (kind:'error'), or null. */
  error: string | null;
  /** The `.dar.ts` lines that actually bound (kind:'boundBreakpoints'), or
   *  null before the first bind report. */
  boundLines: number[] | null;
}

/** A fresh, inactive session — what App resets to on dismiss. */
export const INACTIVE_DEBUG_SESSION: DebugSessionState = {
  active: false,
  running: false,
  paused: false,
  functionName: null,
  lastPaused: null,
  pauseNonce: 0,
  statusLines: [],
  result: null,
  error: null,
  boundLines: null,
};

/** One objectId's fetch state in the per-pause variables cache. */
type PropFetch =
  | { status: "loading" }
  | { status: "done"; properties: DebugProperty[] }
  | { status: "error"; message: string };

/** Renders a value summary: prefer the human description, fall back to the
 * CDP type name; hard-truncated so a huge string/array doesn't blow up a
 * tree row (the full text is still in the title tooltip). */
function valueText(v: DebugProperty["value"]): string {
  const text = v.description ?? v.type;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * One expandable node of the variables tree: a scope row or an object-valued
 * property. Expansion is LAZY — the first open fetches own properties via
 * `fetchProps` (which posts "debugGetProperties" and caches by objectId);
 * nested objectIds recurse through the same component. Local open state
 * resets per pause because the whole tree is keyed by pauseNonce upstream.
 */
function VariableNode({
  label,
  valueLabel,
  objectId,
  depth,
  cache,
  fetchProps,
}: {
  label: string;
  valueLabel?: string;
  objectId?: string;
  depth: number;
  cache: Map<string, PropFetch>;
  fetchProps: (objectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = objectId !== undefined;
  const fetch = objectId ? cache.get(objectId) : undefined;

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "baseline",
          fontFamily: "monospace",
          fontSize: 12,
          cursor: expandable ? "pointer" : "default",
          padding: "1px 0",
        }}
        onClick={() => {
          if (!expandable || !objectId) return;
          const next = !open;
          setOpen(next);
          if (next) fetchProps(objectId);
        }}
        role={expandable ? "button" : undefined}
        aria-expanded={expandable ? open : undefined}
      >
        <span style={{ width: 12, flexShrink: 0, color: "#8b949e" }}>
          {expandable ? (open ? "▾" : "▸") : ""}
        </span>
        <span style={{ color: "#79c0ff", flexShrink: 0 }}>{label}</span>
        {valueLabel !== undefined && (
          <span
            style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={valueLabel}
          >
            {valueLabel}
          </span>
        )}
      </div>
      {open && objectId && (
        <div>
          {!fetch || fetch.status === "loading" ? (
            <div style={{ paddingLeft: (depth + 1) * 12, fontSize: 12 }}>
              <Spinner size="normal" />
            </div>
          ) : fetch.status === "error" ? (
            <div
              style={{
                paddingLeft: (depth + 1) * 12,
                fontSize: 12,
                color: "#f85149",
              }}
            >
              {fetch.message}
            </div>
          ) : fetch.properties.length === 0 ? (
            <div
              style={{
                paddingLeft: (depth + 1) * 12 + 18,
                fontSize: 12,
                color: "#8b949e",
                fontStyle: "italic",
              }}
            >
              (no properties)
            </div>
          ) : (
            fetch.properties.map((p) => (
              <VariableNode
                key={p.name}
                label={p.name}
                valueLabel={valueText(p.value)}
                objectId={p.value.objectId}
                depth={depth + 1}
                cache={cache}
                fetchProps={fetchProps}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Pretty-print a payload if it's JSON; show as-is otherwise. */
function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function DebugPanel({
  session,
  onCommand,
  onGetProperties,
  onDismiss,
  fitHeight,
}: {
  session: DebugSessionState;
  /** Post a "debugCommand" (continue/stepOver/stepInto/stepOut/stop). */
  onCommand: (command: DebugCommandName) => void;
  /** Fetch an object's own properties (posts "debugGetProperties" with a
   *  fresh requestId; resolves with the correlated reply). */
  onGetProperties: (objectId: string) => Promise<DebugProperty[]>;
  /** Hide the panel after the run finished (clears the session in App). */
  onDismiss: () => void;
  /** Constrain the panel to its parent's height and scroll its body
   *  internally (rather than growing the page). Set when the panel lives in a
   *  height-bounded column so the whole page doesn't scroll. */
  fitHeight?: boolean;
}) {
  // Per-pause variables cache, keyed by objectId. A Map in state (replaced,
  // never mutated in place) so re-renders see updates; cleared whenever the
  // pause changes or execution resumes — objectIds are only valid while the
  // runtime is paused at THAT spot, so stale entries would show wrong data.
  const [propCache, setPropCache] = useState<Map<string, PropFetch>>(
    () => new Map(),
  );
  useEffect(() => {
    setPropCache(new Map());
  }, [session.pauseNonce, session.paused]);

  const fetchProps = (objectId: string) => {
    // Already fetched (or in flight) for this pause — the cache is the point.
    if (propCache.has(objectId)) return;
    setPropCache((prev) => new Map(prev).set(objectId, { status: "loading" }));
    void onGetProperties(objectId).then(
      (properties) =>
        setPropCache((prev) =>
          new Map(prev).set(objectId, { status: "done", properties }),
        ),
      (e: unknown) =>
        setPropCache((prev) =>
          new Map(prev).set(objectId, {
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          }),
        ),
    );
  };

  const lastStatus = session.statusLines[session.statusLines.length - 1] ?? "";
  const stepDisabled = !session.paused || !session.running;

  return (
    <Container
      fitHeight={fitHeight}
      header={
        <Header
          variant="h3"
          actions={
            !session.running ? (
              <Button variant="icon" iconName="close" ariaLabel="Dismiss" onClick={onDismiss} />
            ) : undefined
          }
        >
          Debug{session.functionName ? `: ${session.functionName}` : ""}
        </Header>
      }
    >
      <SpaceBetween size="s">
        {/* Status line: paused/running/finished at a glance, latest progress
            message underneath, full stream collapsed below. */}
        <StatusIndicator
          type={
            session.error
              ? "error"
              : session.result
                ? "success"
                : session.paused
                  ? "warning"
                  : "in-progress"
          }
        >
          {session.error
            ? "Failed"
            : session.result
              ? "Finished"
              : session.paused
                ? session.lastPaused?.darLine != null
                  ? `Paused at .dar.ts:${session.lastPaused.darLine}`
                  : "Paused"
                : "Running"}
        </StatusIndicator>
        {session.running && !session.paused && lastStatus && (
          <Box fontSize="body-s" color="text-status-inactive">
            {lastStatus}
          </Box>
        )}

        {/* Stepping toolbar — same visual language as WorkflowCodeView's
            toolbar (icon buttons on the panel surface). Stop is ALWAYS
            enabled: while running it stops the session; after done/error it
            dismisses the panel (the only sensible action left). */}
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            variant="icon"
            iconName="play"
            ariaLabel="Continue"
            disabled={stepDisabled}
            onClick={() => onCommand("continue")}
          />
          <Button
            variant="icon"
            iconName="angle-right"
            ariaLabel="Step over"
            disabled={stepDisabled}
            onClick={() => onCommand("stepOver")}
          />
          <Button
            variant="icon"
            iconName="angle-down"
            ariaLabel="Step into"
            disabled={stepDisabled}
            onClick={() => onCommand("stepInto")}
          />
          <Button
            variant="icon"
            iconName="angle-up"
            ariaLabel="Step out"
            disabled={stepDisabled}
            onClick={() => onCommand("stepOut")}
          />
          <Button
            variant="icon"
            iconName="close"
            ariaLabel={session.running ? "Stop" : "Dismiss"}
            onClick={() => (session.running ? onCommand("stop") : onDismiss())}
          />
        </div>

        {session.boundLines !== null && session.running && (
          <Box fontSize="body-s" color="text-status-inactive">
            {session.boundLines.length > 0
              ? `Breakpoints bound: line${session.boundLines.length > 1 ? "s" : ""} ${session.boundLines.join(", ")}`
              : "No breakpoints bound — the run won't pause unless you set one on an executable line."}
          </Box>
        )}

        {/* Call stack for the last pause: top frame (where execution sits,
            and what the variables below belong to) highlighted. */}
        {session.paused && session.lastPaused && (
          <>
            <Box variant="h5">Call stack</Box>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 4,
                maxHeight: 140,
                overflow: "auto",
              }}
            >
              {session.lastPaused.callStack.map((f, i) => (
                <div
                  key={i}
                  style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: i === 0 ? "rgba(255, 214, 0, 0.12)" : undefined,
                    color: f.darLine != null ? "#e6edf3" : "#8b949e",
                  }}
                >
                  {f.functionName || "(anonymous)"}
                  {f.darLine != null ? ` — .dar.ts:${f.darLine}` : " — runtime"}
                </div>
              ))}
            </div>

            {/* Variables: the paused frame's scope chain, expanded lazily.
                Keyed by pauseNonce so every pause starts collapsed — the
                previous pause's open rows point at dead objectIds. */}
            <Box variant="h5">Variables</Box>
            <div
              key={session.pauseNonce}
              style={{
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 4,
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {session.lastPaused.scopes.map((s, i) => (
                <VariableNode
                  key={`${session.pauseNonce}-${i}`}
                  label={s.type}
                  objectId={s.objectId}
                  depth={0}
                  cache={propCache}
                  fetchProps={fetchProps}
                />
              ))}
            </div>
          </>
        )}

        {/* Final result / error. Kept visible (session.active stays true)
            until the user dismisses, so a fast run's output is readable. */}
        {session.result && (
          <SpaceBetween size="xs">
            <Box variant="h5">
              Result
              {session.result.statusCode !== undefined
                ? ` (status ${session.result.statusCode})`
                : ""}
            </Box>
            <pre
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 8,
                maxHeight: 200,
                overflow: "auto",
                margin: 0,
              }}
            >
              {prettyPayload(session.result.payload)}
            </pre>
            {session.result.logTail && (
              <ExpandableSection headerText="Log tail" variant="footer">
                <pre
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 200,
                    overflow: "auto",
                    margin: 0,
                  }}
                >
                  {session.result.logTail}
                </pre>
              </ExpandableSection>
            )}
          </SpaceBetween>
        )}
        {session.error && (
          <Box color="text-status-error" fontSize="body-s">
            {session.error}
          </Box>
        )}

        {session.statusLines.length > 0 && (
          <ExpandableSection headerText="Session log" variant="footer">
            <div
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {session.statusLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Container>
  );
}
