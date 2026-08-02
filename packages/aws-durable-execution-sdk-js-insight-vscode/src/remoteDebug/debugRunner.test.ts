// Sibling-mocking style (see debugSessionCore.test.ts): jest.fn() consts up
// top, jest.mock factories referencing them, real imports after. The three
// collaborators each have their own suites — this file exercises ONLY the
// orchestration in debugRunner.ts.

const mockStartSession = jest.fn();
jest.mock("./debugSessionCore", () => ({
  startRemoteDebugSession: (...args: unknown[]) => mockStartSession(...args),
}));

const mockConnect = jest.fn();
jest.mock("./inspectorClient", () => ({
  InspectorClient: { connect: (...args: unknown[]) => mockConnect(...args) },
}));

const mockLoadMapBridge = jest.fn();
jest.mock("./mapBridge", () => ({
  loadMapBridge: (...args: unknown[]) => mockLoadMapBridge(...args),
}));

// Only existsSync is faked (the missing-map fast-fail check); everything
// else in node:fs stays real for the rest of the module graph.
const mockExistsSync = jest.fn();
jest.mock("node:fs", () => ({
  ...jest.requireActual("node:fs"),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

import { join } from "node:path";
import {
  startDebugRun,
  type DebugRunnerEvents,
  type DebugRunnerHandle,
} from "./debugRunner";

// ---------------------------------------------------------------- utils ----

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask/immediate queues so gated+chained pause handling and
 * invoke-settle handlers run to completion. */
async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

/** Global ordering trace: mocks push labels so tests can assert sequencing
 * (invoke before connect, breakpoints before runIfWaitingForDebugger, ...). */
const order: string[] = [];
const orderIndex = (label: string) => order.indexOf(label);

type InvokeResult = { statusCode?: number; payload: string; logTail?: string };

function makeMockClient() {
  const pausedCbs: Array<(p: unknown) => void> = [];
  const resumedCbs: Array<() => void> = [];
  const closedCbs: Array<() => void> = [];
  let bpCounter = 0;
  return {
    enable: jest.fn(async () => {
      order.push("enable");
    }),
    setBreakpointByUrl: jest.fn(async (_urlRegex: string, line0: number) => {
      order.push(`setBp:${line0}`);
      return { breakpointId: `bp-${++bpCounter}` };
    }),
    removeBreakpoint: jest.fn(async () => {}),
    resume: jest.fn(async () => {
      order.push("resume");
    }),
    stepOver: jest.fn(async () => {}),
    stepInto: jest.fn(async () => {}),
    stepOut: jest.fn(async () => {}),
    runIfWaitingForDebugger: jest.fn(async () => {
      order.push("run");
    }),
    getProperties: jest.fn(async () => [
      { name: "x", value: { type: "number", value: 42 } },
    ]),
    onPaused: jest.fn((cb: (p: unknown) => void) => pausedCbs.push(cb)),
    onResumed: jest.fn((cb: () => void) => resumedCbs.push(cb)),
    onClosed: jest.fn((cb: () => void) => closedCbs.push(cb)),
    dispose: jest.fn(),
    // Test-side triggers:
    firePause: (p: unknown) => pausedCbs.forEach((cb) => cb(p)),
    fireResumed: () => resumedCbs.forEach((cb) => cb()),
    /** The sandbox went away (its invocation ended) — what happens on every
     * durable suspend, and at the very end of an execution. */
    fireClosed: () => closedCbs.splice(0).forEach((cb) => cb()),
  };
}

function makeEvents(): jest.Mocked<DebugRunnerEvents> {
  return {
    onStatus: jest.fn(),
    onPaused: jest.fn(),
    onResumed: jest.fn(),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
}

// ------------------------------------------------------------- fixtures ----

/** dar line 5 → bundle lines 10 and 12; dar line 7 → bundle line 20;
 * dar line 99 → nothing (blank/comment line). Reverse: 10/12 → 5, 20 → 7. */
const DAR_TO_BUNDLE: Record<number, number[]> = { 5: [10, 12], 7: [20] };
const BUNDLE_TO_DAR: Record<number, number> = { 10: 5, 12: 5, 20: 7 };

let mockClient: ReturnType<typeof makeMockClient>;
let mockBridge: {
  darSource: string;
  darLineToBundleLines: jest.Mock;
  bundleLineToDarLine: jest.Mock;
  dispose: jest.Mock;
};
let invokeDeferred: ReturnType<typeof deferred<InvokeResult>>;
let mockCoreHandle: {
  port: number;
  functionQualifier: string;
  invoke: jest.Mock;
  dispose: jest.Mock;
};
let events: jest.Mocked<DebugRunnerEvents>;

const DEBUG_OUT_DIR = "/tmp/debug-out";

function baseOpts(initialBreakpointDarLines: number[] = [5]) {
  return {
    region: "us-east-1",
    credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
    functionName: "my-fn",
    payloadJson: '{"orderId":"12345"}',
    debugOutDir: DEBUG_OUT_DIR,
    initialBreakpointDarLines,
    events,
  };
}

/** A pause event whose top frame sits at BUNDLE line 10 (CDP 0-based 9). */
function breakpointPause(hitBreakpoints: string[] = ["bp-1"]) {
  return {
    reason: "other",
    hitBreakpoints,
    callFrames: [
      {
        functionName: "handler",
        location: { scriptId: "s1", lineNumber: 9 },
        url: "file:///var/task/index.js",
        scopeChain: [
          { type: "local", object: { objectId: "obj-1" } },
          { type: "global", object: {} },
        ],
      },
      {
        functionName: "runtimeMain",
        location: { scriptId: "s2", lineNumber: 199 },
        url: "file:///var/runtime/index.mjs",
        scopeChain: [],
      },
    ],
  };
}

const BREAK_ON_START = { reason: "Break on start", callFrames: [] };

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;

  mockExistsSync.mockReturnValue(true);

  mockBridge = {
    darSource: "workflow.dar.ts",
    darLineToBundleLines: jest.fn((line: number) => DAR_TO_BUNDLE[line] ?? []),
    bundleLineToDarLine: jest.fn((line: number) => BUNDLE_TO_DAR[line] ?? null),
    dispose: jest.fn(),
  };
  mockLoadMapBridge.mockResolvedValue(mockBridge);

  invokeDeferred = deferred<InvokeResult>();
  mockCoreHandle = {
    port: 5858,
    functionQualifier: "$LATEST",
    invoke: jest.fn(() => {
      order.push("invoke");
      return invokeDeferred.promise;
    }),
    dispose: jest.fn(async () => {}),
  };
  mockStartSession.mockResolvedValue(mockCoreHandle);

  mockClient = makeMockClient();
  mockConnect.mockImplementation(async (...args: unknown[]) => {
    order.push(`connect:${String(args[0])}`);
    return mockClient;
  });

  events = makeEvents();
});

async function startAndSettle(handle: DebugRunnerHandle): Promise<void> {
  invokeDeferred.resolve({ statusCode: 200, payload: "null" });
  await flush();
  await handle.stop();
}

// ---------------------------------------------------------------- tests ----

describe("missing source map — fast fail", () => {
  it("rejects before starting any session when index.js.map is absent", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(startDebugRun(baseOpts())).rejects.toThrow(
      /No source map found at .*index\.js\.map/,
    );

    expect(mockExistsSync).toHaveBeenCalledWith(
      join(DEBUG_OUT_DIR, "index.js.map"),
    );
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockLoadMapBridge).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe("happy path — startup sequencing", () => {
  it("fires invoke before connect, sets breakpoints before runIfWaitingForDebugger, auto-resumes break-on-start", async () => {
    const handle = await startDebugRun(baseOpts([5]));

    // Map loaded from the debug out-dir.
    expect(mockLoadMapBridge).toHaveBeenCalledWith(
      join(DEBUG_OUT_DIR, "index.js.map"),
    );

    // Session started with progress → onStatus passthrough.
    const sessionOpts = mockStartSession.mock.calls[0][0] as {
      region: string;
      functionName: string;
      onProgress: (m: string) => void;
    };
    expect(sessionOpts.region).toBe("us-east-1");
    expect(sessionOpts.functionName).toBe("my-fn");
    sessionOpts.onProgress("phase message");
    expect(events.onStatus).toHaveBeenCalledWith("phase message");

    // Invoke carries the payload and was fired UN-awaited BEFORE connect
    // (the sandbox+inspector only exist once an invoke starts).
    expect(mockCoreHandle.invoke).toHaveBeenCalledWith(
      '{"orderId":"12345"}',
      undefined,
    );
    expect(orderIndex("invoke")).toBeGreaterThanOrEqual(0);
    expect(orderIndex("invoke")).toBeLessThan(orderIndex("connect:5858"));

    // enable → breakpoints (dar 5 → bundle 10, 12 → CDP 0-based 9, 11) → run.
    expect(mockClient.setBreakpointByUrl).toHaveBeenCalledWith(
      ".*/var/task/index\\.js",
      9,
    );
    expect(mockClient.setBreakpointByUrl).toHaveBeenCalledWith(
      ".*/var/task/index\\.js",
      11,
    );
    expect(orderIndex("enable")).toBeLessThan(orderIndex("setBp:9"));
    expect(orderIndex("setBp:9")).toBeLessThan(orderIndex("run"));
    expect(orderIndex("setBp:11")).toBeLessThan(orderIndex("run"));

    // The wrapper's break-on-start: auto-resumed, never surfaced.
    mockClient.firePause(BREAK_ON_START);
    await flush();
    expect(mockClient.resume).toHaveBeenCalledTimes(1);
    expect(events.onPaused).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();

    await startAndSettle(handle);
  });
});

describe("breakpoint pauses", () => {
  it("surfaces a hit breakpoint with the TRANSLATED dar line, call stack, and scopes", async () => {
    const handle = await startDebugRun(baseOpts([5]));

    mockClient.firePause(BREAK_ON_START);
    await flush();
    mockClient.firePause(breakpointPause(["bp-1"]));
    await flush();

    expect(events.onPaused).toHaveBeenCalledTimes(1);
    expect(events.onPaused).toHaveBeenCalledWith({
      darLine: 5, // bundle line 10 translated back through the bridge
      bundleLine: 10,
      functionName: "handler",
      callStack: [
        { functionName: "handler", darLine: 5, bundleLine: 10 },
        // Runtime frame: not in the bundle → no dar line.
        { functionName: "runtimeMain", darLine: null, bundleLine: 200 },
      ],
      scopes: [
        { type: "local", objectId: "obj-1" },
        { type: "global", objectId: undefined },
      ],
    });
    // Only the break-on-start was auto-resumed; the breakpoint pause held.
    expect(mockClient.resume).toHaveBeenCalledTimes(1);

    // onResumed is emitted when the surfaced pause resumes.
    mockClient.fireResumed();
    expect(events.onResumed).toHaveBeenCalledTimes(1);

    await startAndSettle(handle);
  });

  it("auto-resumes pauses that hit nothing of ours, bounded at 50 with onError + teardown", async () => {
    await startDebugRun(baseOpts([5]));

    for (let i = 0; i < 50; i++) {
      mockClient.firePause({ reason: "exception", callFrames: [] });
    }
    await flush();

    // 49 resumes, then the bound trips: error + full stop.
    expect(mockClient.resume).toHaveBeenCalledTimes(49);
    expect(events.onError).toHaveBeenCalledWith(
      expect.stringContaining("50 consecutive pauses"),
    );
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
    expect(mockClient.dispose).toHaveBeenCalledTimes(1);
    expect(events.onPaused).not.toHaveBeenCalled();
  });
});

describe("invoke settlement", () => {
  it("emits onDone and tears everything down (core dispose included) when the invoke resolves", async () => {
    await startDebugRun(baseOpts([5]));

    invokeDeferred.resolve({
      statusCode: 200,
      payload: '{"ok":true}',
      logTail: "START\nEND",
    });
    await flush();

    expect(events.onDone).toHaveBeenCalledWith({
      statusCode: 200,
      payload: '{"ok":true}',
      logTail: "START\nEND",
    });
    expect(events.onError).not.toHaveBeenCalled();
    // Full teardown: client + bridge + core handle (config revert + tunnel).
    expect(mockClient.dispose).toHaveBeenCalledTimes(1);
    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("emits onError and tears everything down when the invoke rejects", async () => {
    await startDebugRun(baseOpts([5]));

    invokeDeferred.reject(new Error("sandbox exploded"));
    await flush();

    expect(events.onError).toHaveBeenCalledWith(
      expect.stringContaining("sandbox exploded"),
    );
    expect(events.onDone).not.toHaveBeenCalled();
    expect(mockClient.dispose).toHaveBeenCalledTimes(1);
    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("passes executionName through to invoke", async () => {
    const handle = await startDebugRun({
      ...baseOpts([5]),
      executionName: "order-12345",
    });
    expect(mockCoreHandle.invoke).toHaveBeenCalledWith(
      '{"orderId":"12345"}',
      "order-12345",
    );
    await startAndSettle(handle);
  });
});

describe("setBreakpoints — replace semantics", () => {
  it("removes ALL stale breakpoints, sets the new set, and returns only dar lines that bound", async () => {
    const handle = await startDebugRun(baseOpts([5])); // bp-1 (line 10), bp-2 (line 12)

    // Replace with dar 7 (binds at bundle 20) and dar 99 (maps to nothing).
    const bound = await handle.setBreakpoints([7, 99]);

    expect(mockClient.removeBreakpoint).toHaveBeenCalledTimes(2);
    expect(mockClient.removeBreakpoint).toHaveBeenCalledWith("bp-1");
    expect(mockClient.removeBreakpoint).toHaveBeenCalledWith("bp-2");
    // Bundle line 20 → CDP 0-based 19.
    expect(mockClient.setBreakpointByUrl).toHaveBeenLastCalledWith(
      ".*/var/task/index\\.js",
      19,
    );
    expect(bound).toEqual([7]); // 99 produced no code → did not bind

    // A pause on the OLD id no longer matches → auto-resumed, not surfaced.
    mockClient.firePause(BREAK_ON_START);
    await flush();
    mockClient.firePause({ ...breakpointPause(["bp-1"]), reason: "exception" });
    await flush();
    expect(events.onPaused).not.toHaveBeenCalled();
    // The NEW id (bp-3, from the replace) surfaces.
    mockClient.firePause({ ...breakpointPause(["bp-3"]) });
    await flush();
    expect(events.onPaused).toHaveBeenCalledTimes(1);

    await startAndSettle(handle);
  });
});

describe("stepping", () => {
  it("rejects stepping and continue while not paused", async () => {
    const handle = await startDebugRun(baseOpts([5]));

    await expect(handle.stepOver()).rejects.toThrow(/not paused/);
    await expect(handle.stepInto()).rejects.toThrow(/not paused/);
    await expect(handle.stepOut()).rejects.toThrow(/not paused/);
    await expect(handle.continue_()).rejects.toThrow(/not paused/);
    expect(mockClient.stepOver).not.toHaveBeenCalled();

    await startAndSettle(handle);
  });

  it("steps and continues while paused, and getProperties delegates to the client", async () => {
    const handle = await startDebugRun(baseOpts([5]));
    mockClient.firePause(BREAK_ON_START);
    await flush();
    mockClient.firePause(breakpointPause(["bp-1"]));
    await flush();

    await handle.stepOver();
    expect(mockClient.stepOver).toHaveBeenCalledTimes(1);

    const props = await handle.getProperties("obj-1");
    expect(mockClient.getProperties).toHaveBeenCalledWith("obj-1");
    expect(props).toEqual([
      { name: "x", value: { type: "number", value: 42 } },
    ]);

    // After the resumed event, stepping rejects again.
    mockClient.fireResumed();
    await expect(handle.continue_()).rejects.toThrow(/not paused/);

    await startAndSettle(handle);
  });
});

describe("stop()", () => {
  it("is idempotent — a second stop is a complete no-op, and never throws", async () => {
    const handle = await startDebugRun(baseOpts([5]));
    mockCoreHandle.dispose.mockRejectedValueOnce(new Error("revert hiccup"));

    await expect(handle.stop()).resolves.toBeUndefined();
    await expect(handle.stop()).resolves.toBeUndefined();

    expect(mockClient.dispose).toHaveBeenCalledTimes(1);
    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("suppresses onDone/onError when the invoke settles after a user stop", async () => {
    const handle = await startDebugRun(baseOpts([5]));
    await handle.stop();

    invokeDeferred.reject(new Error("tunnel torn down"));
    await flush();

    expect(events.onDone).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
});

// A durable execution is not one invocation: every suspend (wait, callback,
// poll interval) ends the invocation and its sandbox, and the execution
// resumes later in a NEW sandbox. These cover the attach LOOP that keeps
// breakpoints alive across that boundary — without it, a breakpoint on any
// node after a `ctx.wait` could never be hit.
describe("durable replay — re-attach on a new sandbox", () => {
  it("re-attaches and RE-INSTALLS breakpoints when the sandbox goes away mid-execution", async () => {
    const first = mockClient;
    const second = makeMockClient();
    let nth = 0;
    mockConnect.mockImplementation(async () => {
      order.push(`connect#${++nth}`);
      return nth === 1 ? first : second;
    });

    const handle = await startDebugRun(baseOpts([5]));
    expect(order.filter((o) => o.startsWith("connect#"))).toEqual([
      "connect#1",
    ]);

    // The workflow hits a `wait`: the invocation ends, sandbox is reclaimed.
    // The invoke has NOT settled — the durable execution is still running.
    first.fireClosed();
    await flush(6);

    // A second sandbox was attached to, and the SAME breakpoint set was
    // installed on it (CDP ids from the dead sandbox are worthless).
    expect(order.filter((o) => o.startsWith("connect#"))).toEqual([
      "connect#1",
      "connect#2",
    ]);
    expect(second.enable).toHaveBeenCalledTimes(1);
    expect(second.setBreakpointByUrl.mock.calls.map((c) => c[1])).toEqual([
      9, 11,
    ]); // dar 5 → bundle 10,12 → CDP 0-based 9,11
    expect(second.runIfWaitingForDebugger).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalled();

    // The user is told what happened rather than left with a dead session.
    const statuses = events.onStatus.mock.calls.map((c) => c[0]).join("\n");
    expect(statuses).toMatch(/suspended/i);
    expect(statuses).toMatch(/re-attach/i);
    expect(events.onError).not.toHaveBeenCalled();
    expect(events.onDone).not.toHaveBeenCalled();

    // A breakpoint hit in the NEW sandbox is surfaced normally.
    second.firePause(BREAK_ON_START);
    second.firePause(breakpointPause(["bp-1"]));
    await flush();
    expect(events.onPaused).toHaveBeenCalledWith(
      expect.objectContaining({ darLine: 5 }),
    );

    await startAndSettle(handle);
  });

  it("does NOT re-attach when the sandbox closes because the execution finished", async () => {
    const handle = await startDebugRun(baseOpts([5]));

    // Real ordering at the end of a run: the last sandbox dies, then the
    // invoke settles. Closing must not kick off a pointless discovery poll
    // that then has to be aborted.
    invokeDeferred.resolve({ statusCode: 200, payload: '{"ok":true}' });
    await flush();
    mockClient.fireClosed();
    await flush();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(events.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ payload: '{"ok":true}' }),
    );
    expect(events.onError).not.toHaveBeenCalled();
    await handle.stop();
  });

  it("ends the run quietly when the execution completes while waiting for the next sandbox", async () => {
    let nth = 0;
    mockConnect.mockImplementation(async () => {
      nth += 1;
      if (nth === 1) return mockClient;
      return new Promise(() => {}); // no further sandbox ever appears
    });

    const handle = await startDebugRun(baseOpts([5]));
    mockClient.fireClosed(); // suspended: start waiting for the next sandbox
    await flush();

    // …and then the execution simply finishes. That's a normal completion,
    // NOT "lost the debugger".
    invokeDeferred.resolve({ statusCode: 200, payload: "null" });
    await flush(6);

    expect(events.onDone).toHaveBeenCalledTimes(1);
    expect(events.onError).not.toHaveBeenCalled();
    await handle.stop();
  });

  it("reports the paused state as resumed when the sandbox dies while paused", async () => {
    const handle = await startDebugRun(baseOpts([5]));
    mockClient.firePause(BREAK_ON_START);
    mockClient.firePause(breakpointPause(["bp-1"]));
    await flush();
    expect(events.onPaused).toHaveBeenCalledTimes(1);

    mockConnect.mockImplementation(() => new Promise(() => {}));
    mockClient.fireClosed();
    await flush();

    // The pause decorations must not stick to a sandbox that no longer exists.
    expect(events.onResumed).toHaveBeenCalled();
    await expect(handle.continue_()).rejects.toThrow(/no sandbox is attached/);
    await handle.stop();
  });

  it("keeps breakpoints added WHILE suspended and installs them on the next sandbox", async () => {
    const second = makeMockClient();
    let nth = 0;
    let releaseSecond!: () => void;
    const secondReady = new Promise<void>((r) => (releaseSecond = r));
    mockConnect.mockImplementation(async () => {
      nth += 1;
      if (nth === 1) return mockClient;
      await secondReady;
      return second;
    });

    const handle = await startDebugRun(baseOpts([5]));
    mockClient.fireClosed();
    await flush();

    // Detached: setBreakpoints can't talk to CDP, but must still report which
    // lines CAN bind, and remember them for the next sandbox.
    const bound = await handle.setBreakpoints([5, 7, 99]);
    expect(bound).toEqual([5, 7]); // 99 maps to no generated code

    releaseSecond();
    await flush(6);

    // dar 5 → bundle 10,12 and dar 7 → bundle 20, all 0-based for CDP.
    expect(second.setBreakpointByUrl.mock.calls.map((c) => c[1])).toEqual([
      9, 11, 19,
    ]);
    await startAndSettle(handle);
  });

  it("stops with an error naming the 60s freeze limit when re-attaching fails", async () => {
    let nth = 0;
    mockConnect.mockImplementation(async () => {
      nth += 1;
      if (nth === 1) return mockClient;
      throw new Error("tunnel gone");
    });

    const handle = await startDebugRun(baseOpts([5]));
    mockClient.fireClosed();
    await flush(6);

    // The dominant cause is Lambda ending the debug session after 60s of
    // sandbox freeze (DAR-431), so the message leads with that and makes clear
    // the EXECUTION is unaffected — a bare discovery timeout would leave the
    // user thinking their workflow broke.
    expect(events.onError).toHaveBeenCalledWith(
      expect.stringMatching(/60-second debug freeze limit[\s\S]*tunnel gone/),
    );
    expect(events.onError).toHaveBeenCalledWith(
      expect.stringContaining("The execution itself keeps running"),
    );
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it("keeps the debug version when stopped mid-execution, deletes it once the execution finished", async () => {
    // A durable execution PINS the version it started on, so the published
    // debug version may only be deleted once no further invocation can land on
    // it — i.e. only after the invoke settles.
    const stoppedEarly = await startDebugRun(baseOpts([5]));
    await stoppedEarly.stop();
    expect(mockCoreHandle.dispose).toHaveBeenCalledWith({
      deleteVersion: false,
    });

    mockCoreHandle.dispose.mockClear();
    invokeDeferred = deferred<InvokeResult>();
    mockClient = makeMockClient();
    mockConnect.mockImplementation(async () => mockClient);
    const finished = await startDebugRun(baseOpts([5]));
    invokeDeferred.resolve({ statusCode: 200, payload: "null" });
    await flush();
    expect(mockCoreHandle.dispose).toHaveBeenCalledWith({
      deleteVersion: true,
    });
    await finished.stop();
  });

  it("ignores a stale sandbox's pauses after re-attach", async () => {
    const first = mockClient;
    const second = makeMockClient();
    let nth = 0;
    mockConnect.mockImplementation(async () => (++nth === 1 ? first : second));

    const handle = await startDebugRun(baseOpts([5]));
    first.fireClosed();
    await flush(6);

    // The dead sandbox's queued events must not drive the UI.
    first.firePause(breakpointPause(["bp-1"]));
    first.fireResumed();
    await flush();
    expect(events.onPaused).not.toHaveBeenCalled();

    await startAndSettle(handle);
  });
});

describe("startup failure paths end in stop()", () => {
  it("tears down (bridge + core) and rethrows when connect fails", async () => {
    mockConnect.mockRejectedValue(new Error("no inspector"));

    await expect(startDebugRun(baseOpts([5]))).rejects.toThrow("no inspector");

    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("aborts discovery when the invoke settles before the debugger attaches", async () => {
    // connect hangs forever — only the early-settle race can end it.
    mockConnect.mockImplementation(() => new Promise(() => {}));
    const run = startDebugRun(baseOpts([5]));
    invokeDeferred.reject(new Error("instant lambda error"));

    await expect(run).rejects.toThrow(
      /invocation failed: instant lambda error.*never got a chance to attach/i,
    );
    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockCoreHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it("tears down and rethrows when the session core itself fails", async () => {
    mockStartSession.mockRejectedValue(new Error("update conflict"));

    await expect(startDebugRun(baseOpts([5]))).rejects.toThrow(
      "update conflict",
    );
    expect(mockBridge.dispose).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
