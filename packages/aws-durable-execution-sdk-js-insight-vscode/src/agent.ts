import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { transform } from "esbuild";
import * as ts from "typescript";
import {
  generateHandler,
  parseWorkflow,
} from "@aws/durable-execution-sdk-js-cdk";
import {
  DAR_JSON_SCHEMA,
  DAR_NODE_KINDS,
  toIdentifier,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { completeText, type LlmProvider } from "./llm";

/**
 * AI-assisted authoring for the Workflow Studio. Kept separate from the
 * Explorer's `llm.ts` flows — the only thing reused is the provider-agnostic
 * `completeText` helper, so Explorer behavior is untouched.
 */
export interface AgentLlmOptions {
  provider: LlmProvider;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
}

/** A request to write the code for one node field. */
export interface NodeCodeRequest {
  /** Node kind (step, waitForCondition, condition, callback, map, end, …). */
  kind: string;
  /** Which code field: code | stopCondition | submitterCode | itemsCode | fallbackCode. */
  field: string;
  /** The node's name. */
  name: string;
  /** Natural-language description of what the code should do. */
  description: string;
  /** In-scope identifiers the code may reference (event/input, upstream results, …). */
  scope: string[];
  /** TypeScript type of the workflow input, if known. */
  inputType?: string;
  /** Existing code to improve/replace, if any. */
  currentCode?: string;
}

/** Strips a ```lang … ``` markdown fence, if the model added one. */
export function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

/** Whether the field expects a single expression rather than a statement body. */
function isExpressionField(req: NodeCodeRequest): boolean {
  return (
    req.field === "stopCondition" ||
    (req.kind === "condition" && req.field === "code")
  );
}

/** A human description of what the target field must contain. */
function fieldPurpose(req: NodeCodeRequest): string {
  switch (req.field) {
    case "stopCondition":
      return "a boolean expression over `state` that is true when polling should stop";
    case "itemsCode":
      return "a function body that returns the array to iterate over";
    case "submitterCode":
      return "a function body that sends `callbackId` to an external system (no return needed)";
    case "fallbackCode":
      return "a function body that returns a fallback result (the caught error is `err`)";
    default:
      if (req.kind === "condition")
        return "an expression whose value selects the branch to follow";
      if (req.kind === "waitForCondition")
        return "a function body that returns the next polling `state`";
      if (req.kind === "end")
        return "a function body for the terminal node (return the final result, or throw)";
      if (req.kind === "inline")
        return "a deterministic function body run inline between durable steps (return its result; no I/O, no non-determinism — it re-runs on replay)";
      return "a function body for a durable step (return its result)";
  }
}

function buildPrompt(req: NodeCodeRequest): string {
  const expression = isExpressionField(req);
  const scopeVars: string[] = [
    `\`event\`${req.inputType ? ` (type: ${req.inputType})` : ""} and \`input\` (an alias of \`event\`)`,
  ];
  if (req.scope.length > 0) {
    scopeVars.push(`upstream results as consts: ${req.scope.join(", ")}`);
  }
  if (req.kind === "waitForCondition" || req.field === "stopCondition") {
    scopeVars.push("`state` (the current polling state)");
  }
  if (req.field === "submitterCode") scopeVars.push("`callbackId` (string)");
  if (req.field === "fallbackCode") scopeVars.push("`err` (the caught error)");

  const lines = [
    "You are an expert TypeScript developer writing code for a single node of an",
    "AWS Lambda durable-execution workflow (the @aws/durable-execution-sdk-js SDK).",
    "",
    `Node "${req.name}" (kind: ${req.kind}). Write ${fieldPurpose(req)}.`,
    "",
    "In scope (do NOT redeclare these):",
    ...scopeVars.map((v) => `- ${v}`),
    "",
    "Rules:",
    "- Output TypeScript ONLY — no markdown fences, no comments-only answers, no prose.",
    expression
      ? "- Output a single expression (no statements, no `return`, no semicolon)."
      : "- Output statements only (not wrapped in a function). Use `return` for the result.",
    "- Do not import the SDK or redeclare in-scope names.",
    "- For AWS access use the AWS SDK **v3** (`@aws-sdk/client-*`), which the Lambda",
    "  Node.js runtime provides. NEVER use `aws-sdk` (v2) or `require('aws-sdk')`.",
    "  Since this is a function body (no top-level imports), require the client",
    '  inline, e.g. `const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");`.',
    "- When invoking another Lambda with `@aws-sdk/client-lambda` InvokeCommand,",
    "  the response `Payload` is a **Uint8Array**, not a string: decode it with",
    "  `new TextDecoder().decode(response.Payload)` before `JSON.parse`. (The IAM",
    "  action needed is `lambda:InvokeFunction`.) Prefer a chainInvoke node over",
    "  invoking a Lambda by hand when the workflow already models it.",
    "- If this code runs inside a map/iteration, the current array element is",
    "  `item` (with `index`); operate on `item`, not the whole upstream input.",
    "- Prefer deterministic, side-effect-free code.",
  ];
  if (req.currentCode && req.currentCode.trim()) {
    lines.push("", "Current code to improve or replace:", req.currentCode);
  }
  lines.push("", `Task: ${req.description}`);
  return lines.join("\n");
}

/** Generates the code for one node field via the configured LLM provider. */
export async function generateNodeCode(
  opts: AgentLlmOptions,
  req: NodeCodeRequest,
): Promise<string> {
  const raw = await completeText(opts, buildPrompt(req), 1024);
  const code = stripFences(raw);
  if (!code) throw new Error("The model returned an empty response.");
  return code;
}

/** Per-kind field cheat-sheet for the workflow-generation prompt. */
const KIND_FIELDS = [
  "start / end: markers (exactly one start; `end` terminates a path).",
  "step: `code` (TS body that returns the result).",
  'wait: `durationValue` (number) + `durationUnit` ("seconds"|"minutes"|"hours"|"days").',
  "callback: `submitterCode` (sends `callbackId` to an external system).",
  "chainInvoke: `functionArn` (qualified Lambda ARN) + `payload` (JSON).",
  "inline: `code` (deterministic TypeScript run inline between durable ops; its return value binds for downstream nodes — no checkpoint/retry, no I/O or non-determinism).",
  "waitForCondition: `code` (returns next `state`), `initialState` (JSON), `stopCondition` (boolean expression over `state`).",
  "condition: `code` (an expression); outgoing edges carry a `match` to compare against, one matchless edge is the default.",
  "map: `itemsCode` (returns the array) + `body` (a nested workflow; current element is `item`).",
  "group: `body` (a nested workflow run in a child context).",
  "parallel: `branches` (array of `{ id, name, body }`, each `body` a nested workflow).",
].join("\n  - ");

function buildWorkflowPrompt(description: string): string {
  return [
    "You are generating an AWS Lambda durable-execution workflow in the Workflow",
    "Studio `.dar` JSON format. Output a SINGLE JSON object and nothing else — no",
    "markdown fences, no prose.",
    "",
    "Top-level shape:",
    '{ "darVersion": "1.0", "name": string, "dependencyMode": "linear" | "dag",',
    '  "nodes": Node[], "edges": Edge[] }',
    "",
    "Every node has: `id` (unique string), `kind`, `name`, and `position` {x,y}.",
    `Valid kinds: ${DAR_NODE_KINDS.join(", ")}.`,
    "Kind-specific fields:",
    `  - ${KIND_FIELDS}`,
    "",
    'Edges: { id, source (node id), target (node id), kind?: "error", match?,',
    "errorType? }. Connect the nodes into a flow: exactly one `start`, ending at",
    "`end` node(s). For linear workflows each node has one outgoing flow edge.",
    'An `"error"`-kind edge routes when its source fails (optional `errorType`',
    "names the error class; absent = any error).",
    "",
    "Keep the output COMPACT:",
    "- OMIT `position` on every node — the Studio auto-layouts the graph.",
    "- OMIT `retry`/`wait` strategy objects unless the task needs custom retries",
    "  (sensible defaults are applied).",
    "- No comments, no markdown, no explanation — the JSON object only.",
    "",
    "Code rules (for `code`/`itemsCode`/`submitterCode`):",
    "- TypeScript that references `event`/`input` and upstream results by name.",
    "- An upstream node's result identifier is its `name` with every character",
    '  outside [A-Za-z0-9_$] replaced by `_` (e.g. node "fraud-check" =>',
    '  `fraud_check`). Prefer camelCase node names (e.g. "fraudCheck") so the',
    "  identifier matches the name exactly, and reference EXACTLY that identifier.",
    "- For AWS access use AWS SDK v3 (`@aws-sdk/client-*`) required inline; NEVER",
    "  `aws-sdk` (v2). Keep step code deterministic.",
    "- Lambda InvokeCommand: `response.Payload` is a Uint8Array — decode with",
    "  `new TextDecoder().decode(response.Payload)` before JSON.parse. Prefer a",
    "  chainInvoke node for calling another Lambda.",
    "- Inside a map body, use the current element `item` (and `index`).",
    "",
    "JSON Schema (structural reference):",
    JSON.stringify(DAR_JSON_SCHEMA),
    "",
    `Build this workflow: ${description}`,
  ].join("\n");
}

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Node fields whose strings are code executed by the generated handler. */
const REPAIRABLE_CODE_FIELDS = [
  "code",
  "submitterCode",
  "itemsCode",
  "stopCondition",
];

type LooseWf = {
  nodes?: Record<string, unknown>[];
  [key: string]: unknown;
};

/** Result-const identifiers of every operation node, container bodies included. */
function allResultIdentifiers(wf: LooseWf): string[] {
  const out = new Set<string>();
  const walk = (w: LooseWf) => {
    for (const n of w.nodes ?? []) {
      const kind = n.kind as string;
      const name = n.name as string;
      if (kind !== "start" && kind !== "end" && typeof name === "string") {
        out.add(toIdentifier(name));
      }
      if (n.body) walk(n.body as LooseWf);
      for (const b of (n.branches as { body?: LooseWf }[]) ?? []) {
        if (b.body) walk(b.body);
      }
    }
  };
  walk(wf);
  return [...out].sort();
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Deterministic repair for the most common model mistake: code referencing an
 * upstream result by a near-miss of its sanitized identifier (e.g.
 * `fraudCheck` vs node "fraud-check" → `fraud_check`). When `undef` matches
 * exactly one valid identifier after case/underscore folding, rewrites every
 * code field and returns the fixed JSON — no LLM round-trip. Returns null when
 * no unambiguous repair exists.
 */
export function repairUndefinedIdentifier(
  workflowJson: string,
  undef: string,
): string | null {
  const wf = JSON.parse(workflowJson) as LooseWf;
  const fold = (s: string) => s.toLowerCase().replace(/[_$]/g, "");
  const candidates = allResultIdentifiers(wf).filter(
    (id) => id !== undef && fold(id) === fold(undef),
  );
  if (candidates.length !== 1) return null;
  const re = new RegExp(`\\b${escapeRe(undef)}\\b`, "g");
  let changed = false;
  const walk = (w: LooseWf) => {
    for (const n of w.nodes ?? []) {
      for (const f of REPAIRABLE_CODE_FIELDS) {
        const v = n[f];
        if (typeof v === "string" && re.test(v)) {
          n[f] = v.replace(re, candidates[0]);
          changed = true;
        }
      }
      for (const b of (n.onError as { fallbackCode?: string }[]) ?? []) {
        if (typeof b.fallbackCode === "string" && re.test(b.fallbackCode)) {
          b.fallbackCode = b.fallbackCode.replace(re, candidates[0]);
          changed = true;
        }
      }
      if (n.body) walk(n.body as LooseWf);
      for (const b of (n.branches as { body?: LooseWf }[]) ?? []) {
        if (b.body) walk(b.body);
      }
    }
  };
  walk(wf);
  return changed ? JSON.stringify(wf) : null;
}

/** Extracts the identifier from a "<X> is not defined" dry-run error. */
function undefinedIdentifierIn(errors: string[]): string | undefined {
  for (const e of errors) {
    const m = e.match(/([A-Za-z_$][\w$]*) is not defined/);
    if (m) return m[1];
  }
  return undefined;
}

/** Rewrites esbuild's `<stdin>:L:C` to a line number inside the block (the
 * wrapper adds one leading line) and drops the "Transform failed" preamble. */
function cleanBlockError(raw: string): string {
  return raw
    .replace(/^Transform failed with \d+ errors?:\s*/i, "")
    .replace(
      /<stdin>:(\d+):(\d+):\s*(ERROR:)?\s*/g,
      (_m, l) => `line ${Math.max(1, Number(l) - 1)}: `,
    )
    .trim();
}

/** How each code-bearing field is wrapped by the code generator. */
function blockWrap(kind: string, field: string): "async" | "sync" | "expr" {
  if (field === "stopCondition" || field === "initialState") return "expr";
  if (field === "itemsCode" || field === "durationCode") return "sync";
  if (field === "fallbackCode" || field === "submitterCode") return "async";
  // `code`: async for step/waitForCondition; sync (deterministic, no await)
  // for inline/condition/end.
  return kind === "inline" || kind === "condition" || kind === "end"
    ? "sync"
    : "async";
}

/**
 * Syntax-checks every code block individually, wrapped exactly as the code
 * generator emits it, so errors point at a **node and field** instead of an
 * opaque line in the generated handler — feedback a model (or a person) can
 * actually act on.
 */
/** True when `t` parses as a TypeScript *type* (esbuild is too lenient for
 *  type positions, so this uses the TS compiler's own diagnostics). */
function isValidType(t: string): boolean {
  const res = ts.transpileModule(`type __T = (${t});`, {
    reportDiagnostics: true,
  });
  return (res.diagnostics ?? []).length === 0;
}

export async function codeBlockSyntaxErrors(wf: LooseWf): Promise<string[]> {
  const errors: string[] = [];
  const check = async (
    nodeName: string,
    field: string,
    body: string,
    wrap: "async" | "sync" | "expr",
  ) => {
    const src =
      wrap === "expr"
        ? `const __x = (\n${body}\n);`
        : `${wrap === "async" ? "async " : ""}() => {\n${body}\n};`;
    try {
      await transform(src, { loader: "ts" });
    } catch (e) {
      errors.push(
        `Node "${nodeName}" field \`${field}\` has a syntax error: ${cleanBlockError(msg(e))}`,
      );
    }
  };
  const walk = async (w: LooseWf) => {
    for (const n of w.nodes ?? []) {
      const kind = n.kind as string;
      const name = (n.name as string) || (n.id as string);
      for (const field of [
        "code",
        "submitterCode",
        "itemsCode",
        "durationCode",
        "stopCondition",
        "initialState",
      ]) {
        const v = n[field];
        if (typeof v === "string" && v.trim() !== "") {
          await check(name, field, v, blockWrap(kind, field));
        }
      }
      for (const b of (n.onError as { fallbackCode?: string }[]) ?? []) {
        if (
          typeof b.fallbackCode === "string" &&
          b.fallbackCode.trim() !== ""
        ) {
          await check(name, "fallbackCode", b.fallbackCode, "async");
        }
      }
      // Type-position fields must be valid TS *types* — they interpolate into
      // annotations, so anything else is rejected here (injection guard).
      const rt = n.resultType;
      if (typeof rt === "string" && rt.trim() !== "" && !isValidType(rt)) {
        errors.push(
          `Node "${name}" field \`resultType\` is not a valid TypeScript type: ${rt}`,
        );
      }
      if (n.body) await walk(n.body as LooseWf);
      for (const b of (n.branches as { body?: LooseWf }[]) ?? []) {
        if (b.body) await walk(b.body);
      }
    }
  };
  await walk(wf);
  const it = (wf as { inputType?: unknown }).inputType;
  if (typeof it === "string" && it.trim() !== "" && !isValidType(it)) {
    errors.push(
      `The workflow \`inputType\` is not a valid TypeScript type: ${it}`,
    );
  }
  return errors;
}

/**
 * Worker script: runs a transpiled generated handler against a MOCK durable SDK
 * so the orchestration executes with zero real I/O — step / invoke / callback /
 * waitForCondition return placeholders (their bodies are never called) and
 * `@aws-sdk/*` is never loaded. Container ops (map/parallel/child context) do
 * run their sub-orchestration so nesting is exercised. Reports the first error.
 */
const DRY_RUN_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const JitterStrategy = { NONE: "NONE", FULL: "FULL", HALF: "HALF" };
function makeCtx() {
  return {
    logger: { info(){}, debug(){}, warn(){}, error(){}, trace(){} },
    step: async () => ({}),
    wait: async () => {},
    waitForCondition: async () => ({}),
    invoke: async () => ({}),
    waitForCallback: async () => ({}),
    runInChildContext: async (a, b) => {
      const fn = typeof a === "function" ? a : b;
      return typeof fn === "function" ? fn(makeCtx()) : {};
    },
    map: async (a, b, c) => {
      const items = Array.isArray(a) ? a : Array.isArray(b) ? b : [];
      const fn = [a, b, c].find((x) => typeof x === "function");
      const results = [];
      if (fn) for (let i = 0; i < Math.min(items.length, 1); i++) {
        results.push(await fn(makeCtx(), items[i], i, items));
      }
      return { getResults: () => results, throwIfError: () => {} };
    },
    parallel: async (a, b) => {
      const branches = Array.isArray(a) ? a : Array.isArray(b) ? b : [];
      const results = [];
      for (const br of branches) {
        if (br && typeof br.func === "function") results.push(await br.func(makeCtx()));
      }
      return { getResults: () => results, throwIfError: () => {} };
    },
    // DAG scopes. The builder handed to the callback registers tasks and returns
    // a chainable handle, so dag.step(...).after(x) works; nothing is actually
    // scheduled, since the dry run only has to prove the ORCHESTRATION code
    // runs. Without this, every dag-mode workflow failed validation with
    // "context.dag is not a function" - the mock was never updated when dag
    // mode landed, and no CI job ran the suites that said so.
    dag: async (a, b) => {
      const fn = typeof a === "function" ? a : b;
      const handle = () => {
        const h = {
          after: () => h,
          onError: () => h,
          runIf: () => h,
        };
        return h;
      };
      const builder = {
        step: handle,
        wait: handle,
        invoke: handle,
        waitForCallback: handle,
        waitForCondition: handle,
        map: handle,
        parallel: handle,
        runInChildContext: handle,
        dag: handle,
        logger: { info(){}, debug(){}, warn(){}, error(){}, trace(){} },
      };
      if (typeof fn === "function") await fn(builder);
      return {};
    },
  };
}
const mock = {
  withDurableExecution: (fn) => (event) => fn(event == null ? {} : event, makeCtx()),
  createRetryStrategy: () => ({}),
  createLinearRetryStrategy: () => ({}),
  createWaitStrategy: () => ({}),
  JitterStrategy,
};
const shimRequire = (id) => {
  if (id === "@aws/durable-execution-sdk-js") return mock;
  if (String(id).startsWith("@aws-sdk/")) {
    return new Proxy(function () {}, { get: () => function () {}, apply: () => ({}) });
  }
  // Deny by default for THIS binding: an unknown id gets an inert proxy, so
  // common "const x = require(...); x.y.z" patterns don't crash the run. Note
  // this covers the require binding only — see dryRun's doc comment for why
  // that is not containment.
  return new Proxy(function () {}, { get: () => function () {}, apply: () => ({}) });
};
// Neuter ambient I/O + process surface for the generated code.
try { globalThis.fetch = async () => { throw new Error("network is unavailable in the dry run"); }; } catch {}
try { process.env = {}; } catch {}
// Remove the ways generated code could reach a module loader or a compiler.
//
// This is what makes the source check in hasModuleEscape meaningful rather than
// cosmetic. import() is SYNTAX: it must appear literally in the source, which the
// source check sees. The only way to conjure it at run time is to compile a new
// string, so the compilers are removed here:
//   - Function / eval, plus Function.prototype.constructor, which is the same
//     object reached the long way round as [].constructor.constructor.
//   - process.mainModule / process.binding, which hand back a real require.
// With both halves in place, the three bypasses reported in review (a bare
// Function(...) with the token split across a concatenation, the constructor
// chain, and mainModule.require) have nowhere left to go.
// Captured BEFORE the swap below, so the worker can still compile the handler.
// It stays a worker-local binding: the generated code never receives it, and the
// routes it might otherwise reach it by (globalThis.Function,
// Function.prototype.constructor) are replaced.
const RealFunction = Function;
const blocked = (what) => function () { throw new Error(what + " is unavailable in the dry run"); };
try {
  const FunctionCtor = blocked("Function");
  globalThis.Function = FunctionCtor;
  // All FOUR function intrinsics, not just the plain one: async, generator and
  // async-generator functions are separate intrinsics with their own prototypes,
  // and each one's constructor compiles code just as Function does. Missing them
  // left (async function(){}).constructor(...) and
  // (function*(){}).constructor(...) as working escapes.
  for (const sample of [
    function () {},
    async function () {},
    function* () {},
    async function* () {},
  ]) {
    try {
      Object.defineProperty(Object.getPrototypeOf(sample), "constructor", { value: FunctionCtor, configurable: true, writable: true });
    } catch {}
  }
  globalThis.eval = blocked("eval");
} catch {}
try { delete process.mainModule; } catch {}
try { process.binding = blocked("process.binding"); } catch {}
// Node 22.3+ hands back a builtin directly, with no require and no compiler, so
// it sails past both the source check and everything neutered above.
try { process.getBuiltinModule = blocked("process.getBuiltinModule"); } catch {}
// Same family. Needs a native .node file on disk to be useful, but it is still a
// loader.
try { process.dlopen = blocked("process.dlopen"); } catch {}
// Availability, not confinement: process.abort() and process.exit() from a worker
// take down the WHOLE extension host, so a dry run of hostile code could kill the
// editor's Workflow Insight session. Cheap to remove, so remove them.
try { process.abort = blocked("process.abort"); } catch {}
try { process.exit = blocked("process.exit"); } catch {}
try { if (typeof module === "object" && module) module.constructor = undefined; } catch {}
(async () => {
  try {
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    const run = new RealFunction("require", "module", "exports", workerData.js);
    run(shimRequire, mod, mod.exports);
    const handler = mod.exports.handler || (mod.exports.default && mod.exports.default.handler);
    if (typeof handler !== "function") throw new Error("no exported handler function");
    await handler({});
    parentPort.postMessage({ ok: true });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) });
  }
})();
`;

/**
 * Executes a transpiled handler in a worker (mock SDK, hard timeout) to catch
 * orchestration runtime errors. Returns error messages ([] when it runs to
 * completion).
 *
 * ⚠️ NOT a security boundary. A worker thread shares the process's capabilities,
 * and the shimmed `require` only covers that one binding: dynamic `import()` is
 * syntax and cannot be shadowed, so `await import("node:child_process")` reaches
 * the real module (verified). The `env: {}` reset likewise does not protect
 * `~/.aws`.
 *
 * The mitigations here are therefore defence-in-depth, not containment: the mock
 * SDK and `require` shim stop ACCIDENTAL I/O, {@link hasModuleEscape} refuses
 * source that reaches for a module loader, and the timeout stops hangs. Since
 * the input is model output or an imported state machine rather than something
 * the user typed, a real boundary would be a child process under Node's
 * permission model (`--permission --allow-fs-read=<tmpdir>`), which needs a
 * Node floor this package does not yet set.
 */
/**
 * True when the source reaches for a module loader — the one escape the worker's
 * `require` shim provably cannot cover, since `import()` is syntax rather than a
 * binding. Text matching is a blunt instrument and not a boundary (see
 * {@link dryRun}); it exists so the known escape is refused rather than run.
 */
export function hasModuleEscape(js: string): boolean {
  return (
    // import() is syntax, so it has to appear literally to work at all — which
    // is precisely why removing the compilers in the worker (see the preamble)
    // makes this check load-bearing instead of decorative.
    /\bimport\s*\(/.test(js) ||
    /\bimport\s*\.\s*meta\b/.test(js) ||
    // Compilers, with or without `new`. A CALLED `.constructor(...)` covers both
    // the `[].constructor.constructor` chain and the separate async / generator /
    // async-generator intrinsics, whose prototypes each carry their own
    // code-compiling constructor. Reading `.constructor` as a property (e.g.
    // `obj.constructor.name`) is ordinary and stays allowed.
    /\bFunction\s*\(/.test(js) ||
    /\.\s*constructor\s*\(/.test(js) ||
    /\beval\s*\(/.test(js) ||
    // Handles that return a real require, or a builtin outright.
    /\bcreateRequire\b/.test(js) ||
    /\bmainModule\b/.test(js) ||
    /\bgetBuiltinModule\b/.test(js) ||
    /\bdlopen\b/.test(js) ||
    /\bprocess\s*\.\s*binding\b/.test(js)
  );
}

function dryRun(js: string): Promise<string[]> {
  if (hasModuleEscape(js)) {
    return Promise.resolve([
      "Dry run refused: the generated code uses a dynamic import or a " +
        "Function constructor, which the validation run does not allow.",
    ]);
  }
  const dir = mkdtempSync(join(tmpdir(), "wf-dryrun-"));
  const workerFile = join(dir, "dryRunWorker.cjs");
  writeFileSync(workerFile, DRY_RUN_WORKER, "utf-8");
  return new Promise((resolve) => {
    let settled = false;
    // Empty env: the generated code must not see the host's AWS credentials.
    const worker = new Worker(workerFile, { workerData: { js }, env: {} });
    const done = (errors: string[]) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      resolve(errors);
    };
    const timer = setTimeout(
      () =>
        done([
          "Dry run timed out — the workflow orchestration may loop forever.",
        ]),
      5000,
    );
    worker.on("message", (m: { ok: boolean; error?: string }) => {
      clearTimeout(timer);
      done(m.ok ? [] : [`Dry run failed: ${m.error}`]);
    });
    worker.on("error", (e) => {
      clearTimeout(timer);
      done([`Dry run error: ${e.message}`]);
    });
  });
}

/**
 * Validates a candidate `.dar` JSON string through the same pipeline a deploy
 * uses — JSON parse -> `parseWorkflow` (structure) -> `generateHandler`
 * (identifier clashes / unsupported shapes) -> esbuild transpile of the
 * generated handler (syntax) -> a sandboxed mock dry-run (orchestration runtime
 * errors). Returns the normalized workflow JSON plus any errors, so the caller
 * can feed the errors back to the model.
 */
export async function validateDarJson(
  json: string,
): Promise<{ workflow?: string; errors: string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // A cut-off object almost always means the completion hit its token
    // budget — steer the retry toward compactness, not just "invalid JSON".
    const truncated = !json.trimEnd().endsWith("}");
    return {
      errors: [
        truncated
          ? "Output was truncated mid-JSON (too long). Produce a MORE COMPACT workflow: omit every `position`, omit `retry`/`wait` objects, shorten code bodies."
          : `Output is not valid JSON: ${msg(e)}`,
      ],
    };
  }
  let workflow;
  try {
    workflow = parseWorkflow(parsed);
  } catch (e) {
    return { errors: [`Not a valid .dar workflow: ${msg(e)}`] };
  }
  // Per-block syntax check first: attributes errors to a node + field (the
  // whole-handler transpile below only yields opaque generated-code lines).
  const blockErrors = await codeBlockSyntaxErrors(
    workflow as unknown as LooseWf,
  );
  if (blockErrors.length > 0) {
    return { workflow: JSON.stringify(workflow, null, 2), errors: blockErrors };
  }
  let handler = "";
  try {
    handler = generateHandler(workflow);
  } catch (e) {
    return {
      workflow: JSON.stringify(workflow, null, 2),
      errors: [`Code generation failed: ${msg(e)}`],
    };
  }
  let js = "";
  try {
    js = (await transform(handler, { loader: "ts", format: "cjs" })).code;
  } catch (e) {
    // Backstop (block checks passed but composition broke): include the
    // offending generated lines so the feedback is actionable anyway.
    let detail = msg(e);
    const at = detail.match(/<stdin>:(\d+):\d+/);
    if (at) {
      const lines = handler.split("\n");
      const i = Number(at[1]) - 1;
      const ctx = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      detail += `\nGenerated code around the error:\n${ctx}`;
    }
    return {
      workflow: JSON.stringify(workflow, null, 2),
      errors: [`Generated step code has a syntax error: ${detail}`],
    };
  }
  const errors = await dryRun(js);
  return { workflow: JSON.stringify(workflow, null, 2), errors };
}

const MAX_WORKFLOW_ATTEMPTS = 3;

/**
 * Generates a whole workflow `.dar` (JSON text) from a description, then
 * validates it (parse + codegen + transpile) and, if it fails, feeds the
 * generated workflow plus the validation errors back to the model — up to
 * {@link MAX_WORKFLOW_ATTEMPTS} times — before giving up.
 */
export async function generateWorkflowDar(
  opts: AgentLlmOptions,
  description: string,
): Promise<string> {
  const base = buildWorkflowPrompt(description);
  let prompt = base;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < MAX_WORKFLOW_ATTEMPTS; attempt += 1) {
    const raw = stripFences(await completeText(opts, prompt, 32768));
    let { workflow, errors } = await validateDarJson(raw);
    if (workflow && errors.length === 0) return workflow;

    // Deterministic repair — the most common failure is code referencing an
    // upstream result by a near-miss of its sanitized identifier. Fix those
    // locally (re-validating each time) before burning an LLM attempt.
    for (let fix = 0; workflow && fix < 5; fix += 1) {
      const undef = undefinedIdentifierIn(errors);
      if (!undef) break;
      const repaired = repairUndefinedIdentifier(workflow, undef);
      if (!repaired) break;
      const again = await validateDarJson(repaired);
      if (!again.workflow) break;
      workflow = again.workflow;
      errors = again.errors;
      if (errors.length === 0) return workflow;
    }

    lastErrors = errors.length
      ? errors
      : ["The output was not a valid workflow."];
    // When code still references something undefined, tell the model exactly
    // which identifiers exist — "X is not defined" alone doesn't converge.
    if (workflow && undefinedIdentifierIn(lastErrors)) {
      const ids = allResultIdentifiers(JSON.parse(workflow) as LooseWf);
      lastErrors = [
        ...lastErrors,
        `The identifiers in scope are: event, input${
          ids.length ? `, ${ids.join(", ")}` : ""
        }. Reference upstream results by EXACTLY these names (they are the node names sanitized to [A-Za-z0-9_$]).`,
      ];
    }
    prompt =
      `${base}\n\nYour previous answer had these problems:\n` +
      lastErrors.map((e) => `- ${e}`).join("\n") +
      `\n\nPrevious output:\n${raw}\n\n` +
      "Return ONLY a corrected, complete JSON object that fixes every problem above.";
  }
  throw new Error(
    `Couldn't generate a valid workflow after ${MAX_WORKFLOW_ATTEMPTS} attempts:\n` +
      lastErrors.map((e) => `- ${e}`).join("\n"),
  );
}
