/**
 * Two-step picker for third-party REST APIs: choose a vendor (from the host's
 * catalog, or paste any https OpenAPI spec URL), then choose an operation. The
 * host downloads and caches the vendor's OWN published spec, lists its
 * operations, and reflects the picked one into a url + parameter list + JSON
 * body skeleton, which we drop into a new `httpCall` node.
 *
 * The AWS counterpart is `AwsSdkBrowserModal.tsx`; this deliberately mirrors its
 * shape and message-correlation pattern.
 *
 * Credentials are never entered here. The catalog carries the vendor's expected
 * auth STYLE plus a suggested environment-variable NAME, and that is all that
 * reaches the model — a `.dar.ts` is committed to git and embedded in the
 * deployment zip, so a secret typed into a node would leak into both.
 */
import { useEffect, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import { postMessage } from "../vscode";
import type {
  ApiDirectoryEntry,
  ApiOperation,
  ApiVendor,
  InboundMessage,
} from "../types";

/** Everything needed to create the node, produced when an operation is picked. */
export interface PickedApiOperation {
  name: string;
  method: string;
  url: string;
  headers?: string;
  query?: string;
  body?: string;
  authKind?: "none" | "bearer" | "header" | "basic" | "query";
  authEnvVar?: string;
  authName?: string;
  specId?: string;
  operationId?: string;
  comment?: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onAdd: (picked: PickedApiOperation) => void;
  /** Open straight into a vendor (from the palette). */
  initialSpec?: string;
}

/** `operationId` or "METHOD /path" -> a kebab-ish node name. */
function nodeName(op: ApiOperation): string {
  const base =
    op.operationId && op.operationId.trim() !== ""
      ? op.operationId
      : `${op.method} ${op.path}`;
  return (
    base
      .replace(/[{}]/g, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "api-call"
  );
}

export function ApiBrowserModal({
  visible,
  onDismiss,
  onAdd,
  initialSpec,
}: Props) {
  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [directory, setDirectory] = useState<ApiDirectoryEntry[]>([]);
  const [directoryAt, setDirectoryAt] = useState("");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [specUrlText, setSpecUrlText] = useState("");
  const [spec, setSpec] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [operations, setOperations] = useState<ApiOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // The catalog is static on the host — ask once per open.
  useEffect(() => {
    if (visible) postMessage({ type: "listApiVendors" });
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setFilter("");
      setSpecUrlText("");
      setSpec(null);
      setTitle("");
      setOperations([]);
      setLoading(false);
      setError("");
      setPendingKey(null);
      setExpandedProvider(null);
    }
  }, [visible]);

  const loadSpec = (id: string) => {
    setError("");
    setOperations([]);
    setFilter("");
    setSpec(id);
    setLoading(true);
    postMessage({ type: "listApiOperations", spec: id });
  };

  // Opened straight into a vendor from the palette.
  useEffect(() => {
    if (visible && initialSpec) loadSpec(initialSpec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialSpec]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<InboundMessage>) => {
      const msg = event.data;
      if (msg.type === "apiVendors") {
        if (msg.error) setError(msg.error);
        else {
          setVendors(msg.vendors ?? []);
          setDirectory(msg.directory ?? []);
          setDirectoryAt(msg.directoryGeneratedAt ?? "");
        }
        return;
      }
      if (msg.type === "apiOperations" && msg.specId === spec) {
        setLoading(false);
        if (msg.error) setError(msg.error);
        else {
          setOperations(msg.operations ?? []);
          setTitle(msg.title ?? "");
        }
        return;
      }
      if (
        msg.type === "apiOperationShape" &&
        msg.specId === spec &&
        msg.key === pendingKey
      ) {
        setPendingKey(null);
        if (msg.error) {
          setError(msg.error);
          return;
        }
        const op = operations.find((o) => o.key === msg.key);
        const vendor = vendors.find((v) => v.id === msg.specId);

        // Path placeholders become `${…}` template holes the author fills with
        // upstream results; query/header params become editable JSON objects.
        const url = (msg.url ?? "").replace(/\{([^}]+)\}/g, "\${$1}");
        const queryObj: Record<string, string> = {};
        const headerObj: Record<string, string> = {};
        for (const p of msg.params ?? []) {
          if (p.location === "query" && p.required) queryObj[p.name] = "";
          if (p.location === "header" && p.required) headerObj[p.name] = "";
        }

        onAdd({
          name: op ? nodeName(op) : "api-call",
          method: msg.method ?? "GET",
          url,
          query:
            Object.keys(queryObj).length > 0
              ? JSON.stringify(queryObj, null, 2)
              : undefined,
          headers:
            Object.keys(headerObj).length > 0
              ? JSON.stringify(headerObj, null, 2)
              : undefined,
          body:
            msg.bodySkeleton && Object.keys(msg.bodySkeleton).length > 0
              ? JSON.stringify(msg.bodySkeleton, null, 2)
              : undefined,
          authKind: vendor?.auth.kind ?? "none",
          authEnvVar: vendor?.auth.envVar,
          authName: vendor?.auth.name,
          specId: typeof msg.specId === "string" ? msg.specId : undefined,
          operationId: msg.operationId,
          comment: msg.summary,
        });
        onDismiss();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [spec, pendingKey, operations, vendors, onAdd, onDismiss]);

  const pickOperation = (key: string) => {
    if (!spec) return;
    setError("");
    setPendingKey(key);
    postMessage({ type: "reflectApiOperation", spec, key });
  };

  const filteredVendors = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.label.toLowerCase().includes(q));
  }, [filter, vendors]);

  /**
   * Directory entries grouped by provider, so the whole catalogue is browsable
   * without typing: ~1,100 APIs collapse to ~300 provider rows, and vendors
   * that publish many APIs (Azure has 565, Twilio 40) become one expandable
   * row instead of hundreds of scattered ones.
   */
  const providerGroups = useMemo(() => {
    const featured = new Set(vendors.map((v) => v.id));
    const byProvider = new Map<string, ApiDirectoryEntry[]>();
    for (const e of directory) {
      if (featured.has(e.id)) continue;
      const key = e.provider || e.title;
      const list = byProvider.get(key);
      if (list) list.push(e);
      else byProvider.set(key, [e]);
    }
    return [...byProvider.entries()]
      .map(([provider, entries]) => ({
        provider,
        entries: [...entries].sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }, [directory, vendors]);

  /**
   * Provider groups matching the search box. A provider matches on its own name
   * or on any of its APIs' titles; in the latter case only the matching APIs are
   * kept, so searching "sms" surfaces the relevant Twilio APIs rather than all
   * forty.
   */
  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return providerGroups;
    const out: typeof providerGroups = [];
    for (const g of providerGroups) {
      if (g.provider.toLowerCase().includes(q)) {
        out.push(g);
        continue;
      }
      const hits = g.entries.filter((e) =>
        e.title.toLowerCase().includes(q),
      );
      if (hits.length > 0) out.push({ provider: g.provider, entries: hits });
    }
    return out;
  }, [filter, providerGroups]);

  const directoryApiCount = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.entries.length, 0),
    [filteredGroups],
  );

  // Matches method, path, operationId, summary or tag — a spec can carry 1,200
  // operations (GitHub), so search is the primary way to navigate.
  const filteredOperations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return operations.slice(0, 300);
    return operations
      .filter(
        (o) =>
          o.key.toLowerCase().includes(q) ||
          (o.operationId ?? "").toLowerCase().includes(q) ||
          (o.summary ?? "").toLowerCase().includes(q) ||
          o.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 300);
  }, [filter, operations]);

  const urlValid = /^https:\/\/\S+$/i.test(specUrlText.trim());
  const activeVendor = vendors.find((v) => v.id === spec);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Add API method"
      footer={
        <Box float="right">
          <Button variant="link" onClick={onDismiss}>
            Cancel
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="s">
        {error && <Alert type="error">{error}</Alert>}

        {spec === null ? (
          <>
            <Box>
              Choose an API, then an operation. Specs are always fetched from the
              vendor’s own published OpenAPI document.
            </Box>
            <Input
              value={filter}
              onChange={({ detail }) => setFilter(detail.value)}
              placeholder="Search APIs and vendors (e.g. Stripe, payments, twilio.com)"
              type="search"
            />
            <SpaceBetween size="xxs" direction="horizontal">
              <Input
                value={specUrlText}
                onChange={({ detail }) => setSpecUrlText(detail.value)}
                placeholder="…or an OpenAPI spec URL (https://…)"
              />
              <Button
                disabled={!urlValid}
                onClick={() => loadSpec(specUrlText.trim())}
              >
                Load
              </Button>
            </SpaceBetween>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              <SpaceBetween size="xxs">
                {filteredVendors.length > 0 && (
                  <Box fontSize="body-s" color="text-status-inactive">
                    Featured — auth preconfigured
                  </Box>
                )}
                {filteredVendors.map((v) => (
                  <Button
                    key={v.id}
                    variant="link"
                    onClick={() => loadSpec(v.id)}
                  >
                    {v.label}
                  </Button>
                ))}
                {filteredGroups.length > 0 && (
                  <>
                    <Box
                      fontSize="body-s"
                      color="text-status-inactive"
                      padding={{ top: "xs" }}
                    >
                      All vendors — {filteredGroups.length} providers,{" "}
                      {directoryApiCount} APIs
                      {directoryAt ? ` (indexed ${directoryAt})` : ""}. Specs are
                      fetched from the vendor; auth is not preconfigured.
                    </Box>
                    {filteredGroups.map((g) => {
                      const single = g.entries.length === 1;
                      const open = expandedProvider === g.provider;
                      return (
                        <div key={g.provider}>
                          <Button
                            variant="link"
                            iconName={
                              single
                                ? undefined
                                : open
                                  ? "treeview-collapse"
                                  : "treeview-expand"
                            }
                            onClick={() =>
                              single
                                ? loadSpec(g.entries[0].id)
                                : setExpandedProvider(open ? null : g.provider)
                            }
                          >
                            {single
                              ? `${g.entries[0].title} — ${g.provider}`
                              : `${g.provider} (${g.entries.length})`}
                          </Button>
                          {open && !single && (
                            <div style={{ paddingLeft: 20 }}>
                              <SpaceBetween size="xxs">
                                {g.entries.map((e) => (
                                  <Button
                                    key={e.id}
                                    variant="link"
                                    onClick={() => loadSpec(e.id)}
                                  >
                                    {e.title}
                                  </Button>
                                ))}
                              </SpaceBetween>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                {filteredVendors.length === 0 &&
                  filteredGroups.length === 0 && (
                    <Box color="text-status-inactive">No APIs match.</Box>
                  )}
              </SpaceBetween>
            </div>
          </>
        ) : (
          <>
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                iconName="angle-left"
                variant="link"
                onClick={() => {
                  setSpec(null);
                  setOperations([]);
                  setError("");
                  setFilter("");
                }}
              >
                APIs
              </Button>
              <Box variant="strong" padding={{ top: "xxs" }}>
                {title || spec}
              </Box>
            </SpaceBetween>
            {activeVendor && (
              <Box fontSize="body-s" color="text-status-inactive">
                Auth: {activeVendor.auth.kind} from{" "}
                <code>{activeVendor.auth.envVar}</code>
                {activeVendor.auth.hint ? ` — ${activeVendor.auth.hint}` : ""}
              </Box>
            )}
            {loading ? (
              <Box textAlign="center" padding="m">
                <Spinner /> Downloading spec…
              </Box>
            ) : (
              <>
                <Input
                  value={filter}
                  onChange={({ detail }) => setFilter(detail.value)}
                  placeholder="Search operations (path, id, summary or tag)"
                  type="search"
                />
                <Box fontSize="body-s" color="text-status-inactive">
                  {operations.length} operations
                  {filteredOperations.length < operations.length
                    ? ` — showing ${filteredOperations.length}`
                    : ""}
                </Box>
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  <SpaceBetween size="xxs">
                    {filteredOperations.map((o) => (
                      <Button
                        key={o.key}
                        variant="link"
                        loading={pendingKey === o.key}
                        onClick={() => pickOperation(o.key)}
                      >
                        {o.key}
                        {o.summary ? ` — ${o.summary}` : ""}
                      </Button>
                    ))}
                    {filteredOperations.length === 0 && (
                      <Box color="text-status-inactive">No operations.</Box>
                    )}
                  </SpaceBetween>
                </div>
              </>
            )}
          </>
        )}
      </SpaceBetween>
    </Modal>
  );
}
