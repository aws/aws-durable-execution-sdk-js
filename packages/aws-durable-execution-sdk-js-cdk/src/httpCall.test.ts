import * as ts from "typescript";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

// These exercise DAG codegen, which is gated because the generated code calls a
// runtime the SDK does not implement yet (see dagModeAllowed). Opting in here
// keeps coverage of the generator while the gate protects real deploys.
//
// NOTE: these assert on generated STRINGS, so they cannot catch the missing
// runtime — that needs a test which INVOKES a generated handler against the real
// SDK. Tracked with the gate.
process.env.DAR_ALLOW_DAG_MODE = "1";

function wf(
  nodeExtra: Record<string, unknown>,
  dependencyMode?: "linear" | "dag",
): DarWorkflow {
  return {
    darVersion: "1",
    name: "http-wf",
    ...(dependencyMode ? { dependencyMode } : {}),
    nodes: [
      { id: "n1", kind: "httpCall", name: "create-charge", ...nodeExtra },
    ] as never,
    edges: [],
  };
}

/** Parses generated code to prove it is syntactically valid TypeScript. */
function parseErrors(code: string): number {
  const sf = ts.createSourceFile(
    "handler.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
  );
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics
    .length;
}

const base = {
  method: "POST",
  url: "https://api.stripe.com/v1/charges",
  body: '{ "amount": 2000, "currency": "usd" }',
  authKind: "bearer",
  authEnvVar: "STRIPE_API_KEY",
};

describe("httpCall codegen", () => {
  it("emits a durable step wrapping a single fetch", () => {
    const code = generateHandler(wf(base));
    expect(code).toContain('context.step("create-charge"');
    expect(code).toContain("await fetch(url, {");
    expect(code).toContain('method: "POST"');
    expect(parseErrors(code)).toBe(0);
  });

  it("reads the credential from process.env, never inlining it", () => {
    const code = generateHandler(wf(base));
    expect(code).toContain('process.env["STRIPE_API_KEY"]');
    expect(code).toContain("Authorization: `Bearer ${");
  });

  it("supports header, basic and query auth styles", () => {
    expect(
      generateHandler(
        wf({ ...base, authKind: "header", authName: "X-API-Key" }),
      ),
    ).toContain('["X-API-Key"]: process.env["STRIPE_API_KEY"]');
    expect(generateHandler(wf({ ...base, authKind: "basic" }))).toContain(
      'Buffer.from(process.env["STRIPE_API_KEY"] ?? "").toString("base64")',
    );
    const q = generateHandler(
      wf({ ...base, authKind: "query", authName: "api_key" }),
    );
    expect(q).toContain('query["api_key"] = process.env["STRIPE_API_KEY"]');
  });

  it("uppercases the method and rejects unknown verbs", () => {
    expect(generateHandler(wf({ ...base, method: "post" }))).toContain(
      'method: "POST"',
    );
    // Not in the whitelist — falls back to GET rather than emitting it raw.
    expect(generateHandler(wf({ ...base, method: "EVIL()" }))).toContain(
      'method: "GET"',
    );
  });

  it("omits a body for GET/HEAD", () => {
    const code = generateHandler(wf({ ...base, method: "GET" }));
    expect(code).not.toContain("const payload =");
    expect(code).not.toContain("body:");
  });

  it("evaluates the body expression exactly once", () => {
    const code = generateHandler(wf({ ...base, body: "buildPayload()" }));
    expect(code.match(/buildPayload\(\)/g)).toHaveLength(1);
    expect(code).toContain("const payload = buildPayload();");
  });

  it("interpolates upstream results in the url via a template literal", () => {
    const code = generateHandler(
      wf({ ...base, url: "https://api.x.com/v1/orders/${order_id}" }),
    );
    expect(code).toContain(
      "new URL(`https://api.x.com/v1/orders/${order_id}`)",
    );
    expect(parseErrors(code)).toBe(0);
  });

  it("escapes a url that would otherwise break out of the template", () => {
    const code = generateHandler(
      wf({ ...base, url: "https://x.com/`+evil()+`" }),
    );
    expect(code).toContain("\\`");
    expect(parseErrors(code)).toBe(0);
  });

  it("applies a request timeout when set", () => {
    expect(generateHandler(wf({ ...base, timeoutSeconds: 10 }))).toContain(
      "AbortSignal.timeout(10000)",
    );
  });

  it("throws when a url is missing", () => {
    expect(() => generateHandler(wf({ ...base, url: "" }))).toThrow(
      /missing a url/,
    );
  });

  it("refuses auth without an env var (no inline secrets)", () => {
    expect(() => generateHandler(wf({ ...base, authEnvVar: "" }))).toThrow(
      /must come from a Lambda environment variable/,
    );
  });

  it("rejects an authEnvVar that is a value or injection rather than a name", () => {
    expect(() =>
      generateHandler(wf({ ...base, authEnvVar: "sk_live_abc123" })),
    ).not.toThrow(); // a bare identifier-ish token is still a legal env NAME
    expect(() =>
      generateHandler(wf({ ...base, authEnvVar: '"] + evil() + ["' })),
    ).toThrow(/invalid authEnvVar/);
  });

  it("emits the same request in DAG mode", () => {
    const code = generateHandler(wf(base, "dag"));
    expect(code).toContain("await fetch(url, {");
    expect(code).toContain('process.env["STRIPE_API_KEY"]');
    expect(parseErrors(code)).toBe(0);
  });
});

/**
 * Regression: an API call's request fields interpolate upstream results just
 * like a code body does, but they were missing from `DEPENDENCY_CODE_FIELDS`.
 * The linear path happened to work (results are lexical consts), while DAG mode
 * silently bound the task HANDLE instead of its result — the worst kind of
 * failure, since the generated code still compiled.
 */
describe("httpCall upstream results", () => {
  const chained = (dependencyMode: "linear" | "dag"): DarWorkflow =>
    ({
      darVersion: "1",
      name: "chained",
      dependencyMode,
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "get-order",
          code: "return { total: 1 };",
        },
        {
          id: "b",
          kind: "httpCall",
          name: "charge",
          method: "POST",
          url: "https://api.stripe.com/v1/orders/${get_order}",
          body: '{ "amount": get_order.total }',
          authKind: "bearer",
          authEnvVar: "STRIPE_API_KEY",
        },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
      ],
    }) as never;

  it("linear: the upstream result is in lexical scope", () => {
    const code = generateHandler(chained("linear"));
    expect(code).toContain("const get_order = await context.step(");
    expect(code).toContain("orders/${get_order}");
    expect(parseErrors(code)).toBe(0);
  });

  it("dag: the upstream result is passed via deps and bound locally", () => {
    const code = generateHandler(chained("dag"));
    // Declared as a real result dependency, not an ordering-only .after().
    expect(code).toContain('dag.step("charge", [get_order]');
    // …and shimmed to the same identifier the author wrote.
    expect(code).toContain('const get_order = deps["get-order"];');
    expect(code).toContain("orders/${get_order}");
    expect(parseErrors(code)).toBe(0);
  });

  it("dag: a body expression also registers the dependency", () => {
    const noUrlRef = chained("dag");
    (noUrlRef.nodes[2] as unknown as Record<string, unknown>).url =
      "https://api.stripe.com/v1/charges";
    const code = generateHandler(noUrlRef);
    expect(code).toContain('dag.step("charge", [get_order]');
    expect(code).toContain('const get_order = deps["get-order"];');
  });

  it("dag: an unrelated node stays an ordering-only dependency", () => {
    const unrelated = chained("dag");
    const node = unrelated.nodes[2] as unknown as Record<string, unknown>;
    node.url = "https://api.stripe.com/v1/charges";
    node.body = '{ "amount": 100 }';
    const code = generateHandler(unrelated);
    expect(code).toContain('dag.step("charge", []');
    expect(code).not.toContain('deps["get-order"]');
  });
});
