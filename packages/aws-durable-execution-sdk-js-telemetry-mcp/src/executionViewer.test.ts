/**
 * The local execution viewer: what it exposes, to whom, and the links it adds
 * to tool results.
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
import { escapeHtml, renderExecutionPage } from "./executionPage";
import {
  ExecutionViewer,
  executionArnColumnIndex,
  readViewerSettings,
  VIEWER_HOST,
  withViewerLinks,
} from "./executionViewer";
import { registerTools } from "./registerTools";

const ARN =
  "arn:aws:lambda:eu-west-1:123456789012:function:orders:$LATEST/durable-execution/run-1/abc";
const CHILD_ARN =
  "arn:aws:lambda:eu-west-1:123456789012:function:child:1/durable-execution/c/1";

const CONFIG = readConfigFromEnv({
  DURABLE_TELEMETRY_DESTINATION_TYPE: "aurora",
  DURABLE_TELEMETRY_AURORA_RESOURCE_ARN: "arn:aws:rds:us-east-1:1:cluster:c",
  DURABLE_TELEMETRY_AURORA_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:1:secret:s",
  DURABLE_TELEMETRY_REGION: "us-east-1",
}).config;

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

/** A viewer whose Lambda client answers from fixed data, recording regions. */
function makeViewer(status = "RUNNING") {
  const regions: string[] = [];
  const logs: string[] = [];
  const viewer = new ExecutionViewer({
    config: CONFIG,
    log: (m) => logs.push(m),
    lambdaClientFor: (region) => ({
      send: async (cmd: { constructor: { name: string } }) => {
        regions.push(region);
        if (cmd.constructor.name === "GetDurableExecutionCommand") {
          return { DurableExecutionArn: ARN, Status: status };
        }
        return {
          Events: [
            { EventType: "StepStarted", Id: "s", Name: "<b>charge</b>" },
          ],
        };
      },
    }),
  });
  return { viewer, regions, logs };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so Host and Sec-Fetch-* can be set as a browser would. */
function get(
  origin: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
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

describe("execution page", () => {
  it("escapes every value from AWS", () => {
    const html = renderExecutionPage(
      detail({
        name: '<img src=x onerror="alert(1)">',
        input: '{"x":"</pre><script>alert(1)</script>"}',
        operations: [
          { id: "o", name: "<script>bad()</script>", status: "SUCCEEDED" },
        ],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("refreshes itself only while the execution is running", () => {
    expect(renderExecutionPage(detail({ status: "RUNNING" }))).toContain(
      'http-equiv="refresh"',
    );
    for (const status of ["SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"]) {
      expect(renderExecutionPage(detail({ status }))).not.toContain(
        'http-equiv="refresh"',
      );
    }
  });

  it("links a chained invoke to the child execution on the same origin", () => {
    const html = renderExecutionPage(
      detail({
        operations: [
          {
            id: "i",
            name: "call-child",
            kind: "ChainedInvoke",
            status: "SUCCEEDED",
            invokedFunction: "child",
            invokedExecutionArn: CHILD_ARN,
          },
        ],
      }),
    );
    expect(html).toContain(
      `href="/execution?arn=${escapeHtml(encodeURIComponent(CHILD_ARN))}"`,
    );
  });

  it("nests child operations under their parent", () => {
    const html = renderExecutionPage(
      detail({
        operations: [
          {
            id: "m",
            name: "map",
            status: "SUCCEEDED",
            children: [{ id: "c", name: "item-0", status: "SUCCEEDED" }],
          },
        ],
      }),
    );
    expect(html).toMatch(/<td class="d0">map<\/td>/);
    expect(html).toMatch(/<td class="d1">item-0<\/td>/);
    expect(html).toContain("Operations (2)");
  });
});

describe("ExecutionViewer server", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("does not open a port for a value that is not an execution ARN", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    expect(await viewer.linkFor("not-an-arn")).toBeUndefined();
    expect(await viewer.linkFor(42)).toBeUndefined();
    expect(made.logs).toEqual([]);
  });

  it("listens on loopback only and links to the execution page", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = await viewer.linkFor(ARN);
    expect(link).toBeDefined();
    const url = new URL(link ?? "");
    expect(url.hostname).toBe(VIEWER_HOST);
    expect(url.pathname).toBe("/execution");
    expect(url.searchParams.get("arn")).toBe(ARN);

    const res = await get(url.origin, url.pathname + url.search, {
      headers: { "Sec-Fetch-Site": "none" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain("&lt;b&gt;charge&lt;/b&gt;");
    expect(res.body).toContain('http-equiv="refresh"');
    // The client targets the region the ARN names, not the configured one.
    expect(new Set(made.regions)).toEqual(new Set(["eu-west-1"]));
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("serves the same page under localhost", async () => {
    viewer = makeViewer().viewer;
    const origin = (await viewer.start()) ?? "";
    const port = new URL(origin).port;
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`, {
      headers: { Host: `localhost:${port}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`, {
      headers: { Host: "attacker.example:80" },
    });
    expect(res.status).toBe(421);
    expect(made.regions).toEqual([]);
  });

  it.each(["cross-site", "same-site"])(
    "rejects a request a browser marks %s, before calling AWS",
    async (site) => {
      const made = makeViewer();
      viewer = made.viewer;
      const origin = (await viewer.start()) ?? "";
      const res = await get(
        origin,
        `/execution?arn=${encodeURIComponent(ARN)}`,
        { headers: { "Sec-Fetch-Site": site } },
      );
      expect(res.status).toBe(403);
      expect(made.regions).toEqual([]);
    },
  );

  it("accepts navigation within the viewer (same-origin)", async () => {
    viewer = makeViewer().viewer;
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  it("is read-only and answers only its own paths", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const origin = (await viewer.start()) ?? "";
    const post = await get(origin, "/execution", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expect((await get(origin, "/")).status).toBe(404);
    expect((await get(origin, "/execution?arn=bogus")).status).toBe(400);
    const css = await get(origin, "/viewer.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
    expect(made.regions).toEqual([]);
  });

  it("reports an AWS failure as a page, not a crash", async () => {
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async () => {
          throw new Error("ExpiredTokenException");
        },
      }),
    });
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`);
    expect(res.status).toBe(502);
    expect(res.body).toContain("ExpiredTokenException");
  });

  it("falls back to a free port when the configured one is taken", async () => {
    const first = makeViewer().viewer;
    const origin = (await first.start()) ?? "";
    const taken = Number(new URL(origin).port);
    const logs: string[] = [];
    viewer = new ExecutionViewer({
      config: CONFIG,
      port: taken,
      log: (m) => logs.push(m),
    });
    const second = (await viewer.start()) ?? "";
    expect(second).not.toBe(origin);
    expect(logs.join("\n")).toContain(`port ${taken} is in use`);
    await first.close();
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
    expect(executionArnColumnIndex(["status"], [["OK"]])).toBe(-1);
  });

  it("appends a viewerUrl column, empty for rows with no ARN", async () => {
    viewer = makeViewer().viewer;
    const out = await withViewerLinks(
      {
        columns: ["executionArn", "status"],
        rows: [
          [ARN, "FAILED"],
          ["n/a", "?"],
        ],
        count: 2,
      },
      viewer,
    );
    expect(out.columns).toEqual(["executionArn", "status", "viewerUrl"]);
    expect(out.rows[0][2]).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/execution\?arn=/,
    );
    expect(out.rows[1][2]).toBe("");
    expect(out.count).toBe(2);
  });

  it("leaves results alone with no viewer, no ARNs, or a viewerUrl already", async () => {
    viewer = makeViewer().viewer;
    const withArn = { columns: ["executionArn"], rows: [[ARN]] };
    expect(await withViewerLinks(withArn, undefined)).toBe(withArn);
    const noArn = { columns: ["status"], rows: [["OK"]] };
    expect(await withViewerLinks(noArn, viewer)).toBe(noArn);
    const taken = {
      columns: ["executionArn", "viewerUrl"],
      rows: [[ARN, "x"]],
    };
    expect(await withViewerLinks(taken, viewer)).toBe(taken);
  });

  it("reaches the agent through the query, list, and get tools", async () => {
    viewer = makeViewer().viewer;
    const server = new McpServer({ name: "s", version: "0" });
    // acceptedByEnv=true skips the write-access check, which is not under test.
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
    runGetExecution.mockResolvedValue({
      destinationType: "aurora",
      engine: "PostgreSQL",
      found: true,
      executionArn: ARN,
    });

    const parse = (r: unknown) =>
      JSON.parse(
        (r as { content: { text: string }[] }).content[0].text,
      ) as Record<string, any>;

    const q = parse(
      await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } }),
    );
    expect(q.columns).toEqual(["executionarn", "status", "viewerUrl"]);
    expect(q.rows[0][2]).toContain(encodeURIComponent(ARN));

    const l = parse(
      await client.callTool({ name: "list_executions", arguments: {} }),
    );
    expect(l.columns.at(-1)).toBe("viewerUrl");

    const g = parse(
      await client.callTool({
        name: "get_execution",
        arguments: { executionArn: ARN },
      }),
    );
    expect(g.viewerUrl).toContain(encodeURIComponent(ARN));
    await client.close();
  });
});

describe("readViewerSettings", () => {
  const names = { disabled: "D", port: "P" };
  it("defaults to enabled on a free port", () => {
    expect(readViewerSettings({}, names)).toEqual({
      enabled: true,
      port: 0,
      warnings: [],
    });
  });
  it("can be disabled, and takes a fixed port", () => {
    expect(readViewerSettings({ D: "TRUE", P: "8765" }, names)).toEqual({
      enabled: false,
      port: 8765,
      warnings: [],
    });
  });
  it.each(["-1", "70000", "abc", "1.5"])(
    "warns about port %s and uses a free one",
    (p) => {
      const s = readViewerSettings({ P: p }, names);
      expect(s.port).toBe(0);
      expect(s.warnings).toHaveLength(1);
    },
  );
});
