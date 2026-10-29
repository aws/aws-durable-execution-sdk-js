import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionDetailPage } from "./ExecutionDetailPage";
import {
  flattenOperations,
  formatDuration,
  functionNameFromExecutionArn,
  historyToCsv,
  isTerminal,
  looksLikeExecutionArn,
  prettyJson,
  executionArnColumn,
} from "./executionFormat";
import type { ExecutionDetail } from "./types";

const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:order-processor:$LATEST/durable-execution/order-1/abc";

describe("execution formatting", () => {
  it("formats durations across units", () => {
    assert.equal(formatDuration(undefined), "—");
    assert.equal(formatDuration(250), "250 ms");
    assert.equal(formatDuration(42_000), "42s");
    assert.equal(formatDuration(125_000), "2m 5s");
    assert.equal(formatDuration(3_660_000), "1h 1m");
    assert.equal(formatDuration(90_000_000), "1d 1h");
  });

  it("knows which statuses are terminal", () => {
    for (const s of ["SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"]) {
      assert.equal(isTerminal(s), true, s);
    }
    assert.equal(isTerminal("RUNNING"), false);
    assert.equal(isTerminal(undefined), false);
  });

  it("pretty-prints JSON and passes other text through", () => {
    assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
    assert.equal(prettyJson("not json"), "not json");
    assert.equal(prettyJson(""), null);
    assert.equal(prettyJson(undefined), null);
  });

  it("recognizes execution ARNs and pulls out the function", () => {
    assert.equal(looksLikeExecutionArn(ARN), true);
    assert.equal(looksLikeExecutionArn("arn:aws:lambda:x:1:function:f"), false);
    assert.equal(looksLikeExecutionArn(`${ARN} x`), false);
    assert.equal(looksLikeExecutionArn(7), false);
    assert.equal(functionNameFromExecutionArn(ARN), "order-processor");
  });

  it("flattens the operation tree depth-first", () => {
    const ids = flattenOperations([
      {
        id: "a",
        status: "SUCCEEDED",
        children: [{ id: "b", status: "SUCCEEDED" }],
      },
      { id: "c", status: "SUCCEEDED" },
    ]).map((o) => o.id);
    assert.deepEqual(ids, ["a", "b", "c"]);
  });

  it("quotes CSV fields that need it", () => {
    const csv = historyToCsv([{ eventId: 1, name: 'say "hi", twice' }]);
    assert.equal(
      csv,
      'eventId,type,subType,name,id,parentId,timestamp\n1,,,"say ""hi"", twice",,,',
    );
  });
});

describe("executionArnColumn", () => {
  it("prefers the identifier column when it holds ARNs", () => {
    assert.equal(
      executionArnColumn(["pk", "executionArn"], [[ARN, ARN]], "pk"),
      "pk",
    );
  });

  it("falls back to an executionArn column in any casing", () => {
    assert.equal(
      executionArnColumn(["status", "executionarn"], [["OK", ARN]]),
      "executionarn",
    );
  });

  it("offers nothing when no row holds an ARN", () => {
    assert.equal(
      executionArnColumn(["executionArn"], [["n/a"]], "executionArn"),
      undefined,
    );
  });
});

describe("ExecutionDetailPage", () => {
  const detail: ExecutionDetail = {
    arn: ARN,
    name: "order-1",
    functionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:order-processor",
    status: "RUNNING",
    startTime: "2025-01-01T00:00:00.000Z",
    history: [],
    operations: [{ id: "s1", name: "charge", kind: "Step", status: "FAILED" }],
    invocations: [],
    historyTruncated: true,
  };
  const render = (d: ExecutionDetail | null, error?: string) =>
    renderToStaticMarkup(
      <ExecutionDetailPage
        arn={ARN}
        detail={d}
        error={error}
        loading={false}
        onRefresh={() => {}}
        onOpenExecution={() => {}}
        onExportHistory={() => {}}
      />,
    );

  it("shows a running execution as live, with its operations and no actions", () => {
    const html = render(detail);
    assert.match(html, /order-1/);
    assert.match(html, /Live/);
    assert.doesNotMatch(html, />Stop</);
    assert.doesNotMatch(html, /Start new execution/);
    assert.match(html, /charge/);
    assert.match(html, /more history than the viewer loads/);
  });

  it("does not show a finished execution as live", () => {
    const html = render({ ...detail, status: "SUCCEEDED" });
    assert.doesNotMatch(html, /Live/);
  });

  it("says history is incomplete when some was read before a failure", () => {
    const html = render({
      ...detail,
      history: [{ eventId: 1, type: "StepStarted" }],
      historyTruncated: false,
      historyError: "ThrottlingException",
    });
    assert.match(html, /History incomplete/);
    assert.match(html, /failed after 1 events/);
    assert.doesNotMatch(html, /operations are not shown/);
  });

  it("does not show an execution with no status as live", () => {
    assert.doesNotMatch(render({ ...detail, status: "" }), /Live/);
  });

  it("shows a load error", () => {
    const html = render(null, "AccessDeniedException");
    assert.match(html, /Couldn(&#x27;|')t load execution/);
    assert.match(html, /AccessDeniedException/);
  });
});
