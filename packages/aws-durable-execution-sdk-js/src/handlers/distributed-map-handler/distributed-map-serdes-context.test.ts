import { describe, it, expect } from "vitest";
import {
  dmapSerdesContext,
  parseDistributedMapRunArn,
} from "./distributed-map-serdes-context";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

const PARENT_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/e/i";
const RUN_ARN = `${PARENT_ARN}/distributed-map-run/run-1`;

describe("parseDistributedMapRunArn", () => {
  it("splits a run ARN into the parent execution ARN and the run id", () => {
    expect(parseDistributedMapRunArn(RUN_ARN)).toEqual({
      parentExecutionArn: PARENT_ARN,
      runId: "run-1",
    });
  });

  it("splits at the last separator when the execution name is distributed-map-run", () => {
    const parent =
      "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/distributed-map-run/i";
    expect(
      parseDistributedMapRunArn(`${parent}/distributed-map-run/run-1`),
    ).toEqual({ parentExecutionArn: parent, runId: "run-1" });
  });

  it.each([
    ["undefined", undefined],
    ["a non-string", 42],
    ["an empty string", ""],
    ["an ARN without the run separator", PARENT_ARN],
    ["an ARN with nothing before the separator", "/distributed-map-run/run-1"],
    ["an ARN with an empty run id", `${PARENT_ARN}/distributed-map-run/`],
    ["a run id containing /", `${PARENT_ARN}/distributed-map-run/run-1/x`],
    ["a prefix that is not a durable execution ARN", "x/distributed-map-run/a"],
  ])("rejects %s", (_label, value) => {
    expect(parseDistributedMapRunArn(value)).toBeUndefined();
  });
});

describe("dmapSerdesContext", () => {
  it("hashes the run id, role and parts, and uses the parent execution ARN", () => {
    expect(dmapSerdesContext(RUN_ARN, "output", "item-1")).toEqual({
      entityId: hashId(JSON.stringify(["run-1", "output", "item-1"])),
      durableExecutionArn: PARENT_ARN,
    });
  });

  it("gives each role and part a distinct entity id", () => {
    const ids = [
      dmapSerdesContext(RUN_ARN, "body", "item-1"),
      dmapSerdesContext(RUN_ARN, "output", "item-1"),
      dmapSerdesContext(RUN_ARN, "body", "item-2"),
      dmapSerdesContext(
        `${PARENT_ARN}/distributed-map-run/run-2`,
        "body",
        "item-1",
      ),
    ].map((c) => c.entityId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws for a run ARN that does not parse", () => {
    expect(() => dmapSerdesContext("arn:bad", "body", "item-1")).toThrow(
      /invalid distributed map run ARN/,
    );
  });
});
