import * as ts from "typescript";
import { generateHandler } from "./generateHandler";
import type { DarWorkflow } from "./darModel";

/**
 * Every other test in this package asserts on generated STRINGS, or at most that the
 * output has no parse errors. That is why a whole class of defect stayed invisible:
 * values that validated cleanly but emitted code which could not run, and DAG codegen
 * calling an SDK runtime that does not exist.
 *
 * This suite compiles a generated handler and RUNS it against a mock DurableContext,
 * so the assertions are about behaviour: which operations ran, in what order, with what
 * results threaded between them.
 *
 * It intentionally does not depend on the real SDK — the mock is the contract's shape,
 * which keeps the test fast and makes a signature drift show up as a failure here
 * rather than at deploy time.
 */
type Recorded = { op: string; name?: string; extra?: unknown };

function makeContext(recorded: Recorded[]) {
  const ctx = {
    step: async (a: unknown, b?: unknown) => {
      const [name, fn] =
        typeof a === "string"
          ? [a, b as (c: unknown) => unknown]
          : [undefined, a as (c: unknown) => unknown];
      recorded.push({ op: "step", name });
      return fn({ logger: { info() {}, debug() {} } });
    },
    wait: async (a: unknown, b?: unknown) => {
      const [name, spec] = typeof a === "string" ? [a, b] : [undefined, a];
      recorded.push({ op: "wait", name, extra: spec });
    },
    invoke: async (name: string, arn: string, payload: unknown) => {
      recorded.push({ op: "invoke", name, extra: { arn, payload } });
      return { invoked: arn };
    },
    runInChildContext: async (
      name: string,
      fn: (c: unknown) => Promise<unknown>,
    ) => {
      recorded.push({ op: "runInChildContext", name });
      return fn(ctx);
    },
    logger: { info() {}, debug() {} },
  };
  return ctx;
}

/** Transpiles the generated TS and evaluates it, returning its exported handler. */
function loadHandler(code: string): (event: unknown, ctx: unknown) => unknown {
  // Strip the SDK import: withDurableExecution is supplied by the harness below, so
  // the test needs no dependency on the runtime package.
  const withoutImports = code.replace(
    /^import[\s\S]*?from\s+"[^"]*";\s*$/gm,
    "",
  );
  const js = ts.transpileModule(withoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const withDurableExecution = (fn: unknown) => fn;
  // eslint-disable-next-line no-new-func
  new Function(
    "exports",
    "withDurableExecution",
    "JitterStrategy",
    "createRetryStrategy",
    "NestingType",
    js,
  )(
    exports,
    withDurableExecution,
    { FULL: "FULL", NONE: "NONE" },
    (c: unknown) => c,
    { FLAT: "FLAT", NESTED: "NESTED" },
  );
  return exports.handler as (event: unknown, ctx: unknown) => unknown;
}

const run = async (wf: DarWorkflow, event: unknown = {}) => {
  const recorded: Recorded[] = [];
  const result = await loadHandler(generateHandler(wf))(
    event,
    makeContext(recorded),
  );
  return { recorded, result };
};

describe("a generated linear handler actually runs", () => {
  it("executes steps in order and threads results between them", async () => {
    const { recorded, result } = await run({
      darVersion: "1.0",
      name: "chain",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "First", code: "return 2;" },
        { id: "b", kind: "step", name: "Second", code: "return First * 3;" },
        { id: "e", kind: "end", name: "done", code: "return Second;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "e" },
      ],
    } as unknown as DarWorkflow);

    expect(recorded.map((r) => `${r.op}:${r.name}`)).toEqual([
      "step:First",
      "step:Second",
    ]);
    // 2 * 3 — proves the emitted identifier binding actually carries the value.
    expect(result).toBe(6);
  });

  it("passes the event through as input", async () => {
    const { result } = await run(
      {
        darVersion: "1.0",
        name: "usesInput",
        dependencyMode: "linear",
        nodes: [
          { id: "s", kind: "start", name: "start" },
          {
            id: "a",
            kind: "step",
            name: "Echo",
            code: "return input.value + 1;",
            terminal: true,
          },
        ],
        edges: [{ id: "e1", source: "s", target: "a" }],
      } as unknown as DarWorkflow,
      { value: 41 },
    );
    expect(result).toBe(42);
  });

  it("runs a wait with the configured duration", async () => {
    const { recorded } = await run({
      darVersion: "1.0",
      name: "waits",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "w",
          kind: "wait",
          name: "Pause",
          durationValue: 30,
          durationUnit: "seconds",
        },
        {
          id: "a",
          kind: "step",
          name: "After",
          code: "return 1;",
          terminal: true,
        },
      ],
      edges: [
        { id: "e1", source: "s", target: "w" },
        { id: "e2", source: "w", target: "a" },
      ],
    } as unknown as DarWorkflow);

    expect(recorded[0]).toMatchObject({
      op: "wait",
      name: "Pause",
      extra: { seconds: 30 },
    });
  });

  it("evaluates a dynamic duration rather than emitting it unread", async () => {
    // The durationCode paths are exactly where the two validator defects lived, so
    // this asserts the emitted duration is a real value at runtime.
    const { recorded } = await run({
      darVersion: "1.0",
      name: "dynWait",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "w",
          kind: "wait",
          name: "Dyn",
          // dar-specification.md: durationCode returns the wait in SECONDS. Returning
          // a spec object here would emit `{ seconds: { seconds: 10 } }` — see the
          // separate guard test for that trap.
          durationCode: "return 5 * 2;",
          terminal: true,
        },
      ],
      edges: [{ id: "e1", source: "s", target: "w" }],
    } as unknown as DarWorkflow);

    expect(recorded[0]).toMatchObject({ op: "wait", extra: { seconds: 10 } });
  });

  it("takes the matching branch of a condition", async () => {
    const build = (value: string) =>
      ({
        darVersion: "1.0",
        name: "branch",
        dependencyMode: "linear",
        nodes: [
          { id: "s", kind: "start", name: "start" },
          {
            id: "c",
            kind: "condition",
            name: "Route",
            code: `return ${value};`,
          },
          {
            id: "y",
            kind: "step",
            name: "Yes",
            code: "return 'yes';",
            terminal: true,
          },
          {
            id: "n",
            kind: "step",
            name: "No",
            code: "return 'no';",
            terminal: true,
          },
        ],
        edges: [
          { id: "e1", source: "s", target: "c" },
          { id: "e2", source: "c", target: "y", match: "hit" },
          { id: "e3", source: "c", target: "n" },
        ],
      }) as unknown as DarWorkflow;

    expect((await run(build('"hit"'))).result).toBe("yes");
    expect((await run(build('"other"'))).result).toBe("no");
  });

  it("recovers through an error route and runs the rejoin tail once", async () => {
    // The reconvergence fix emits the rejoin tail on BOTH paths, so the thing to
    // verify at runtime is that only one copy executes.
    const { recorded, result } = await run({
      darVersion: "1.0",
      name: "recover",
      dependencyMode: "linear",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "a",
          kind: "step",
          name: "Boom",
          code: "throw new Error('boom');",
        },
        { id: "r", kind: "step", name: "Recover", code: "return 'recovered';" },
        { id: "j", kind: "step", name: "Rejoin", code: "return Recover;" },
      ],
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "e2", source: "a", target: "j" },
        { id: "e3", source: "a", target: "r", kind: "error" },
        { id: "e4", source: "r", target: "j" },
      ],
    } as unknown as DarWorkflow);

    const rejoins = recorded.filter((r) => r.name === "Rejoin");
    expect(rejoins).toHaveLength(1);
    expect(result).toBe("recovered");
  });
});

/**
 * Typed error routes matched with `err instanceof SomeError`, which could never work:
 * the durable SDK reconstructs a failure as a StepError whose `cause` is a plain Error
 * carrying the original type only in its `name`, so the original class is gone by the
 * time a catch block sees it. Worse, the class is usually not in scope in the generated
 * handler, making the emitted reference a latent ReferenceError.
 *
 * Routes now match by name along the cause chain. These run the handler against errors
 * shaped the way the SDK actually produces them.
 */
describe("typed error routes match real durable errors", () => {
  const routed = {
    darVersion: "1.0",
    name: "routed",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      { id: "a", kind: "step", name: "Risky", code: "return 1;" },
      {
        id: "r",
        kind: "step",
        name: "Recover",
        code: "return 'recovered';",
        terminal: true,
      },
    ],
    edges: [
      { id: "e1", source: "s", target: "a" },
      {
        id: "e2",
        source: "a",
        target: "r",
        kind: "error",
        errorType: "ValidationError",
      },
    ],
  } as unknown as DarWorkflow;

  /** A failure shaped as the SDK reconstructs it: StepError wrapping the real type. */
  const reconstructed = () => {
    const cause = new Error("bad input");
    cause.name = "ValidationError";
    const err = new Error("Step failed") as Error & { cause?: Error };
    err.name = "StepError";
    err.cause = cause;
    return err;
  };

  const runWith = async (thrown: Error) => {
    const handler = loadHandler(generateHandler(routed));
    const ctx = {
      step: async (n: string, fn: (c: unknown) => unknown) => {
        if (n === "Risky") throw thrown;
        return fn({ logger: { info() {}, debug() {} } });
      },
      logger: { info() {}, debug() {} },
    };
    return handler({}, ctx);
  };

  it("routes a reconstructed StepError by its original type", async () => {
    await expect(runWith(reconstructed())).resolves.toBe("recovered");
  });

  it("routes an error thrown directly with that name", async () => {
    const direct = new Error("bad");
    direct.name = "ValidationError";
    await expect(runWith(direct)).resolves.toBe("recovered");
  });

  it("does not route an unrelated error", async () => {
    const other = new Error("nope");
    other.name = "ThrottlingError";
    await expect(runWith(other)).rejects.toThrow("nope");
  });

  it("emits no bare class reference that could ReferenceError", () => {
    const code = generateHandler(routed);
    expect(code).not.toContain("instanceof ValidationError");
    expect(code).toContain('__darErrorIs(err, "ValidationError")');
  });
});
