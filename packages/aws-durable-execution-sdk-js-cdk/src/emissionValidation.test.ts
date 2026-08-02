import { generateHandler } from "./generateHandler";
import { RESERVED_IDENTIFIERS } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import type { DarWorkflow } from "./darModel";

const wf = (node: unknown): DarWorkflow =>
  ({
    darVersion: "1",
    name: "w",
    dependencyMode: "linear",
    nodes: [{ ...(node as object), terminal: true }],
    edges: [],
  }) as unknown as DarWorkflow;

/**
 * The SDK client package lands verbatim in an `import … from "<pkg>"` specifier.
 * `clientClass` and `command` beside it were already validated; the specifier was
 * not. JSON.stringify stops a syntax breakout, so the risk is what the BUNDLER
 * does: a `.dar` from a model or an ASL import can name any module, including a
 * relative path, and esbuild resolves and bundles it. It failed closed only when
 * the module happened to be unresolvable, which is not a control.
 */
describe("awsSdkCall client package", () => {
  const call = (clientPackage: string) =>
    wf({
      id: "a",
      kind: "awsSdkCall",
      name: "A",
      clientPackage,
      clientClass: "S3Client",
      command: "PutObjectCommand",
    });

  it("accepts a real AWS SDK v3 client package", () => {
    expect(generateHandler(call("@aws-sdk/client-s3"))).toContain(
      "@aws-sdk/client-s3",
    );
  });

  it.each([
    ["a relative path", "./evil"],
    ["an absolute path", "/tmp/evil"],
    ["an arbitrary package", "left-pad"],
    ["a lookalike scope", "@aws-sdk-evil/client-s3"],
    ["a non-client aws-sdk module", "@aws-sdk/credential-providers"],
  ])("rejects %s", (_label, pkg) => {
    expect(() => generateHandler(call(pkg))).toThrow(
      /not an AWS SDK v3 client package/,
    );
  });
});

/**
 * `url` is emitted inside a template literal with `${` deliberately preserved, so
 * it is an expression position — but unlike headers/query/body on the same node it
 * never reached requireExpression. An httpCall node has no `code` field, so a
 * reviewer sees only a URL: exactly the one-line-field threat the other validation
 * exists for.
 */
describe("httpCall url interpolations", () => {
  const http = (url: string) =>
    wf({ id: "h", kind: "httpCall", name: "H", method: "GET", url });

  it("accepts a plain url", () => {
    expect(generateHandler(http("https://api.example.com/v1"))).toContain(
      "https://api.example.com/v1",
    );
  });

  it("accepts an interpolated upstream value", () => {
    expect(
      generateHandler(http("https://api.example.com/${input.id}")),
    ).toContain("input.id");
  });

  it("rejects a statement in an interpolation", () => {
    expect(() => generateHandler(http("https://x/${ return 1; }"))).toThrow(
      /url/,
    );
  });

  it("rejects a closed-off interpolation that resumes code after it", () => {
    expect(() =>
      generateHandler(http("https://x/${1} ${ };evil();//")),
    ).toThrow(/url/);
  });

  it("accepts a parenthesized comma sequence, as the sibling fields do", () => {
    // Worth stating plainly: `(a, b)` is ONE expression, so requireExpression
    // admits it here exactly as it does for headers/query/body. This check buys
    // parity with those fields, not a stronger guarantee than them. Anything
    // reachable through a comma sequence is reachable through all four, and step
    // code is raw by design, so this is not a privilege boundary.
    expect(generateHandler(http("https://x/${(input.a, input.b)}"))).toContain(
      "input.b",
    );
  });

  it("rejects an unterminated interpolation", () => {
    expect(() => generateHandler(http("https://x/${"))).toThrow(/url/);
  });
});

/**
 * Bindings the emitters inject around a node's own content. In dag mode the deps
 * shim and the body share one block, so an upstream node named `url` produced
 * `const url = deps["url"]; const url = new URL(...)` — a syntax error. In linear
 * mode it degrades to a TDZ ReferenceError.
 *
 * Plus the strict-mode-only reserved words: the generated handler is an ES module,
 * so `const public = 1` is a SyntaxError, and a node named `public` previously
 * failed at bundle time with an opaque esbuild error rather than the clear rename
 * message.
 */
describe("RESERVED_IDENTIFIERS covers what codegen injects", () => {
  it.each([
    "url",
    "query",
    "headers",
    "payload",
    "response",
    "text",
    "startInput",
    "started",
    "jobId",
    "final",
    "client",
    "res",
  ])("reserves the injected binding %s", (name) => {
    expect(RESERVED_IDENTIFIERS.has(name)).toBe(true);
  });

  it.each([
    "public",
    "private",
    "protected",
    "static",
    "interface",
    "implements",
    "package",
    "arguments",
    "eval",
  ])("reserves the strict-mode reserved word %s", (name) => {
    expect(RESERVED_IDENTIFIERS.has(name)).toBe(true);
  });

  it("raises the clear rename error rather than emitting a clash", () => {
    expect(() =>
      generateHandler(
        wf({ id: "n", kind: "step", name: "url", code: "return 1;" }),
      ),
    ).toThrow(/reserved|rename/i);
  });
});
