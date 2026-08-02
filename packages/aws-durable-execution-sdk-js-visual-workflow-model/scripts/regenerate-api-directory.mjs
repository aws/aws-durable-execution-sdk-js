#!/usr/bin/env node
/**
 * Regenerates `src/generated/apiDirectory.json` — the searchable directory of
 * third-party APIs behind the Studio's "API methods" palette tab.
 *
 * WHY THIS EXISTS, AND WHAT IT DOES NOT DO
 *
 * APIs-guru's `openapi-directory` is used ONLY as an INDEX of which APIs exist
 * and where each vendor publishes its own spec. Its mirrored spec *content* is
 * deliberately never used: at the time of writing, its hosted directory had no
 * spec updated since April 2023, and its Stripe entry still described the
 * 2022-11-15 API while Stripe's own repo was on 2026-07-29.
 *
 * Every entry in the generated file therefore points at the `x-origin` URL —
 * the VENDOR'S OWN spec location — so operation lists are always as fresh as
 * whatever the vendor published, with no mirror in the loop.
 *
 * This script:
 *   1. downloads the APIs-guru directory listing;
 *   2. extracts each API's vendor-origin spec URL;
 *   3. drops non-https origins;
 *   4. drops `amazonaws.com` (already covered by the AWS SDK method browser);
 *   5. validates each remaining URL in two phases and keeps only real,
 *      non-empty OpenAPI/Swagger documents.
 *
 * VALIDATION IS TWO-PHASE for bandwidth reasons. A cheap 8 KB range request
 * sniffs for an `openapi:`/`swagger:`/`paths:` marker, which is enough to reject
 * the large amount of junk in the index: Google Discovery documents (~250 of
 * them — a different format this reflection cannot read), Postman collections
 * (Notion's "spec", for instance, is one), and HTML error pages. Entries that
 * fail the sniff are then downloaded in full and parsed, because a marker can
 * legitimately sit beyond 8 KB behind a long `info.description` — measured at
 * roughly 17% of sniff rejects, so skipping this phase would silently drop
 * working APIs (Twilio Notify and the FEC API among them).
 *
 * Yield when this was last run: 2,529 indexed -> 2,441 https -> 1,671 reachable
 * -> 1,401 non-AWS -> 1,108 real OpenAPI documents with at least one path.
 *
 * The `public-apis/public-apis` repository is intentionally NOT a source here:
 * it is a single 225 KB README of names, links and auth types with no machine-
 * readable specs at all, so it cannot drive operation listing or prefill. Its
 * companion JSON service (api.publicapis.org) no longer resolves.
 *
 * Usage:  node scripts/regenerate-api-directory.mjs
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const LIST_URL = "https://api.apis.guru/v2/list.json";
const CONCURRENCY = 32;
const FULL_CONCURRENCY = 20;
const PROBE_TIMEOUT_MS = 15_000;
const FULL_TIMEOUT_MS = 25_000;
/** Refuse absurdly large documents rather than holding them in memory. */
const MAX_SPEC_BYTES = 25 * 1024 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "src", "generated", "apiDirectory.json");

/** Pulls the vendor-origin spec URL out of an APIs-guru entry. */
function originUrl(versionEntry) {
  const origins = versionEntry?.info?.["x-origin"];
  if (!Array.isArray(origins)) return null;
  const withUrl = origins.find((o) => o && typeof o.url === "string");
  return withUrl ? withUrl.url : null;
}

const hasSpecMarker = (t) =>
  /("|^|\n)(openapi|swagger)("?\s*:)/i.test(t) ||
  /("|^|\n)paths("?\s*:)/i.test(t);
const isPostman = (t) => /_postman_id|schema\.getpostman\.com/i.test(t);
const isHtml = (t) => /^\s*<(!doctype|html)/i.test(t);

/** Phase 1 — cheap 8 KB sniff. Returns "keep" | "recheck" | "drop". */
async function sniff(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { range: "bytes=0-8191" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (res.status < 200 || res.status >= 300) return "drop";
    const text = await res.text();
    if (isPostman(text) || isHtml(text)) return "drop";
    return hasSpecMarker(text) ? "keep" : "recheck";
  } catch {
    return "drop";
  } finally {
    clearTimeout(timer);
  }
}

/** Phase 2 — full download + parse. True only for a usable OpenAPI document. */
async function fullyValid(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FULL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (text.length > MAX_SPEC_BYTES) return false;
    let doc;
    try {
      doc = text.trimStart().startsWith("{")
        ? JSON.parse(text)
        : parseYaml(text);
    } catch {
      return false;
    }
    if (!doc || typeof doc !== "object") return false;
    if (!(doc.openapi || doc.swagger)) return false; // e.g. Google Discovery
    return Boolean(doc.paths && Object.keys(doc.paths).length > 0);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `task` over `items` with a fixed worker pool. */
async function pool(items, width, task) {
  const queue = [...items];
  let done = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length > 0) {
        await task(queue.pop());
        if (++done % 400 === 0)
          process.stderr.write(`  processed ${done}/${items.length}\n`);
      }
    }),
  );
}

async function main() {
  process.stderr.write(`Downloading index: ${LIST_URL}\n`);
  const res = await fetch(LIST_URL);
  if (!res.ok) throw new Error(`index download failed: HTTP ${res.status}`);
  const list = await res.json();

  const candidates = [];
  for (const [key, entry] of Object.entries(list)) {
    const version = entry?.versions?.[entry.preferred];
    const url = originUrl(version);
    if (!url || !/^https:\/\//i.test(url)) continue;
    const provider = version?.info?.["x-providerName"] ?? "";
    if (/amazonaws\.com/.test(provider)) continue;
    // Exclude the aggregator's own API so the invariant "spec content never
    // comes from apis.guru" holds without exception (it is the vendor for this
    // one entry, which makes the rule ambiguous for no practical gain).
    if (/apis\.guru/i.test(provider) || /apis\.guru/i.test(url)) continue;
    candidates.push({
      id: key,
      title: String(version?.info?.title ?? key).slice(0, 120),
      provider,
      specUrl: url,
    });
  }

  process.stderr.write(`Phase 1: sniffing ${candidates.length} vendor URLs…\n`);
  const kept = [];
  const recheck = [];
  await pool(candidates, CONCURRENCY, async (c) => {
    const verdict = await sniff(c.specUrl);
    if (verdict === "keep") kept.push(c);
    else if (verdict === "recheck") recheck.push(c);
  });

  process.stderr.write(
    `Phase 2: full-parsing ${recheck.length} sniff rejects…\n`,
  );
  await pool(recheck, FULL_CONCURRENCY, async (c) => {
    if (await fullyValid(c.specUrl)) kept.push(c);
  });

  const seen = new Set();
  const entries = kept
    .filter((e) => (seen.has(e.specUrl) ? false : seen.add(e.specUrl)))
    .sort((a, b) => a.title.localeCompare(b.title));

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    `${JSON.stringify({
      $comment:
        "GENERATED — do not edit by hand. Run scripts/regenerate-api-directory.mjs to refresh.",
      generatedAt: new Date().toISOString().slice(0, 10),
      entries,
    })}\n`,
  );
  process.stderr.write(
    `Wrote ${entries.length} entries (${new Set(entries.map((e) => e.provider)).size} providers, ${statSync(outFile).size} bytes)\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
