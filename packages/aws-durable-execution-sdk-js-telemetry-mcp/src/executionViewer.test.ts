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
import { connect } from "node:net";
import type { ExecutionDetail } from "@aws/durable-execution-sdk-js-telemetry-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readConfigFromEnv } from "./config";
import {
  escapeHtml,
  executionPath,
  MAX_FIELD_CHARS,
  refreshHref,
  MAX_OPERATION_ROWS,
  MAX_PAGE_PAYLOAD_CHARS,
  MAX_PAYLOAD_CHARS,
  renderExecutionPage,
  VIEWER_CSS,
} from "./executionPage";
import { isDurableExecutionArn } from "@aws/durable-execution-sdk-js-telemetry-core";
import {
  ExecutionViewer,
  executionArnColumnIndex,
  MAX_CHILDREN_PER_PAGE,
  RESPONSE_TIMEOUT_MS,
  executionNameColumnIndex,
  executionNameFromRecord,
  markdownLink,
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

/**
 * Each started viewer's token prefix ("/s/<token>"), by origin. Tests request
 * "/execution?…" paths, and `get` adds the prefix so they reach the handler
 * behind the token check; pass `noToken` to test that check itself. The prefix
 * comes from a link the viewer hands out, the same way a user gets it.
 */
const tokenPrefix = new Map<string, string>();
const originalStart = ExecutionViewer.prototype.start;
ExecutionViewer.prototype.start = async function (this: ExecutionViewer) {
  const origin = await originalStart.call(this);
  if (origin && !tokenPrefix.has(origin)) {
    // Recorded before linking: linkFor calls start() again.
    tokenPrefix.set(origin, "");
    const link = await this.linkFor(
      "arn:aws:lambda:us-east-1:123456789012:function:t:1/durable-execution/token-probe/1",
    );
    const path = new URL(link ?? origin).pathname;
    tokenPrefix.set(origin, path.slice(0, path.indexOf("/execution")));
  }
  return origin;
};

/** A raw request, so Host and Sec-Fetch-* can be set as a browser would. */
function get(
  origin: string,
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    noToken?: boolean;
  } = {},
): Promise<Reply> {
  if (path.startsWith("/execution") && !opts.noToken) {
    path = `${tokenPrefix.get(origin) ?? ""}${path}`;
  }
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

  it("never reloads itself, and offers a Refresh link instead", () => {
    for (const status of ["RUNNING", "SUCCEEDED", "FAILED", ""]) {
      const html = renderExecutionPage(detail({ status }));
      expect(html).not.toContain("http-equiv");
      expect(html).toContain(`href="${escapeHtml(refreshHref(ARN))}"`);
      // An inline icon: the page still loads nothing but its stylesheet.
      expect(html).toMatch(/<a class="refresh"[^>]*><svg /);
    }
    expect(refreshHref(ARN)).toMatch(/^execution\?arn=[^&]+&refresh=1$/);
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
      // Relative, so it resolves under the current page's /s/<token>/.
      `href="execution?arn=${escapeHtml(encodeURIComponent(CHILD_ARN))}"`,
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
    expect(url.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}\/execution$/);
    expect(url.searchParams.get("arn")).toBe(ARN);

    const res = await get(url.origin, url.pathname + url.search, {
      headers: { "Sec-Fetch-Site": "none" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain("&lt;b&gt;charge&lt;/b&gt;");
    expect(res.body).not.toContain("http-equiv");
    expect(res.body).toContain('class="refresh"');
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
    await viewer.linkFor(ARN);
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
    await viewer.linkFor(ARN);
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
    await viewer.linkFor(ARN);
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
    expect(markdownLink("a]b[c\\d", "http://x")).toBe(
      "[a\\]b\\[c\\\\d](http://x)",
    );
    const long = markdownLink("n".repeat(200), "http://x");
    expect(long.length).toBeLessThan(100);
    expect(long).toContain("…](http://x)");
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
          [CHILD_ARN, "", "SUCCEEDED"],
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
      /^\[run-1\]\(http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]{43}\/execution\?arn=[^)]+\)$/,
    );
    expect(out.rows[1][3]).toMatch(/^\[show execution\]\(http:/);
    expect(out.rows[2][3]).toBe("");
    expect(out.count).toBe(3);
  });

  it("leaves results alone with no viewer, no ARNs, or a viewerLink already", async () => {
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
      record: { execution_arn: ARN, execution_name: "run-1" },
    });

    const parse = (r: unknown) =>
      JSON.parse(
        (r as { content: { text: string }[] }).content[0].text,
      ) as Record<string, any>;

    const q = parse(
      await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } }),
    );
    expect(q.columns).toEqual(["executionarn", "status", "viewerLink"]);
    expect(q.rows[0][2]).toContain(encodeURIComponent(ARN));
    expect(q.rows[0][2]).toMatch(/^\[show execution\]\(/);

    const l = parse(
      await client.callTool({ name: "list_executions", arguments: {} }),
    );
    expect(l.columns.at(-1)).toBe("viewerLink");

    const g = parse(
      await client.callTool({
        name: "get_execution",
        arguments: { executionArn: ARN },
      }),
    );
    expect(g.viewerLink).toMatch(/^\[run-1\]\(http:/);
    expect(g.viewerLink).toContain(encodeURIComponent(ARN));
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

describe("security fixes", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  const otherAccount =
    "arn:aws:lambda:ap-southeast-2:999999999999:function:x:1/durable-execution/a/b";

  it("serves only executions it linked, and makes no AWS call for others", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const res = await get(
      origin,
      `/execution?arn=${encodeURIComponent(otherAccount)}`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toContain("Link not recognized");
    expect(made.regions).toEqual([]);
    expect(
      (await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`)).status,
    ).toBe(200);
  });

  it("serves a child execution once its parent's page has linked it", async () => {
    const regions: string[] = [];
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: (region) => ({
        send: async (cmd: { constructor: { name: string }; input: any }) => {
          regions.push(region);
          if (cmd.constructor.name === "GetDurableExecutionCommand") {
            return {
              DurableExecutionArn: cmd.input.DurableExecutionArn,
              Status: "SUCCEEDED",
            };
          }
          return {
            Events:
              cmd.input.DurableExecutionArn === ARN
                ? [
                    {
                      EventType: "ChainedInvokeStarted",
                      Id: "i",
                      ChainedInvokeStartedDetails: {
                        FunctionName: "child",
                        DurableExecutionArn: CHILD_ARN,
                      },
                    },
                  ]
                : [],
          };
        },
      }),
    });
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const child = `/execution?arn=${encodeURIComponent(CHILD_ARN)}`;
    expect((await get(origin, child)).status).toBe(404);
    expect(
      (await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`)).status,
    ).toBe(200);
    expect((await get(origin, child)).status).toBe(200);
  });

  it.each([
    ["a foreign Origin", { Origin: "https://evil.example" }],
    ["an image load", { "Sec-Fetch-Dest": "image" }],
    ["a fetch()", { "Sec-Fetch-Dest": "empty" }],
  ])("rejects %s before calling AWS", async (_label, headers) => {
    const made = makeViewer();
    viewer = made.viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`, {
      headers,
    });
    expect(res.status).toBe(403);
    expect(made.regions).toEqual([]);
  });

  it("accepts its own Origin and a document or stylesheet load", async () => {
    viewer = makeViewer().viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const page = `/execution?arn=${encodeURIComponent(ARN)}`;
    expect(
      (await get(origin, page, { headers: { Origin: origin } })).status,
    ).toBe(200);
    expect(
      (
        await get(origin, page, {
          headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await get(origin, "/viewer.css", {
          headers: { "Sec-Fetch-Dest": "style" },
        })
      ).status,
    ).toBe(200);
  });

  it("answers HEAD without calling AWS", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`, {
      method: "HEAD",
    });
    expect(res.status).toBe(200);
    expect(made.regions).toEqual([]);
  });

  it("rejects an absolute-form request line", async () => {
    viewer = makeViewer().viewer;
    const origin = (await viewer.start()) ?? "";
    const port = Number(new URL(origin).port);
    const status = await new Promise<string>((resolve, reject) => {
      const sock = connect(port, "127.0.0.1", () => {
        sock.write(
          `GET http://evil.example/execution HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
        );
      });
      let data = "";
      sock.on("data", (c) => {
        data += c;
      });
      sock.on("end", () => resolve(data.split("\r\n")[0]));
      sock.on("error", reject);
    });
    expect(status).toBe("HTTP/1.1 400 Bad Request");
  });

  it("sends Cross-Origin-Opener-Policy", async () => {
    viewer = makeViewer().viewer;
    const origin = (await viewer.start()) ?? "";
    expect(
      (await get(origin, "/viewer.css")).headers["cross-origin-opener-policy"],
    ).toBe("same-origin");
  });

  it("caps concurrent fetches and shares one fetch per execution", async () => {
    let inFlight = 0;
    let peak = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string }; input: any }) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await gate;
          inFlight--;
          return cmd.constructor.name === "GetDurableExecutionCommand"
            ? {
                DurableExecutionArn: cmd.input.DurableExecutionArn,
                Status: "SUCCEEDED",
              }
            : { Events: [] };
        },
      }),
    });
    const arns = Array.from(
      { length: 6 },
      (_, i) =>
        `arn:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/e${i}/1`,
    );
    for (const a of arns) await viewer.linkFor(a);
    const origin = (await viewer.start()) ?? "";
    const path = (a: string) => `/execution?arn=${encodeURIComponent(a)}`;
    // Waits until `n` fetches are blocked on the fake Lambda, so the test
    // does not depend on timing or on the order requests arrive.
    const inFlightReaches = async (n: number) => {
      while (inFlight < n) await new Promise((r) => setTimeout(r, 5));
    };
    // One fetch for arns[0], then three more distinct ones fill the cap of 4.
    const pending = [get(origin, path(arns[0]))];
    await inFlightReaches(1);
    pending.push(...arns.slice(1, 4).map((a) => get(origin, path(a))));
    await inFlightReaches(4);
    // Two more requests for arns[0] share its fetch; two new executions get
    // 503 at once, while the cap is full.
    pending.push(get(origin, path(arns[0])), get(origin, path(arns[0])));
    const refused = await Promise.all(
      arns.slice(4).map((a) => get(origin, path(a))),
    );
    expect(refused.map((r) => r.status)).toEqual([503, 503]);
    release();
    pending.push(...refused.map((r) => Promise.resolve(r)));
    const statuses = (await Promise.all(pending)).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(6);
    expect(statuses.filter((s) => s === 503)).toHaveLength(2);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("keeps link text and URL inside the Markdown link", async () => {
    viewer = makeViewer().viewer;
    const link = markdownLink(
      "a\n\n![x](https://evil.example/p.png) `c` <b>",
      "http://x/y",
    );
    expect(link).not.toContain("\n");
    expect(link).toBe(
      "[a !\\[x\\](https://evil.example/p.png) \\`c\\` \\<b\\>](http://x/y)",
    );
    expect(executionPath(ARN)).not.toMatch(/[()!*'~]/);
    expect(isDurableExecutionArn(`${ARN})--evil(`)).toBe(false);
  });

  it("caps payload text on the page", () => {
    const big = "x".repeat(MAX_PAYLOAD_CHARS * 2);
    const ops = Array.from({ length: 60 }, (_, i) => ({
      id: `s${i}`,
      status: "SUCCEEDED",
      result: big,
    }));
    const html = renderExecutionPage(detail({ input: big, operations: ops }));
    expect(html).toContain("shortened in the viewer");
    expect(html).toContain(
      "Not shown: this page already shows as much payload",
    );
    expect(html.length).toBeLessThan(MAX_PAGE_PAYLOAD_CHARS + 500_000);
  });
});

describe("round-2 fixes", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  /** A viewer whose fake Lambda counts calls; history from `events`. */
  function counting(events: () => unknown[] = () => []) {
    const calls = { n: 0 };
    const v = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string }; input: any }) => {
          calls.n++;
          return cmd.constructor.name === "GetDurableExecutionCommand"
            ? {
                DurableExecutionArn: cmd.input.DurableExecutionArn,
                Status: "RUNNING",
              }
            : { Events: events() };
        },
      }),
    });
    return { v, calls };
  }

  it("serves a repeat request from the page cache, without calling Lambda", async () => {
    const { v, calls } = counting();
    viewer = v;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const path = `/execution?arn=${encodeURIComponent(ARN)}`;
    expect((await get(origin, path)).status).toBe(200);
    const after = calls.n;
    for (let i = 0; i < 5; i++)
      expect((await get(origin, path)).status).toBe(200);
    expect(calls.n).toBe(after);
  });

  it("answers 503 with a self-reloading page when unsent bytes would pass the ceiling", async () => {
    // '"' escapes to 6 bytes, so each page is about 12 MB: more than the
    // kernel's socket buffer absorbs for a client that stops reading.
    const big = '"'.repeat(MAX_PAYLOAD_CHARS);
    const { v } = counting(() =>
      Array.from({ length: 40 }, (_, i) => ({
        EventType: "StepSucceeded",
        Id: `s${i}`,
        StepSucceededDetails: { Result: { Payload: big } },
      })),
    );
    viewer = v;
    // 40 distinct linked executions; clients never read past the status line.
    const arns = Array.from(
      { length: 40 },
      (_, i) =>
        `arn:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/u${i}/1`,
    );
    for (const a of arns) await viewer.linkFor(a);
    const origin = (await viewer.start()) ?? "";
    const port = Number(new URL(origin).port);
    const statuses: string[] = [];
    const sockets: import("node:net").Socket[] = [];
    for (const a of arns) {
      const sock = connect(port, "127.0.0.1");
      sockets.push(sock);
      sock.pause(); // stop reading after the response starts
      const line = await new Promise<string>((resolve) => {
        sock.once("readable", () => {
          const chunk = sock.read(64) as Buffer | null;
          resolve(
            (chunk ?? Buffer.alloc(0)).toString("latin1").split("\r\n")[0],
          );
        });
        sock.write(
          `GET ${tokenPrefix.get(origin)}/execution?arn=${encodeURIComponent(a)} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
        );
      });
      statuses.push(line);
    }
    for (const s of sockets) s.destroy();
    expect(statuses.filter((s) => s.includes(" 200 ")).length).toBeGreaterThan(
      0,
    );
    const busy = statuses.filter((s) => s.includes(" 503 ")).length;
    expect(busy).toBeGreaterThan(0);
    // 64 MB of ~12 MB pages: a handful are served before the rest are refused.
    expect(statuses.filter((s) => s.includes(" 200 ")).length).toBeLessThan(10);
  }, 30_000);

  it("lets at most MAX_CHILDREN_PER_PAGE children into the linked set", async () => {
    const children = Array.from(
      { length: MAX_CHILDREN_PER_PAGE + 5 },
      (_, i) =>
        `arn:aws:lambda:us-east-1:123456789012:function:c:1/durable-execution/k${i}/1`,
    );
    const { v } = counting(() =>
      children.map((c, i) => ({
        EventType: "ChainedInvokeStarted",
        Id: `i${i}`,
        ChainedInvokeStartedDetails: {
          FunctionName: "c",
          DurableExecutionArn: c,
        },
      })),
    );
    viewer = v;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    expect(
      (await get(origin, `/execution?arn=${encodeURIComponent(ARN)}`)).status,
    ).toBe(200);
    const head = (a: string) =>
      get(origin, `/execution?arn=${encodeURIComponent(a)}`, {
        method: "HEAD",
      });
    expect((await head(children[0])).status).toBe(200);
    expect((await head(children[MAX_CHILDREN_PER_PAGE])).status).toBe(404);
  });

  it("strips bidi, zero-width, and C1 characters from link text", () => {
    expect(markdownLink("a\u202Eb\u200Bc\u009Bd\uFEFFe", "http://x")).toBe(
      "[a b c d e](http://x)",
    );
  });

  it("caps every rendered field and the operations table", () => {
    const quote = '"'.repeat(MAX_FIELD_CHARS * 4);
    const ops = Array.from({ length: MAX_OPERATION_ROWS + 50 }, (_, i) => ({
      id: `o${i}`,
      name: quote,
      kind: quote,
      status: "SUCCEEDED",
    }));
    const html = renderExecutionPage(detail({ name: quote, operations: ops }));
    expect(html).toContain(
      `Showing the first ${MAX_OPERATION_ROWS.toLocaleString("en-US")} operations`,
    );
    expect((html.match(/<tr>/g) ?? []).length).toBeLessThanOrEqual(
      MAX_OPERATION_ROWS + 3,
    );
    // Each '"' escapes to 6 bytes; two capped fields per row.
    expect(html.length).toBeLessThan(
      MAX_OPERATION_ROWS * 2 * MAX_FIELD_CHARS * 6 * 1.2,
    );
  });

  it("bounds the page even when payloads grow under HTML escaping", () => {
    const quotes = '"'.repeat(MAX_PAYLOAD_CHARS);
    const ops = Array.from({ length: 60 }, (_, i) => ({
      id: `s${i}`,
      status: "SUCCEEDED",
      result: quotes,
    }));
    const html = renderExecutionPage(detail({ operations: ops }));
    // 2 MB of payload characters, each at most 6 bytes once escaped.
    expect(html.length).toBeLessThan(MAX_PAGE_PAYLOAD_CHARS * 6 + 1_000_000);
  });
});

describe("session token", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });
  const page = `/execution?arn=${encodeURIComponent(ARN)}`;

  it("refuses a linked execution without the token, before calling AWS", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    // A local process that knows the ARN and sends perfect headers.
    const res = await get(origin, page, {
      noToken: true,
      headers: { "Sec-Fetch-Site": "none", "Sec-Fetch-Dest": "document" },
    });
    expect(res.status).toBe(403);
    expect(res.body).toContain("Link not valid");
    expect(made.regions).toEqual([]);
  });

  it("refuses a wrong, shortened, or empty token", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const prefix = tokenPrefix.get(origin) ?? "";
    for (const path of [
      `/s/${"A".repeat(43)}${page}`,
      `${prefix.slice(0, -1)}${page}`,
    ]) {
      expect((await get(origin, path, { noToken: true })).status).toBe(403);
    }
    // No token segment at all is not a page this server gives out.
    expect((await get(origin, `/s/${page}`, { noToken: true })).status).toBe(
      404,
    );
    expect(made.regions).toEqual([]);
  });

  it("sets no cookie, and keeps the token in the page's own links", async () => {
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string }; input: any }) =>
          cmd.constructor.name === "GetDurableExecutionCommand"
            ? {
                DurableExecutionArn: cmd.input.DurableExecutionArn,
                Status: "RUNNING",
              }
            : {
                Events: [
                  {
                    EventType: "ChainedInvokeStarted",
                    Id: "i",
                    ChainedInvokeStartedDetails: {
                      FunctionName: "child",
                      DurableExecutionArn: CHILD_ARN,
                    },
                  },
                ],
              },
      }),
    });
    const link = (await viewer.linkFor(ARN)) ?? "";
    const origin = (await viewer.start()) ?? "";
    const res = await get(origin, page, {
      headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" },
    });
    // Served directly: no redirect, and no cookie for other 127.0.0.1 servers.
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers.location).toBeUndefined();
    // The Refresh link and the child link are relative, so both resolve
    // under the same /s/<token>/ path.
    const refresh = res.body.match(/class="refresh" href="([^"]+)"/)?.[1] ?? "";
    const refreshUrl = new URL(refresh.replace(/&amp;/g, "&"), link);
    expect(refreshUrl.pathname).toBe(new URL(link).pathname);
    expect(
      (
        await get(origin, refreshUrl.pathname + refreshUrl.search, {
          noToken: true,
        })
      ).status,
    ).toBe(200);
    const href = res.body.match(/href="(execution\?arn=[^"]+)"/)?.[1] ?? "";
    const childUrl = new URL(href, link);
    expect(childUrl.pathname).toBe(new URL(link).pathname);
    expect(
      (
        await get(origin, childUrl.pathname + childUrl.search, {
          noToken: true,
        })
      ).status,
    ).toBe(200);
  });

  it("refuses a request whose only credential is a cookie", async () => {
    const made = makeViewer();
    viewer = made.viewer;
    const link = (await viewer.linkFor(ARN)) ?? "";
    const origin = (await viewer.start()) ?? "";
    const token = new URL(link).pathname.split("/")[2];
    const port = new URL(origin).port;
    const res = await get(origin, page, {
      noToken: true,
      headers: { Cookie: `durable_viewer_${port}=${token}` },
    });
    expect(res.status).toBe(403);
    expect(made.regions).toEqual([]);
  });

  it("is new for every viewer", async () => {
    const a = makeViewer().viewer;
    viewer = makeViewer().viewer;
    const la = (await a.linkFor(ARN)) ?? "";
    const lb = (await viewer.linkFor(ARN)) ?? "";
    expect(new URL(la).pathname).not.toBe(new URL(lb).pathname);
    await a.close();
  });
});

describe("round-3 fixes", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("shows a full real-length callback ID", () => {
    const id = `${"c".repeat(300)}-${"d".repeat(63)}`;
    const html = renderExecutionPage(
      detail({ operations: [{ id: "o", status: "STARTED", callbackId: id }] }),
    );
    expect(html).toContain(id);
  });

  it("keeps viewed parents linked when they add many children", async () => {
    const parents = Array.from(
      { length: 10 },
      (_, i) =>
        `arn:aws:lambda:us-east-1:123456789012:function:p:1/durable-execution/p${i}/1`,
    );
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string }; input: any }) => {
          const arn = cmd.input.DurableExecutionArn as string;
          if (cmd.constructor.name === "GetDurableExecutionCommand") {
            return { DurableExecutionArn: arn, Status: "SUCCEEDED" };
          }
          const p = arn.split("/")[2];
          return {
            Events: Array.from({ length: 1000 }, (_, i) => ({
              EventType: "ChainedInvokeStarted",
              Id: `i${i}`,
              ChainedInvokeStartedDetails: {
                FunctionName: "c",
                DurableExecutionArn: `arn:aws:lambda:us-east-1:123456789012:function:c:1/durable-execution/${p}-c${i}/1`,
              },
            })),
          };
        },
      }),
    });
    // Ten open pages, linked first and then each loaded: 10 parents plus
    // 10,000 children fill the 10,000-entry set exactly.
    for (const p of parents) await viewer.linkFor(p);
    const origin = (await viewer.start()) ?? "";
    const path = (p: string) => `/execution?arn=${encodeURIComponent(p)}`;
    for (const p of parents)
      expect((await get(origin, path(p))).status).toBe(200);
    // Each parent is re-linked after its own children, so every page being
    // viewed still reloads. Before the fix, all ten reloads got 404.
    for (const p of parents) {
      expect((await get(origin, path(p), { method: "HEAD" })).status).toBe(200);
    }
  });

  it("does not cache a page whose history failed", async () => {
    let historyCalls = 0;
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string } }) => {
          if (cmd.constructor.name === "GetDurableExecutionCommand") {
            return { DurableExecutionArn: ARN, Status: "RUNNING" };
          }
          historyCalls++;
          throw new Error("ThrottlingException");
        },
      }),
    });
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const path = `/execution?arn=${encodeURIComponent(ARN)}`;
    expect((await get(origin, path)).body).toContain("History unavailable");
    await get(origin, path);
    expect(historyCalls).toBe(2);
  });

  it("does not cut off a client waiting on a slow fetch", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => {
      release = r;
    });
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string } }) => {
          await slow;
          return cmd.constructor.name === "GetDurableExecutionCommand"
            ? { DurableExecutionArn: ARN, Status: "SUCCEEDED" }
            : { Events: [] };
        },
      }),
    });
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    // The delivery timer must not be armed while the fetch runs. With it
    // shortened to 50 ms for this test, a 300 ms fetch would otherwise reset
    // the connection.
    const realSetTimeout = global.setTimeout;
    const spy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: () => void, ms?: number) =>
        realSetTimeout(fn, ms === RESPONSE_TIMEOUT_MS ? 50 : ms)) as never);
    try {
      const pending = get(origin, `/execution?arn=${encodeURIComponent(ARN)}`);
      await new Promise((r) => realSetTimeout(r, 300));
      release();
      expect((await pending).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("page text for retries and partial history", () => {
  it("shows a pending retry with its next attempt time", () => {
    const html = renderExecutionPage(
      detail({
        status: "RUNNING",
        operations: [
          {
            id: "s",
            name: "charge",
            status: "PENDING",
            attempt: 1,
            nextAttemptTime: "2025-01-01T00:00:31.000Z",
            error: '{"errorMessage":"try 1"}',
          },
        ],
      }),
    );
    expect(html).toContain("status-pending");
    expect(html).toContain("Next attempt 2025-01-01 00:00:31 UTC");
  });

  it("says history is incomplete when some was read before a failure", () => {
    const html = renderExecutionPage(
      detail({
        history: [{ eventId: 1, type: "StepStarted" }],
        operations: [{ id: "s", status: "RUNNING" }],
        historyError: "ThrottlingException",
      }),
    );
    expect(html).toContain(
      "History is incomplete: reading it failed after 1 events",
    );
    expect(html).not.toContain("operations are not shown");
  });

  it("says history is unavailable when none was read", () => {
    const html = renderExecutionPage(detail({ historyError: "AccessDenied" }));
    expect(html).toContain("History unavailable, so operations are not shown");
  });

  it("does not call an execution with no status running", () => {
    expect(renderExecutionPage(detail({ status: "" }))).not.toContain(
      "Still running",
    );
  });

  it("styles an incomplete operation", () => {
    const html = renderExecutionPage(
      detail({ operations: [{ id: "s", status: "INCOMPLETE" }] }),
    );
    expect(html).toContain('class="status status-incomplete"');
    expect(VIEWER_CSS).toContain(".status-incomplete");
  });
});

describe("Refresh link", () => {
  let viewer: ExecutionViewer;
  afterEach(async () => {
    await viewer?.close();
  });

  it("skips the page cache, so a click always shows current data", async () => {
    let calls = 0;
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string } }) => {
          calls++;
          return cmd.constructor.name === "GetDurableExecutionCommand"
            ? { DurableExecutionArn: ARN, Status: "RUNNING" }
            : { Events: [] };
        },
      }),
    });
    await viewer.linkFor(ARN);
    const origin = (await viewer.start()) ?? "";
    const page = `/execution?arn=${encodeURIComponent(ARN)}`;
    await get(origin, page);
    const first = calls;
    await get(origin, page); // within 5 s: served from the cache
    expect(calls).toBe(first);
    await get(origin, `${page}&refresh=1`); // Refresh: read again
    expect(calls).toBe(first * 2);
  });

  it("puts a Try again link, not a reload, on the Busy page", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    viewer = new ExecutionViewer({
      config: CONFIG,
      lambdaClientFor: () => ({
        send: async (cmd: { constructor: { name: string }; input: any }) => {
          await gate;
          return cmd.constructor.name === "GetDurableExecutionCommand"
            ? {
                DurableExecutionArn: cmd.input.DurableExecutionArn,
                Status: "RUNNING",
              }
            : { Events: [] };
        },
      }),
    });
    const arns = Array.from(
      { length: 5 },
      (_, i) =>
        `arn:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/b${i}/1`,
    );
    for (const a of arns) await viewer.linkFor(a);
    const origin = (await viewer.start()) ?? "";
    const path = (a: string) => `/execution?arn=${encodeURIComponent(a)}`;
    const pending = arns.slice(0, 4).map((a) => get(origin, path(a)));
    await new Promise((r) => setTimeout(r, 50));
    const busy = await get(origin, path(arns[4]));
    expect(busy.status).toBe(503);
    expect(busy.body).not.toContain("http-equiv");
    expect(busy.body).toContain(`href="${escapeHtml(refreshHref(arns[4]))}"`);
    expect(busy.body).toContain("Try again");
    release();
    await Promise.all(pending);
  });
});
