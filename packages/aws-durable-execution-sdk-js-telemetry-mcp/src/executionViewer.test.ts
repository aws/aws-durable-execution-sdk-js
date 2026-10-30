/**
 * The local execution viewer: its links, its listener, its page, and the
 * links it adds to tool results.
 */
const runReadOnlyQuery = jest.fn();
jest.mock("./readOnlyQuery", () => ({
  ...jest.requireActual("./readOnlyQuery"),
  runReadOnlyQuery: (...args: unknown[]) => runReadOnlyQuery(...args),
}));
const runGetExecution = jest.fn();
const runListExecutions = jest.fn();
jest.mock("./tools", () => ({
  ...jest.requireActual("./tools"),
  runGetExecution: (...args: unknown[]) => runGetExecution(...args),
  runListExecutions: (...args: unknown[]) => runListExecutions(...args),
}));

import { request } from "node:http";
import type { ExecutionDetail } from "@aws/durable-execution-sdk-js-telemetry-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readConfigFromEnv } from "./config";
import { renderExecutionPage, VIEWER_CSS } from "./executionPage";
import {
  ExecutionViewer,
  executionArnColumnIndex,
  executionNameColumnIndex,
  executionNameFromRecord,
  markdownLink,
  VIEWER_HOST,
  viewerFromEnv,
  withViewerLinks,
} from "./executionViewer";
import { registerTools } from "./registerTools";

const ARN =
  "arn:aws:lambda:eu-west-1:123456789012:function:orders:$LATEST/durable-execution/run-1/abc";
const OTHER_ARN =
  "arn:aws:lambda:eu-west-1:123456789012:function:child:1/durable-execution/c/1";

const CONFIG = readConfigFromEnv({
  DURABLE_TELEMETRY_DESTINATION_TYPE: "aurora",
  DURABLE_TELEMETRY_AURORA_RESOURCE_ARN: "arn:aws:rds:us-east-1:1:cluster:c",
  DURABLE_TELEMETRY_AURORA_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:1:secret:s",
  DURABLE_TELEMETRY_REGION: "us-east-1",
}).config;

const LINK = /^http:\/\/127\.0\.0\.1:\d+\/e\/[A-Za-z0-9_-]{22}$/;

function detail(overrides: Partial<ExecutionDetail> = {}): ExecutionDetail {
  return {
    arn: ARN,
    name: "run-1",
    status: "SUCCEEDED",
    history: [],
    operations: [],
    invocations: [],
    ...overrides,
  };
}

/** A viewer whose Lambda client answers from fixed data and records calls. */
function makeViewer(opts: { fail?: boolean | "string" } = {}) {
  const calls: { region: string; command: string; input: any }[] = [];
  const logs: string[] = [];
  const viewer = new ExecutionViewer({
    config: CONFIG,
    log: (m) => logs.push(m),
    lambdaClientFor: (region) => ({
      send: async (cmd: { constructor: { name: string }; input: unknown }) => {
        calls.push({ region, command: cmd.constructor.name, input: cmd.input });
        if (opts.fail === "string") throw "plain failure";
        if (opts.fail) throw new Error("AccessDenied");
        if (cmd.constructor.name === "GetDurableExecutionCommand") {
          return { DurableExecutionArn: ARN, Status: "RUNNING" };
        }
        return {
          Events: [
            { EventType: "StepStarted", Id: "s", Name: "<b>charge</b>" },
          ],
        };
      },
    }),
  });
  return { viewer, calls, logs };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so the Host header and method can be set freely. */
function get(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? "GET",
        headers: opts.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("viewer links", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("opens no port for a value that is not an execution ARN", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    expect(await viewer.linkFor("not-an-arn")).toBeUndefined();
    expect(await viewer.linkFor(42)).toBeUndefined();
    expect(made.logs).toEqual([]);
  });

  it("links to a random ID on loopback, the same ID for the same ARN", async () => {
    viewer = makeViewer().viewer;
    const a = await viewer.linkFor(ARN);
    const b = await viewer.linkFor(OTHER_ARN);
    expect(a).toMatch(LINK);
    expect(b).toMatch(LINK);
    expect(new URL(a ?? "").hostname).toBe(VIEWER_HOST);
    expect(await viewer.linkFor(ARN)).toBe(a);
    expect(b).not.toBe(a);
    expect(a).not.toContain("orders");
  });

  it("gives no links when the listener fails, says why, and tries again on the next link", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    // The real module object, which executionViewer.ts calls through.
    const http = jest.requireActual<typeof import("node:http")>("node:http");
    const realCreateServer = http.createServer;
    const spy = jest.spyOn(http, "createServer").mockImplementationOnce(((
      ...args: Parameters<typeof realCreateServer>
    ) => {
      const s = realCreateServer(...args);
      // A real listen failure arrives as an "error" event.
      s.listen = (() => {
        process.nextTick(() => s.emit("error", new Error("EMFILE")));
        return s;
      }) as typeof s.listen;
      return s;
    }) as typeof http.createServer);
    try {
      expect(await viewer.linkFor(ARN)).toBeUndefined();
      expect(made.logs.join("\n")).toMatch(/could not start.*EMFILE/);
      const link = (await viewer.linkFor(ARN)) ?? "";
      expect(link).toMatch(LINK);
      expect((await get(link)).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("starts again after close, under the IDs it already gave out", async () => {
    viewer = makeViewer().viewer;
    const first = (await viewer.linkFor(ARN)) ?? "";
    await viewer.close();
    const second = (await viewer.linkFor(ARN)) ?? "";
    expect(new URL(second).pathname).toBe(new URL(first).pathname);
    expect((await get(second)).status).toBe(200);
  });

  it("is turned off only by DURABLE_TELEMETRY_VIEWER_DISABLED=true, in any case", () => {
    const made = (v: string | undefined) =>
      viewerFromEnv(
        { DURABLE_TELEMETRY_VIEWER_DISABLED: v },
        { config: CONFIG },
      );
    expect(made("true")).toBeUndefined();
    expect(made(" TRUE ")).toBeUndefined();
    for (const v of [undefined, "1", "false"]) {
      expect(made(v)).toBeInstanceOf(ExecutionViewer);
    }
  });

  it("closes cleanly before it has started", async () => {
    viewer = makeViewer().viewer;
    await expect(viewer.close()).resolves.toBeUndefined();
  });
});

describe("viewer server", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("serves the linked execution, read without history payloads", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const res = await get(link);
    expect(res.status).toBe(200);
    expect(res.body).toContain("&lt;b&gt;charge&lt;/b&gt;");
    // The client targets the region the ARN names, not the configured one.
    expect(new Set(made.calls.map((c) => c.region))).toEqual(
      new Set(["eu-west-1"]),
    );
    const history = made.calls.filter(
      (c) => c.command === "GetDurableExecutionHistoryCommand",
    );
    expect(history.map((c) => c.input.IncludeExecutionData)).toEqual([false]);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ignores a query string on the link", async () => {
    viewer = makeViewer().viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    expect((await get(`${link}?x=1`)).status).toBe(200);
  });

  it("answers under localhost as well as 127.0.0.1, in any case", async () => {
    viewer = makeViewer().viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const port = new URL(link).port;
    for (const host of [`localhost:${port}`, `LOCALHOST:${port}`]) {
      const res = await get(link, { headers: { Host: host } });
      expect(res.status).toBe(200);
    }
  });

  it("rejects a foreign Host header, before any Lambda call", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const res = await get(link, { headers: { Host: "evil.example:80" } });
    expect(res.status).toBe(421);
    expect(made.calls).toEqual([]);
  });

  it("answers 404 for an ID it did not give out, with no Lambda call", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const origin = new URL(link).origin;
    for (const path of [
      `/e/${"A".repeat(22)}`,
      "/e/short",
      `${new URL(link).pathname}/extra`,
      `/x${new URL(link).pathname}`,
      "/",
    ]) {
      expect((await get(`${origin}${path}`)).status).toBe(404);
    }
    expect(made.calls).toEqual([]);
  });

  it("serves its stylesheet", async () => {
    viewer = makeViewer().viewer;
    const origin = new URL((await viewer.linkFor(ARN)) ?? "").origin;
    const res = await get(`${origin}/viewer.css`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/css/);
    expect(res.body).toBe(VIEWER_CSS);
  });

  it("is read-only", async () => {
    viewer = makeViewer().viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const res = await get(link, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });

  it("answers HEAD without calling Lambda", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const res = await get(link, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
    // Without the Lambda call the length is unknown, so none is sent.
    expect(res.headers["content-length"]).toBeUndefined();
    expect(made.calls).toEqual([]);
  });

  it("shows a failure that is not an Error", async () => {
    viewer = makeViewer({ fail: "string" }).viewer;
    const res = await get((await viewer.linkFor(ARN)) ?? "");
    expect(res.status).toBe(502);
    expect(res.body).toContain("plain failure");
  });

  it("does not keep the process alive", async () => {
    // A child process links an execution, which starts the listener, and
    // then has nothing left to do. It must exit by itself.
    const { spawn } = await import("node:child_process");
    const script = `
      const { ExecutionViewer } = require(${JSON.stringify(`${__dirname}/executionViewer.ts`)});
      new ExecutionViewer({ config: { region: "us-east-1" } })
        .linkFor(${JSON.stringify(ARN)})
        .then((l) => console.log(l ? "linked" : "no link"));
    `;
    const out = await new Promise<{ code: number | null; text: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "-e", script],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
        let text = "";
        child.stdout.on("data", (c) => {
          text += c;
        });
        const timer = setTimeout(() => child.kill(), 10_000);
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, text });
        });
      },
    );
    expect(out.text.trim()).toBe("linked");
    expect(out.code).toBe(0);
  }, 20_000);

  it("shows a Lambda failure as a page", async () => {
    viewer = makeViewer({ fail: true }).viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const res = await get(link);
    expect(res.status).toBe(502);
    // The message only, not "Error: AccessDenied".
    expect(res.body).toContain('<p class="error">AccessDenied</p>');
  });
});

describe("execution page", () => {
  it("escapes every value from AWS", () => {
    const html = renderExecutionPage(
      detail({
        name: "<script>x</script>",
        input: '"<img>"',
        operations: [
          {
            id: "o",
            name: "<i>step</i>",
            kind: "<k>",
            status: "<s>",
            callbackId: "<cb>",
          },
          { id: "q", name: `a&b "c" 'd'`, status: "RUNNING" },
        ],
        invocations: [{ requestId: "<r>" }],
      }),
    );
    expect(html).not.toMatch(/<(script|img|i|k|s|cb|r)>/i);
    expect(html).toContain("&lt;i&gt;step&lt;/i&gt;");
    expect(html).toContain("a&amp;b &quot;c&quot; &#39;d&#39;");
    expect(html).toContain("status-unknown");
  });

  it("shows an empty status as UNKNOWN", () => {
    expect(renderExecutionPage(detail({ status: "" }))).toContain(
      '<span class="status status-unknown">UNKNOWN</span>',
    );
  });

  it("has no script and offers a Refresh link to the same page", () => {
    const html = renderExecutionPage(detail());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http-equiv");
    expect(html).toContain('<a class="refresh" href="">Refresh</a>');
  });

  it("says when the execution is still running", () => {
    expect(renderExecutionPage(detail({ status: "RUNNING" }))).toContain(
      "Still running.",
    );
    expect(renderExecutionPage(detail())).not.toContain("Still running.");
    // An empty status is not "running".
    expect(renderExecutionPage(detail({ status: "" }))).not.toContain(
      "Still running.",
    );
  });

  it("shows the execution's payloads, and none for operations", () => {
    const html = renderExecutionPage(
      detail({ input: '{"a":1}', result: "not json", error: '{"e":2}' }),
    );
    expect(html).toContain(
      "<summary>Input</summary><pre>{\n  &quot;a&quot;: 1\n}",
    );
    expect(html).toContain("<summary>Result</summary><pre>not json");
    expect(html).toContain("<summary>Error</summary>");
    expect(html).toContain("Step results and errors are not loaded");
    expect(renderExecutionPage(detail())).toContain("No input recorded.");
  });

  it("nests operations and shows their schedule, callback and invoke target", () => {
    const html = renderExecutionPage(
      detail({
        operations: [
          {
            id: "m",
            name: "map",
            status: "RUNNING",
            children: [
              {
                id: "s",
                status: "PENDING",
                nextAttemptTime: "2025-01-01T00:00:05.000Z",
              },
            ],
          },
          {
            id: "w",
            status: "RUNNING",
            scheduledEndTime: "2025-01-01T00:01:00.000Z",
          },
          { id: "c", status: "RUNNING", callbackId: "cb-1" },
          {
            id: "i",
            status: "RUNNING",
            invokedFunction: "child",
            invokedExecutionArn: OTHER_ARN,
          },
        ],
      }),
    );
    expect(html).toContain('<td class="d0">map</td>');
    // A child without a name shows its id, one level deeper.
    expect(html).toContain('<td class="d1">s</td>');
    expect(html).toContain("Next attempt 2025-01-01 00:00:05 UTC");
    expect(html).toContain("Wait ends 2025-01-01 00:01:00 UTC");
    expect(html).toContain("Callback cb-1");
    expect(html).toContain(`Invoked child ${OTHER_ARN}`);
    // The invoke target is text, not a link.
    expect(html).not.toContain("<a href");
    expect(html).toContain("Operations (5)");
  });

  it("shows invocations, or says there are none", () => {
    const html = renderExecutionPage(
      detail({
        invocations: [
          {
            requestId: "r-1",
            startTime: "2025-01-01T00:00:00.000Z",
            durationMs: 1500,
          },
        ],
      }),
    );
    expect(html).toContain("<code>r-1</code>");
    expect(html).toContain("Invocations (1)");
    expect(renderExecutionPage(detail())).toContain(
      "No completed invocations.",
    );
    expect(renderExecutionPage(detail())).toContain("No operations recorded.");
  });

  it("says when the history could not be read", () => {
    const html = renderExecutionPage(detail({ historyError: "Throttled" }));
    expect(html).toContain("History unavailable");
    expect(html).toContain("Throttled");
  });

  it.each([
    [undefined, "—"],
    [400, "400 ms"],
    [42_000, "42s"],
    [125_000, "2m 5s"],
    [7_380_000, "2h 3m"],
    [93_600_000, "1d 2h"],
  ])("formats a duration of %p as %p", (ms, text) => {
    expect(renderExecutionPage(detail({ durationMs: ms }))).toContain(
      `<div class="value">${text}</div>`,
    );
  });

  it("shows a missing or invalid time as a dash", () => {
    const html = renderExecutionPage(
      detail({ startTime: "not a date", endTime: undefined }),
    );
    expect(html).toContain(
      '<div class="label">Started</div><div class="value">—</div>',
    );
    expect(html).toContain(
      '<div class="label">Ended</div><div class="value">—</div>',
    );
  });

  it("shows an invoke target that has only a function or only an ARN", () => {
    const html = renderExecutionPage(
      detail({
        operations: [
          { id: "f", status: "RUNNING", invokedFunction: "child-fn" },
          { id: "a", status: "RUNNING", invokedExecutionArn: OTHER_ARN },
        ],
      }),
    );
    expect(html).toContain('<div class="note">Invoked child-fn</div>');
    expect(html).toContain(`<div class="note">Invoked ${OTHER_ARN}</div>`);
  });

  it("titles an execution with no name by its ARN's last part", () => {
    const html = renderExecutionPage(detail({ name: "" }));
    expect(html).toContain("<title>abc — durable execution</title>");
  });

  it("shows a dash for a missing kind, attempt, version and request ID", () => {
    const html = renderExecutionPage(
      detail({
        operations: [{ id: "o", status: "RUNNING" }],
        invocations: [{}],
      }),
    );
    expect(html).toContain(
      '<td class="d0">o</td>\n<td>—</td>\n<td><span class="status status-running">RUNNING</span></td>\n<td>—</td>\n<td>—</td>\n<td>—</td>',
    );
    expect(html).toContain(
      '<div class="label">Version</div><div class="value">—</div>',
    );
    expect(html).toContain("<td><code>—</code></td>");
  });

  it("indents deep nesting no further than the stylesheet defines", () => {
    let op = {
      id: "leaf",
      status: "RUNNING",
    } as ExecutionDetail["operations"][number];
    for (let i = 0; i < 12; i++)
      op = { id: `n${i}`, status: "RUNNING", children: [op] };
    const html = renderExecutionPage(detail({ operations: [op] }));
    expect(html).toContain('<td class="d8">leaf</td>');
    expect(html).not.toContain('class="d9"');
  });
});

describe("viewer links in results", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("finds the ARN column by name first, then by content", () => {
    expect(executionArnColumnIndex(["pk", "executionarn"], [[ARN, ARN]])).toBe(
      1,
    );
    expect(executionArnColumnIndex(["pk", "status"], [[ARN, "OK"]])).toBe(0);
    // A named column without ARNs loses to a column that holds them.
    expect(
      executionArnColumnIndex(["executionArn", "other"], [["n/a", ARN]]),
    ).toBe(1);
    expect(executionArnColumnIndex(["status"], [["OK"]])).toBe(-1);
  });

  it("finds the name column under any casing", () => {
    expect(executionNameColumnIndex(["pk", "executionName"])).toBe(1);
    expect(executionNameColumnIndex(["execution_name"])).toBe(0);
    expect(executionNameColumnIndex(["executionname"])).toBe(0);
    expect(executionNameColumnIndex(["status"])).toBe(-1);
  });

  it("titles a link with the name, or 'show execution' when there is none", () => {
    expect(markdownLink("order-1", "http://x")).toBe("[order-1](http://x)");
    expect(markdownLink("", "http://x")).toBe("[show execution](http://x)");
    expect(markdownLink("  ", "http://x")).toBe("[show execution](http://x)");
    expect(markdownLink(undefined, "http://x")).toBe(
      "[show execution](http://x)",
    );
  });

  it("escapes link text so a name cannot break out of the link", () => {
    expect(markdownLink("a]b[c\\d<e>`f", "http://x")).toBe(
      "[a\\]b\\[c\\\\d\\<e\\>\\`f](http://x)",
    );
    const long = markdownLink("n".repeat(200), "http://x");
    expect(long.length).toBeLessThan(100);
    expect(long).toContain("…](http://x)");
    // The cut counts code points, so it never splits an emoji's surrogate pair.
    const emoji = markdownLink(`${"a".repeat(78)}😀😀😀`, "http://x");
    expect(emoji).toBe(`[${"a".repeat(78)}😀…](http://x)`);
  });

  it("turns each run of control characters into one space", () => {
    expect(
      markdownLink("a\n\r\tb\u0085c\u200bd\u2028e\u202ef\u2066g\ufeffh", "u"),
    ).toBe("[a b c d e f g h](u)");
    expect(markdownLink("a  \u0007 b", "u")).toBe("[a b](u)");
  });

  it("reads the name from a get_execution record under any casing", () => {
    expect(executionNameFromRecord({ execution_name: "run-7" })).toBe("run-7");
    expect(executionNameFromRecord({ executionName: "" })).toBeUndefined();
    expect(executionNameFromRecord(undefined)).toBeUndefined();
  });

  it("appends a viewerLink column titled by name, empty for rows with no ARN", async () => {
    viewer = makeViewer().viewer;
    const out = await withViewerLinks(
      {
        columns: ["execution_arn", "execution_name", "status"],
        rows: [
          [ARN, "run-1", "FAILED"],
          [OTHER_ARN, "", "SUCCEEDED"],
          ["n/a", "x", "?"],
        ],
        count: 3,
      },
      viewer,
    );
    expect(out.columns).toEqual([
      "execution_arn",
      "execution_name",
      "status",
      "viewerLink",
    ]);
    expect(out.rows[0][3]).toMatch(
      /^\[run-1\]\(http:\/\/127\.0\.0\.1:\d+\/e\/[A-Za-z0-9_-]{22}\)$/,
    );
    expect(out.rows[1][3]).toMatch(/^\[show execution\]\(http:/);
    expect(out.rows[2][3]).toBe("");
    expect(out.count).toBe(3);
  });

  it("titles every link 'show execution' when there is no name column", async () => {
    viewer = makeViewer().viewer;
    const out = await withViewerLinks(
      { columns: ["executionArn"], rows: [[ARN]] },
      viewer,
    );
    expect(out.rows[0][1]).toMatch(/^\[show execution\]\(http:/);
  });

  it("leaves results alone with no viewer, no ARNs, a viewerLink already, or no links", async () => {
    viewer = makeViewer().viewer;
    const withArn = { columns: ["executionArn"], rows: [[ARN]] };
    expect(await withViewerLinks(withArn, undefined)).toBe(withArn);
    const noArn = { columns: ["status"], rows: [["OK"]] };
    expect(await withViewerLinks(noArn, viewer)).toBe(noArn);
    const taken = {
      columns: ["executionArn", "viewerLink"],
      rows: [[ARN, "x"]],
    };
    expect(await withViewerLinks(taken, viewer)).toBe(taken);
    const broken = makeViewer().viewer;
    (broken as unknown as { listen: () => Promise<string> }).listen = () =>
      Promise.reject(new Error("EACCES"));
    expect(await withViewerLinks(withArn, broken)).toBe(withArn);
  });

  it("reaches the agent through the query, list and get tools", async () => {
    viewer = makeViewer().viewer;
    const server = new McpServer({ name: "s", version: "0" });
    // acceptedByEnv=true skips the credential prompt, which is not under test.
    registerTools(server, CONFIG, true, viewer);
    const client = new Client({ name: "c", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const table = {
      columns: ["executionarn", "status"],
      rows: [[ARN, "FAILED"]],
      count: 1,
      truncated: false,
      engine: "PostgreSQL",
    };
    runReadOnlyQuery.mockResolvedValue(table);
    runListExecutions.mockResolvedValue({
      ...table,
      destinationType: "aurora",
    });
    const parse = (r: unknown) =>
      JSON.parse(
        (r as { content: { text: string }[] }).content[0].text,
      ) as Record<string, any>;

    const q = parse(
      await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } }),
    );
    expect(q.columns).toEqual(["executionarn", "status", "viewerLink"]);
    expect(q.rows[0][2]).toMatch(
      /^\[show execution\]\(http:.*\/e\/[\w-]{22}\)$/,
    );

    const l = parse(
      await client.callTool({ name: "list_executions", arguments: {} }),
    );
    expect(l.columns.at(-1)).toBe("viewerLink");
    // The same execution gets the same link from every tool.
    expect(l.rows[0].at(-1)).toBe(q.rows[0][2]);

    runGetExecution.mockResolvedValue({
      destinationType: "aurora",
      engine: "PostgreSQL",
      found: true,
      executionArn: ARN,
      record: { execution_arn: ARN, execution_name: "run-1" },
    });
    const g = parse(
      await client.callTool({
        name: "get_execution",
        arguments: { executionArn: ARN },
      }),
    );
    expect(g.viewerLink).toMatch(/^\[run-1\]\(http:.*\/e\/[\w-]{22}\)$/);
    expect(g.viewerLink).not.toContain("durable-execution");

    // A record that was not found gets no link.
    runGetExecution.mockResolvedValue({
      destinationType: "aurora",
      engine: "PostgreSQL",
      found: false,
      executionArn: ARN,
    });
    const missing = parse(
      await client.callTool({
        name: "get_execution",
        arguments: { executionArn: ARN },
      }),
    );
    expect(missing.viewerLink).toBeUndefined();
    await client.close();
  });
});
