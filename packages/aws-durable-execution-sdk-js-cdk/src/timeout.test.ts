import {
  inferExecutionTimeoutSeconds,
  MIN_EXECUTION_TIMEOUT_SECONDS,
  MAX_EXECUTION_TIMEOUT_SECONDS,
} from "./timeout";
import type { DarWorkflow } from "./darModel";

const FLOOR = MIN_EXECUTION_TIMEOUT_SECONDS;
const buffered = (seconds: number) => FLOOR + Math.ceil(seconds * 1.2);

describe("inferExecutionTimeoutSeconds", () => {
  it("floors wait-free workflows at the minimum", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "a", kind: "step", name: "step1", code: "return 1;" },
      ],
      edges: [{ id: "e1", source: "s", target: "a" }],
    };
    expect(inferExecutionTimeoutSeconds(wf)).toBe(FLOOR);
  });

  it("sums sequential waits along the path (with buffer)", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "w1",
          kind: "wait",
          name: "w1",
          durationValue: 2,
          durationUnit: "minutes",
        },
        {
          id: "w2",
          kind: "wait",
          name: "w2",
          durationValue: 1,
          durationUnit: "hours",
        },
      ] as never,
      edges: [
        { id: "e1", source: "s", target: "w1" },
        { id: "e2", source: "w1", target: "w2" },
      ],
    };
    expect(inferExecutionTimeoutSeconds(wf)).toBe(buffered(120 + 3600));
  });

  it("takes the longest condition branch, not the sum of branches", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      dependencyMode: "dag",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        { id: "c", kind: "condition", name: "route", code: 'return "A";' },
        {
          id: "sa",
          kind: "wait",
          name: "short",
          durationValue: 30,
          durationUnit: "seconds",
        },
        {
          id: "lo",
          kind: "wait",
          name: "long",
          durationValue: 10,
          durationUnit: "minutes",
        },
      ] as never,
      edges: [
        { id: "e1", source: "s", target: "c" },
        { id: "e2", source: "c", target: "sa", match: "A" },
        { id: "e3", source: "c", target: "lo" },
      ],
    };
    // max(30, 600) = 600, not 630.
    expect(inferExecutionTimeoutSeconds(wf)).toBe(buffered(600));
  });

  it("takes the slowest parallel branch, not the sum", () => {
    const body = (id: string, secs: number): DarWorkflow => ({
      darVersion: "1.0",
      name: "b",
      nodes: [
        { id: `${id}s`, kind: "start", name: "start" },
        {
          id: `${id}w`,
          kind: "wait",
          name: "w",
          durationValue: secs,
          durationUnit: "seconds",
        },
      ] as never,
      edges: [{ id: `${id}e`, source: `${id}s`, target: `${id}w` }],
    });
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "p",
          kind: "parallel",
          name: "par",
          branches: [
            { id: "b1", name: "fast", body: body("f", 10) },
            { id: "b2", name: "slow", body: body("s", 90) },
          ],
        },
      ] as never,
      edges: [{ id: "e1", source: "s", target: "p" }],
    };
    expect(inferExecutionTimeoutSeconds(wf)).toBe(buffered(90));
  });

  it("counts an error-route branch as an alternative continuation", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      dependencyMode: "dag",
      nodes: [
        {
          id: "s",
          kind: "start",
          name: "start",
        },
        {
          id: "a",
          kind: "step",
          name: "step1",
          code: "return 1;",
        },
        {
          id: "h",
          kind: "wait",
          name: "cooldown",
          durationValue: 45,
          durationUnit: "seconds",
        },
      ] as never,
      edges: [
        { id: "e1", source: "s", target: "a" },
        { id: "b1", source: "a", target: "h", kind: "error" },
      ],
    };
    expect(inferExecutionTimeoutSeconds(wf)).toBe(buffered(45));
  });

  it("caps at one year", () => {
    const wf: DarWorkflow = {
      darVersion: "1.0",
      name: "t",
      nodes: [
        { id: "s", kind: "start", name: "start" },
        {
          id: "w",
          kind: "wait",
          name: "w",
          durationValue: 800,
          durationUnit: "days",
        },
      ] as never,
      edges: [{ id: "e1", source: "s", target: "w" }],
    };
    expect(inferExecutionTimeoutSeconds(wf)).toBe(
      MAX_EXECUTION_TIMEOUT_SECONDS,
    );
  });
});
