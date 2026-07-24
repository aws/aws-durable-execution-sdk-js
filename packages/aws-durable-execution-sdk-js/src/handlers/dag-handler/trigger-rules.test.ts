import { triggerRuleEvaluators } from "./trigger-rules";
import { TaskStatus } from "../../types/dag";

describe("triggerRuleEvaluators", () => {
  const S: TaskStatus = "SUCCEEDED";
  const F: TaskStatus = "FAILED";
  const K: TaskStatus = "SKIPPED";

  const cases: Array<{
    label: string;
    statuses: TaskStatus[];
    expected: Record<string, boolean>;
  }> = [
    {
      label: "empty",
      statuses: [],
      expected: {
        ALL_SUCCESS: true,
        ALL_FAILED: false,
        ALL_DONE: true,
        ANY_SUCCESS: false,
        ANY_FAILED: false,
        NONE_FAILED: true,
      },
    },
    {
      label: "all succeeded",
      statuses: [S, S],
      expected: {
        ALL_SUCCESS: true,
        ALL_FAILED: false,
        ALL_DONE: true,
        ANY_SUCCESS: true,
        ANY_FAILED: false,
        NONE_FAILED: true,
      },
    },
    {
      label: "all failed",
      statuses: [F, F],
      expected: {
        ALL_SUCCESS: false,
        ALL_FAILED: true,
        ALL_DONE: true,
        ANY_SUCCESS: false,
        ANY_FAILED: true,
        NONE_FAILED: false,
      },
    },
    {
      label: "mixed succ/fail",
      statuses: [S, F],
      expected: {
        ALL_SUCCESS: false,
        ALL_FAILED: false,
        ALL_DONE: true,
        ANY_SUCCESS: true,
        ANY_FAILED: true,
        NONE_FAILED: false,
      },
    },
    {
      label: "includes skipped (with success)",
      statuses: [S, K],
      expected: {
        ALL_SUCCESS: false,
        ALL_FAILED: false,
        ALL_DONE: true,
        ANY_SUCCESS: true,
        ANY_FAILED: false,
        NONE_FAILED: true,
      },
    },
    {
      label: "includes skipped (with failure)",
      statuses: [F, K],
      expected: {
        ALL_SUCCESS: false,
        ALL_FAILED: false,
        ALL_DONE: true,
        ANY_SUCCESS: false,
        ANY_FAILED: true,
        NONE_FAILED: false,
      },
    },
  ];

  for (const c of cases) {
    for (const rule of Object.keys(c.expected)) {
      it(`${rule} on ${c.label} => ${c.expected[rule]}`, () => {
        expect(
          triggerRuleEvaluators[rule as keyof typeof triggerRuleEvaluators](
            c.statuses,
          ),
        ).toBe(c.expected[rule]);
      });
    }
  }
});
