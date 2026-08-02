/*
 * Tests for the CDP inspector client. No real Lambda/inspector: an
 * in-process mock serves `/json/list` over real HTTP and speaks canned CDP
 * over a real WebSocket (same-port upgrade), mirroring exactly what the
 * tunnel proxy exposes locally in a real session.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { InspectorClient, type PausedEvent } from "./inspectorClient";

interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Mock inspector endpoint: one HTTP server that answers `GET /json/list`
 * AND hosts the CDP WebSocket (via upgrade). The advertised
 * `webSocketDebuggerUrl` deliberately uses a WRONG host — like the real
 * sandbox, which advertises its own internal address — to prove the client
 * rewrites it to `127.0.0.1:<port>`.
 */
class MockInspector {
  port = 0;
  /** Every CDP request the client sent, in order. */
  readonly requests: CdpRequest[] = [];
  /** How many `/json/list` responses should be EMPTY before a target is
   * advertised (discovery-retry test). */
  emptyListResponses = 0;
  listRequestCount = 0;
  /** Per-test request handler; return false to suppress the default reply
   * (used to hold responses for the out-of-order test). */
  onRequest?: (req: CdpRequest) => boolean | void;

  private httpServer!: http.Server;
  private wss!: WebSocketServer;
  private socket: WsSocket | undefined;

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === "/json/list") {
        this.listRequestCount++;
        const body =
          this.listRequestCount <= this.emptyListResponses
            ? []
            : [
                {
                  id: "abc-123",
                  // Wrong host on purpose — see class doc comment.
                  webSocketDebuggerUrl: "ws://169.254.100.1:9229/abc-123",
                },
              ];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws) => {
      this.socket = ws;
      ws.on("message", (data) => {
        const req = JSON.parse(String(data)) as CdpRequest;
        this.requests.push(req);
        if (this.onRequest?.(req) === false) {
          return;
        }
        this.defaultReply(req);
      });
    });
    await new Promise<void>((resolve) =>
      this.httpServer.listen(0, "127.0.0.1", resolve),
    );
    this.port = (this.httpServer.address() as AddressInfo).port;
  }

  private defaultReply(req: CdpRequest): void {
    const results: Record<string, unknown> = {
      "Debugger.setBreakpointByUrl": { breakpointId: "bp-1", locations: [] },
      "Runtime.getProperties": { result: [] },
    };
    this.reply(req.id, results[req.method] ?? {});
  }

  reply(id: number, result: unknown): void {
    this.socket!.send(JSON.stringify({ id, result }));
  }

  replyError(id: number, message: string): void {
    this.socket!.send(JSON.stringify({ id, error: { code: -32000, message } }));
  }

  sendEvent(method: string, params: unknown): void {
    this.socket!.send(JSON.stringify({ method, params }));
  }

  /** Drops the connection from the far side — what happens when the Lambda
   * sandbox ends (its invocation finished, or it was reclaimed). */
  dropConnection(): void {
    this.socket!.close();
  }

  async stop(): Promise<void> {
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) =>
      this.httpServer.close(() => resolve()),
    );
  }
}

/** Minimal paused-event params builder (CDP shape, pre-normalization). */
function pausedParams(tag: string, extra?: Record<string, unknown>) {
  return {
    reason: "other",
    callFrames: [
      {
        functionName: tag,
        location: { scriptId: "42", lineNumber: 7, columnNumber: 2 },
        scopeChain: [{ type: "local", object: { objectId: `obj-${tag}` } }],
      },
    ],
    ...extra,
  };
}

describe("InspectorClient", () => {
  let mock: MockInspector;
  let client: InspectorClient | undefined;

  beforeEach(async () => {
    mock = new MockInspector();
    await mock.start();
  });

  afterEach(async () => {
    client?.dispose();
    client = undefined;
    await mock.stop();
  });

  it("retries discovery while /json/list returns no targets, then connects to the rewritten URL", async () => {
    mock.emptyListResponses = 2;
    client = await InspectorClient.connect(mock.port, {
      discoveryTimeoutMs: 15_000,
    });
    // 2 empty + 1 with a target: proves the empty responses were retried,
    // not treated as fatal. The connection itself proves the host rewrite:
    // the advertised URL points at 169.254.100.1:9229, which doesn't exist —
    // only the rewritten 127.0.0.1:<mock port> can have succeeded.
    expect(mock.listRequestCount).toBe(3);
    const result = await client.send("Runtime.enable");
    expect(result).toEqual({});
  });

  it("fails discovery with a descriptive error after the deadline", async () => {
    mock.emptyListResponses = Number.MAX_SAFE_INTEGER;
    await expect(
      InspectorClient.connect(mock.port, { discoveryTimeoutMs: 1200 }),
    ).rejects.toThrow(/Timed out discovering inspector target/);
  });

  it("correlates out-of-order responses by id", async () => {
    client = await InspectorClient.connect(mock.port);
    const held: CdpRequest[] = [];
    mock.onRequest = (req) => {
      held.push(req);
      if (held.length === 2) {
        // Answer the SECOND request first — resolution must follow ids,
        // not arrival order.
        mock.reply(held[1].id, { which: "second" });
        mock.reply(held[0].id, { which: "first" });
      }
      return false;
    };

    const [a, b] = await Promise.all([
      client.send("Test.first"),
      client.send("Test.second"),
    ]);
    expect(a).toEqual({ which: "first" });
    expect(b).toEqual({ which: "second" });
  });

  it("rejects a send when the response carries an error", async () => {
    client = await InspectorClient.connect(mock.port);
    mock.onRequest = (req) => {
      mock.replyError(req.id, "boom");
      return false;
    };
    await expect(client.send("Debugger.resume")).rejects.toThrow(
      /Debugger\.resume failed: boom/,
    );
  });

  it("queues pauses that arrive before nextPause() and serves them in order", async () => {
    client = await InspectorClient.connect(mock.port);
    // Two pauses land back-to-back BEFORE anyone awaits — the stream
    // semantics the real Lambda exhibits (break-on-start, then breakpoint).
    mock.sendEvent("Debugger.paused", pausedParams("first"));
    mock.sendEvent("Debugger.paused", pausedParams("second"));

    const p1 = await client.nextPause(5000);
    const p2 = await client.nextPause(5000);
    expect(p1.callFrames[0].functionName).toBe("first");
    expect(p2.callFrames[0].functionName).toBe("second");
  });

  it("resolves a parked nextPause() waiter when the pause arrives, and times out otherwise", async () => {
    client = await InspectorClient.connect(mock.port);
    const waiting = client.nextPause(5000);
    mock.sendEvent(
      "Debugger.paused",
      pausedParams("late", { hitBreakpoints: ["bp-1"] }),
    );
    const paused = await waiting;
    expect(paused.hitBreakpoints).toEqual(["bp-1"]);
    expect(paused.reason).toBe("other"); // Verified real-Lambda breakpoint shape.

    await expect(client.nextPause(100)).rejects.toThrow(
      /Timed out after 100ms/,
    );
  });

  it("sends 0-based lineNumber in Debugger.setBreakpointByUrl params", async () => {
    client = await InspectorClient.connect(mock.port);
    const { breakpointId } = await client.setBreakpointByUrl("index\\.js$", 41);
    expect(breakpointId).toBe("bp-1");

    const req = mock.requests.find(
      (r) => r.method === "Debugger.setBreakpointByUrl",
    )!;
    // The helper passes the caller's 0-based line THROUGH — no off-by-one
    // adjustment hidden inside the client.
    expect(req.params).toEqual({ urlRegex: "index\\.js$", lineNumber: 41 });
  });

  it("enable() sends Runtime.enable then Debugger.enable", async () => {
    client = await InspectorClient.connect(mock.port);
    await client.enable();
    expect(mock.requests.map((r) => r.method)).toEqual([
      "Runtime.enable",
      "Debugger.enable",
    ]);
  });

  it("fires onPaused/onResumed callbacks and attributes frame urls from scriptParsed", async () => {
    client = await InspectorClient.connect(mock.port);
    const pauses: PausedEvent[] = [];
    client.onPaused((p) => pauses.push(p));
    const resumed = new Promise<void>((resolve) => client!.onResumed(resolve));

    // scriptParsed BEFORE the pause — the pause's frame has no url of its
    // own, so it must be attributed via the scriptId→url map.
    mock.sendEvent("Debugger.scriptParsed", {
      scriptId: "42",
      url: "file:///var/task/index.js",
    });
    mock.sendEvent("Debugger.paused", pausedParams("handler"));
    mock.sendEvent("Debugger.resumed", {});

    const paused = await client.nextPause(5000);
    expect(paused.callFrames[0].url).toBe("file:///var/task/index.js");
    expect(paused.callFrames[0].location).toEqual({
      scriptId: "42",
      lineNumber: 7,
      columnNumber: 2,
    });
    expect(paused.callFrames[0].scopeChain).toEqual([
      { type: "local", object: { objectId: "obj-handler" } },
    ]);
    expect(pauses).toHaveLength(1); // Callback fired in addition to the queue.
    // Resumed arrives AFTER paused on the wire; nextPause() resolving only
    // guarantees the paused message was processed — await the callback.
    await resumed;
    expect(client.scriptUrl("42")).toBe("file:///var/task/index.js");
  });

  it("getProperties requests ownProperties:true and drops accessor-only descriptors", async () => {
    client = await InspectorClient.connect(mock.port);
    mock.onRequest = (req) => {
      if (req.method === "Runtime.getProperties") {
        mock.reply(req.id, {
          result: [
            {
              name: "count",
              value: { type: "number", value: 3, description: "3" },
            },
            { name: "lazyGetter" }, // accessor without a stored value
          ],
        });
        return false;
      }
    };
    const props = await client.getProperties("obj-1");
    expect(props).toEqual([
      { name: "count", value: { type: "number", value: 3, description: "3" } },
    ]);
    const req = mock.requests.find(
      (r) => r.method === "Runtime.getProperties",
    )!;
    expect(req.params).toEqual({ objectId: "obj-1", ownProperties: true });
  });

  it("fires onClosed when the sandbox drops the connection, but NOT on dispose", async () => {
    // This is the signal a durable debug run re-attaches on: the sandbox
    // ending is routine (every suspend ends one), whereas dispose() is our
    // own deliberate teardown and must stay silent.
    client = await InspectorClient.connect(mock.port);
    const closed = jest.fn();
    client.onClosed(closed);

    mock.dropConnection();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(closed).toHaveBeenCalledTimes(1);

    // Only once, however the socket settles afterwards.
    client.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    client = undefined;
  });

  it("does not fire onClosed for a deliberate dispose", async () => {
    client = await InspectorClient.connect(mock.port);
    const closed = jest.fn();
    client.onClosed(closed);
    client.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(closed).not.toHaveBeenCalled();
    client = undefined;
  });

  it("invokes an onClosed callback registered AFTER the connection already died", async () => {
    // Ordering hazard: the socket can drop while the runner is still awaiting
    // enable()/breakpoints, i.e. before it registers its handler. A late
    // registrant must not be stranded waiting for an event that already fired.
    client = await InspectorClient.connect(mock.port);
    mock.dropConnection();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const closed = jest.fn();
    client.onClosed(closed);
    expect(closed).toHaveBeenCalledTimes(1);
    client = undefined;
  });

  it("dispose() rejects in-flight sends and parked pause waiters", async () => {
    client = await InspectorClient.connect(mock.port);
    mock.onRequest = () => false; // Hold every response forever.
    const inflight = client.send("Debugger.resume");
    const parked = client.nextPause(30_000);

    client.dispose();
    await expect(inflight).rejects.toThrow(/disposed/);
    await expect(parked).rejects.toThrow(/disposed/);
    await expect(client.send("Runtime.enable")).rejects.toThrow(/closed/);
    client = undefined;
  });
});
