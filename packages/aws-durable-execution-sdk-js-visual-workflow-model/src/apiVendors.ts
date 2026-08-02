/**
 * Catalog of third-party REST APIs the Studio can browse, for the "API methods"
 * palette tab and the `httpCall` node.
 *
 * Every entry links to the VENDOR'S OWN published OpenAPI document, never a
 * third-party aggregator. That is a deliberate choice: crowdsourced mirrors
 * (notably APIs-guru's `openapi-directory`, the obvious candidate) go stale —
 * at the time this was written its hosted directory had no spec updated since
 * April 2023, and its Stripe entry still described the 2022-11-15 API. Pointing
 * at the vendor's own repo means the operation list is whatever the vendor
 * shipped most recently, with no mirror to keep in sync.
 *
 * Only self-contained single-document specs belong here. Specs that split
 * operations across files via external `$ref`s (DigitalOcean's, for example,
 * whose 445 paths are all `$ref: resources/…yml`) cannot be enumerated without
 * a multi-file resolver and are deliberately excluded.
 *
 * Nothing is bundled — specs are fetched on demand and cached on disk (see
 * `openApiReflect.ts`), because these documents are large: Stripe's is ~8 MB
 * and GitHub's ~13 MB.
 *
 * Adding a vendor is just another entry; users can also point the browser at
 * any spec URL directly, so this list is a convenience, not a limit.
 */

import apiDirectoryData from "./generated/apiDirectory.json";

/** How a vendor expects its credential to be presented. */
export interface ApiVendorAuth {
  /** Matches the `httpCall` model's `authKind`. */
  kind: "none" | "bearer" | "header" | "basic" | "query";
  /** Header or query-param name, for the "header"/"query" kinds. */
  name?: string;
  /**
   * SUGGESTED Lambda environment variable name to read the credential from.
   * Only ever a variable NAME — a `.dar.ts` is committed and shipped inside the
   * deployment zip, so it must never hold the secret itself.
   */
  envVar: string;
  /** Short human note about what credential to use. */
  hint?: string;
}

export interface ApiVendor {
  /** Stable id, used as the `httpCall` node's `specId`. */
  id: string;
  label: string;
  /** The vendor's own published OpenAPI/Swagger document (JSON or YAML). */
  specUrl: string;
  /** Human documentation entry point. */
  docsUrl: string;
  auth: ApiVendorAuth;
  /**
   * Base URL to use when the spec itself doesn't carry a usable one (Swagger
   * 2.0 documents often omit `host`).
   */
  baseUrl?: string;
}

export const API_VENDORS: ApiVendor[] = [
  {
    id: "stripe",
    label: "Stripe",
    specUrl:
      "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    docsUrl: "https://stripe.com/docs/api",
    auth: {
      kind: "bearer",
      envVar: "STRIPE_API_KEY",
      hint: "Secret key (sk_…) as a bearer token.",
    },
  },
  {
    id: "github",
    label: "GitHub",
    specUrl:
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    docsUrl: "https://docs.github.com/rest",
    auth: {
      kind: "bearer",
      envVar: "GITHUB_TOKEN",
      hint: "Personal access token or GitHub App installation token.",
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    specUrl:
      "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    auth: { kind: "bearer", envVar: "OPENAI_API_KEY" },
  },
  {
    id: "twilio",
    label: "Twilio",
    specUrl:
      "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
    docsUrl: "https://www.twilio.com/docs/usage/api",
    auth: {
      kind: "basic",
      envVar: "TWILIO_BASIC_AUTH",
      hint: 'Basic auth — set the variable to "<AccountSid>:<AuthToken>".',
    },
  },
  {
    id: "slack",
    label: "Slack",
    specUrl:
      "https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json",
    docsUrl: "https://api.slack.com/methods",
    // Swagger 2.0 document with no `host` — supply the Web API base ourselves.
    baseUrl: "https://slack.com/api",
    auth: {
      kind: "bearer",
      envVar: "SLACK_BOT_TOKEN",
      hint: "Bot or user OAuth token (xoxb-… / xoxp-…).",
    },
  },
  {
    id: "asana",
    label: "Asana",
    specUrl:
      "https://raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml",
    docsUrl: "https://developers.asana.com/reference",
    auth: { kind: "bearer", envVar: "ASANA_ACCESS_TOKEN" },
  },
];

/** Looks a vendor up by id. */
export function findApiVendor(id: string): ApiVendor | undefined {
  return API_VENDORS.find((v) => v.id === id);
}

/**
 * One entry in the wider community-indexed directory (see
 * `scripts/regenerate-api-directory.mjs`).
 *
 * These are NOT curated: only the API's existence and its vendor spec location
 * are known, so there is no auth configuration — the author picks the auth style
 * in the inspector. `specUrl` always points at the vendor's own document.
 */
export interface ApiDirectoryEntry {
  /** APIs-guru index key, e.g. "notion.com" — used only as a stable id. */
  id: string;
  title: string;
  provider: string;
  specUrl: string;
}

/**
 * ~1,100 third-party APIs, each VERIFIED at generation time to be a real
 * OpenAPI/Swagger document with at least one path, fetched from the vendor's own
 * URL. Indexed via APIs-guru but never SERVED by it — see the regeneration
 * script's header for why that distinction matters, and for what gets filtered
 * out (Google Discovery documents, Postman collections, HTML error pages, and
 * ~770 origins that no longer resolve at all).
 *
 * Verification is a point-in-time snapshot: a vendor can move or break its spec
 * afterwards, so the browser still surfaces load errors rather than assuming
 * every entry works forever.
 */
export const API_DIRECTORY: ApiDirectoryEntry[] =
  // `?? []`: an empty-but-valid snapshot (or one whose shape changed) would
  // otherwise become a TypeError at module load, which fails the whole package
  // rather than degrading to an empty directory.
  (apiDirectoryData.entries as ApiDirectoryEntry[] | undefined) ?? [];

/** The date the directory was last regenerated (YYYY-MM-DD). */
export const API_DIRECTORY_GENERATED_AT: string =
  apiDirectoryData.generatedAt as string;

/** Looks a directory entry up by id. */
export function findApiDirectoryEntry(
  id: string,
): ApiDirectoryEntry | undefined {
  return API_DIRECTORY.find((e) => e.id === id);
}
