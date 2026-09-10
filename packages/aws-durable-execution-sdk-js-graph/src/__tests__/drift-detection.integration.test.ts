import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { compileDurable } from "../runtime/compile-durable";
import { GraphDriftError } from "../runtime/errors";
import { StateGraph } from "../builder";
import { StateSchema, appendValue, START, END } from "../schema";
import { interrupt } from "../interrupt";

/**
 * Design doc §11 test 2 (Drift detection) and §5.4.
 *
 * We deliberately make a routing decision NON-DETERMINISTIC across a real replay boundary and
 * assert the driver raises {@link GraphDriftError} rather than silently re-executing a
 * different frontier.
 *
 * How the non-determinism is injected precisely (no process kill needed):
 *
 *   - `seed` runs at tick 0 and its conditional edge routes to either `alpha` or `beta` based
 *     on a MODULE-LEVEL flag `routeToBeta` — an impure input the router must never read, but
 *     does here on purpose. The routed-to node (`alpha`/`beta`) runs at tick 1 and interrupts.
 *   - On invocation 1 the flag is `false`: `seed` completes, `route()` yields `[alpha]`, and
 *     tick 1's attestation records `[alpha]` BEFORE `alpha` dispatches and suspends on its
 *     interrupt. The invocation ends there.
 *   - Between suspend and resume the test flips the flag to `true`. On invocation 2 (the
 *     resume) the loop replays from tick 0: `seed` replays, but `route()` now yields `[beta]`,
 *     so the driver recomputes tick 1's frontier as `[beta]`. The attestation step for tick 1
 *     replays the RECORDED `[alpha]`. `[alpha]` != `[beta]` → `GraphDriftError`, exactly the
 *     loud failure §5.4 demands.
 *
 * NOTE (POC finding): the interrupt MUST be in the routed-to node (tick 1), not in `seed`
 * (tick 0). If `seed` itself suspended, tick 1's frontier would first be computed only on the
 * resume invocation — there would be no pre-suspend attestation record to diverge from, and
 * the drift would go undetected. This is a concrete limitation of attestation-under-interrupt
 * and is documented in POC_FINDINGS.
 *
 * This is the concrete demonstration that the frontier-attestation safety net converts a
 * silent divergence into an explicit error under positional identity.
 */

let routeToBeta = false;

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

beforeEach(() => {
  routeToBeta = false;
});

describe("drift detection", () => {
  const schema = new StateSchema({ trail: appendValue<string>() });

  function buildDriftingGraph() {
    return (
      new StateGraph(schema, "drifting")
        .addNode("seed", async () => {
          // Runs to completion at tick 0 (no interrupt), so tick 1's frontier is routed and its
          // attestation recorded before any suspension.
          return { trail: "seed" };
        })
        .addNode("alpha", async (_state, nodeCtx) => {
          // Suspends at tick 1 so the resume invocation replays tick 0 and re-runs routing.
          await interrupt<string>(nodeCtx, "gate", async () => {});
          return { trail: "alpha" };
        })
        .addNode("beta", async (_state, nodeCtx) => {
          await interrupt<string>(nodeCtx, "gate", async () => {});
          return { trail: "beta" };
        })
        // IMPURE router (reads module-level flag) — the forced non-determinism.
        .addConditionalEdges("seed", () => (routeToBeta ? "beta" : "alpha"), [
          "alpha",
          "beta",
        ])
        .addEdge(START, "seed")
        .addEdge("alpha", END)
        .addEdge("beta", END)
        .compile()
    );
  }

  it("raises GraphDriftError when routing diverges between the original run and replay", async () => {
    const handler = compileDurable(buildDriftingGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const gateOp = runner.getOperation<string>("gate");
    const executionPromise = runner.run({ payload: { input: {} } });

    // Invocation 1 completed tick 0 (`seed`), recorded tick 1's frontier as [alpha], then
    // suspended inside `alpha` on its interrupt.
    await gateOp.waitForData(WaitingOperationStatus.SUBMITTED);

    // Inject the divergence: the resume invocation's router will now choose beta.
    routeToBeta = true;
    await gateOp.sendCallbackSuccess("approve");

    // The run() promise RESOLVES (the SDK surfaces failures on the result, not by rejecting the
    // run promise). The execution must have FAILED, and reading the result must throw the loud
    // drift error — never silently return the [beta] state.
    const result = await executionPromise;
    expect(result.getStatus()).not.toBe("Succeeded");
    expect(() => result.getResult()).toThrow(/frontier drift/i);
  });

  it("the raised error is a GraphDriftError carrying recorded vs computed frontiers", async () => {
    const handler = compileDurable(buildDriftingGraph());
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });

    const gateOp = runner.getOperation<string>("gate");
    const executionPromise = runner.run({ payload: { input: {} } });
    await gateOp.waitForData(WaitingOperationStatus.SUBMITTED);
    routeToBeta = true;
    await gateOp.sendCallbackSuccess("approve");

    const result = await executionPromise;

    // The drift message is preserved through the SDK error surface, with the structured detail
    // (recorded=[alpha], computed=[beta] at tick 1).
    let message = "";
    try {
      result.getResult();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/frontier drift/i);
    expect(message).toContain("tick 1");
    expect(message).toContain("alpha");
    expect(message).toContain("beta");
  });

  it("does NOT false-positive: a deterministic router replays cleanly through a suspend", async () => {
    // Control: same shape as the drift graph (seed at tick 0 routes to a node that interrupts at
    // tick 1), but the router is PURE (always alpha). The suspend/resume replay recomputes the
    // same frontier, attestation matches, and the execution succeeds.
    const pureSchema = new StateSchema({ trail: appendValue<string>() });
    const pure = new StateGraph(pureSchema, "pure")
      .addNode("seed", async () => ({ trail: "seed" }))
      .addNode("alpha", async (_state, nodeCtx) => {
        await interrupt<string>(nodeCtx, "gate", async () => {});
        return { trail: "alpha" };
      })
      .addConditionalEdges("seed", () => "alpha", ["alpha"])
      .addEdge(START, "seed")
      .addEdge("alpha", END)
      .compile();

    const handler = compileDurable(pure);
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const gateOp = runner.getOperation<string>("gate");
    const executionPromise = runner.run({ payload: { input: {} } });
    await gateOp.waitForData(WaitingOperationStatus.SUBMITTED);
    await gateOp.sendCallbackSuccess("approve");
    const result = await executionPromise;
    expect(result.getResult()).toEqual({ trail: ["seed", "alpha"] });
  });
});
