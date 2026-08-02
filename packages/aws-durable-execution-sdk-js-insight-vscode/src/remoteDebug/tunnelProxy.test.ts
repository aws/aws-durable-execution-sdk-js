/*
 * Tests for the Secure Tunneling source-mode local proxy. No real AWS
 * calls: the proxy's `endpoint` test seam points it at an in-process
 * WebSocketServer that speaks just enough of the tunneling protocol
 * (SERVICE_IDS on connect, frame capture, optional DATA echo).
 */

import * as net from "node:net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import {
  chunkForTunnel,
  encodeTunnelFrame,
  FrameDecoder,
  LocalTunnelProxy,
  MAX_PAYLOAD_BYTES,
  MessageType,
  type TunnelMessage,
} from "./tunnelProxy";

/** Poll until `condition` is true or the deadline passes. */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Minimal in-process stand-in for the tunneling data plane: accepts the
 * WebSocket, immediately sends SERVICE_IDS (like the real service), and
 * records every decoded tunnel message the proxy sends.
 */
class MockTunnelServer {
  readonly received: TunnelMessage[] = [];
  private wss!: WebSocketServer;
  private client: WsSocket | undefined;
  private decoder = new FrameDecoder();
  port = 0;
  /** When true, DATA messages are echoed back verbatim. */
  echoData = false;
  serviceIds: string[] = ["WSS"];

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => this.wss.once("listening", resolve));
    this.port = (this.wss.address() as net.AddressInfo).port;
    this.wss.on("connection", (ws) => {
      this.client = ws;
      this.decoder = new FrameDecoder();
      ws.send(
        encodeTunnelFrame({
          type: MessageType.SERVICE_IDS,
          availableServiceIds: this.serviceIds,
        }),
      );
      ws.on("message", (data) => {
        const buf = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as Buffer);
        for (const message of this.decoder.push(buf)) {
          this.received.push(message);
          if (this.echoData && message.type === MessageType.DATA) {
            ws.send(
              encodeTunnelFrame({
                type: MessageType.DATA,
                streamId: message.streamId,
                connectionId: message.connectionId,
                serviceId: message.serviceId,
                payload: message.payload,
              }),
            );
          }
        }
      });
    });
  }

  /** Send a raw pre-framed buffer to the connected proxy. */
  sendRaw(buf: Buffer): void {
    this.client!.send(buf);
  }

  async stop(): Promise<void> {
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

/** TCP client helper that collects everything the proxy relays back. */
function connectTcp(
  port: number,
): Promise<{ socket: net.Socket; received: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const received: Buffer[] = [];
    const socket = net.connect(port, "127.0.0.1", () =>
      resolve({ socket, received }),
    );
    socket.on("data", (d) => received.push(d));
    socket.on("error", reject);
  });
}

describe("frame encoding/decoding", () => {
  it("roundtrips a message through encode + decode", () => {
    const frame = encodeTunnelFrame({
      type: MessageType.DATA,
      streamId: 7,
      connectionId: 3,
      serviceId: "WSS",
      payload: Buffer.from("hello tunnel"),
    });
    // Wire layout: 2-byte big-endian length prefix + protobuf bytes.
    expect(frame.readUInt16BE(0)).toBe(frame.length - 2);

    const [decoded, ...rest] = new FrameDecoder().push(frame);
    expect(rest).toHaveLength(0);
    expect(decoded.type).toBe(MessageType.DATA);
    expect(decoded.streamId).toBe(7);
    expect(decoded.connectionId).toBe(3);
    expect(decoded.serviceId).toBe("WSS");
    expect(Buffer.from(decoded.payload).toString()).toBe("hello tunnel");
  });

  it("reassembles a tunnel frame split across two websocket frames", () => {
    // This is the bug the toolkit implementation has: it drops any tunnel
    // frame that isn't fully contained in a single websocket frame.
    const frame = encodeTunnelFrame({
      type: MessageType.DATA,
      streamId: 1,
      connectionId: 1,
      payload: Buffer.from("split across frames"),
    });
    const decoder = new FrameDecoder();

    // Split mid-frame — even mid-length-prefix (1 byte) must survive.
    expect(decoder.push(frame.subarray(0, 1))).toHaveLength(0);
    const messages = decoder.push(frame.subarray(1));
    expect(messages).toHaveLength(1);
    expect(Buffer.from(messages[0].payload).toString()).toBe(
      "split across frames",
    );
  });

  it("decodes two tunnel frames packed into one websocket frame", () => {
    const frameA = encodeTunnelFrame({
      type: MessageType.DATA,
      streamId: 1,
      connectionId: 1,
      payload: Buffer.from("first"),
    });
    const frameB = encodeTunnelFrame({
      type: MessageType.CONNECTION_RESET,
      streamId: 1,
      connectionId: 2,
    });

    const messages = new FrameDecoder().push(Buffer.concat([frameA, frameB]));
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(MessageType.DATA);
    expect(Buffer.from(messages[0].payload).toString()).toBe("first");
    expect(messages[1].type).toBe(MessageType.CONNECTION_RESET);
    expect(messages[1].connectionId).toBe(2);
  });

  it("handles a frame split across three pushes plus a packed neighbor", () => {
    const big = encodeTunnelFrame({
      type: MessageType.DATA,
      streamId: 2,
      connectionId: 1,
      payload: Buffer.alloc(1000, 0xab),
    });
    const small = encodeTunnelFrame({
      type: MessageType.STREAM_RESET,
      streamId: 2,
    });
    const wire = Buffer.concat([big, small]);
    const decoder = new FrameDecoder();

    expect(decoder.push(wire.subarray(0, 100))).toHaveLength(0);
    expect(decoder.push(wire.subarray(100, 500))).toHaveLength(0);
    const messages = decoder.push(wire.subarray(500));
    expect(messages).toHaveLength(2);
    expect(Buffer.from(messages[0].payload)).toEqual(Buffer.alloc(1000, 0xab));
    expect(messages[1].type).toBe(MessageType.STREAM_RESET);
  });
});

describe("chunkForTunnel", () => {
  it("splits payloads larger than 64512 bytes", () => {
    const data = Buffer.alloc(MAX_PAYLOAD_BYTES * 2 + 100, 0x42);
    const chunks = chunkForTunnel(data);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(MAX_PAYLOAD_BYTES);
    expect(chunks[1].length).toBe(MAX_PAYLOAD_BYTES);
    expect(chunks[2].length).toBe(100);
    expect(Buffer.concat(chunks)).toEqual(data);
  });

  it("keeps payloads at or below the limit intact", () => {
    expect(chunkForTunnel(Buffer.alloc(MAX_PAYLOAD_BYTES))).toHaveLength(1);
    expect(chunkForTunnel(Buffer.from("tiny"))).toHaveLength(1);
  });
});

describe("LocalTunnelProxy against a mock tunnel server", () => {
  let server: MockTunnelServer;
  let proxy: LocalTunnelProxy;

  beforeEach(async () => {
    server = new MockTunnelServer();
    await server.start();
  });

  afterEach(async () => {
    proxy?.dispose();
    await server.stop();
  });

  function makeProxy(): LocalTunnelProxy {
    proxy = new LocalTunnelProxy({
      region: "us-east-1",
      sourceAccessToken: "test-token",
      endpoint: `ws://127.0.0.1:${server.port}`,
    });
    return proxy;
  }

  it("start() resolves with a listening ephemeral port after SERVICE_IDS", async () => {
    const port = await makeProxy().start();
    expect(port).toBeGreaterThan(0);
    // Prove the port actually accepts connections.
    const { socket } = await connectTcp(port);
    socket.destroy();
  });

  it("sends STREAM_START with the SERVICE_IDS serviceId on the first TCP connection", async () => {
    const port = await makeProxy().start();
    const { socket } = await connectTcp(port);

    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );
    const streamStart = server.received.find(
      (m) => m.type === MessageType.STREAM_START,
    )!;
    expect(streamStart.streamId).toBe(1);
    expect(streamStart.connectionId).toBe(1);
    expect(streamStart.serviceId).toBe("WSS"); // From the mock's SERVICE_IDS.
    socket.destroy();
  });

  it("sends CONNECTION_START with incremented connectionId for subsequent connections", async () => {
    const port = await makeProxy().start();
    const first = await connectTcp(port);
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );
    const second = await connectTcp(port);

    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.CONNECTION_START),
    );
    const connectionStart = server.received.find(
      (m) => m.type === MessageType.CONNECTION_START,
    )!;
    expect(connectionStart.streamId).toBe(1);
    expect(connectionStart.connectionId).toBe(2);
    first.socket.destroy();
    second.socket.destroy();
  });

  it("chunks TCP data larger than 64512 bytes into multiple DATA messages", async () => {
    const port = await makeProxy().start();
    const { socket } = await connectTcp(port);

    const payload = Buffer.alloc(MAX_PAYLOAD_BYTES + 5000);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = i % 251; // Non-repeating-ish pattern to catch reordering.
    }
    socket.write(payload);

    await waitFor(() => {
      const total = server.received
        .filter((m) => m.type === MessageType.DATA)
        .reduce((n, m) => n + m.payload.length, 0);
      return total >= payload.length;
    });

    const dataMessages = server.received.filter(
      (m) => m.type === MessageType.DATA,
    );
    // The OS may fragment the TCP write arbitrarily, so assert the protocol
    // invariants rather than an exact count: >1 message, none over the cap,
    // and the reassembled bytes identical.
    expect(dataMessages.length).toBeGreaterThan(1);
    for (const m of dataMessages) {
      expect(m.payload.length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    }
    expect(
      Buffer.concat(dataMessages.map((m) => Buffer.from(m.payload))),
    ).toEqual(payload);
    socket.destroy();
  });

  it("relays data both directions end-to-end (mock echoes DATA)", async () => {
    server.echoData = true;
    const port = await makeProxy().start();
    const { socket, received } = await connectTcp(port);

    socket.write(Buffer.from("ping over the tunnel"));
    await waitFor(
      () => Buffer.concat(received).length >= "ping over the tunnel".length,
    );

    expect(Buffer.concat(received).toString()).toBe("ping over the tunnel");
    socket.destroy();
  });

  it("delivers tunnel frames split across separate websocket sends to the TCP client", async () => {
    const port = await makeProxy().start();
    const { socket, received } = await connectTcp(port);
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );

    // Simulate the service splitting one tunnel frame across two websocket
    // frames — the exact case the toolkit implementation drops.
    const frame = encodeTunnelFrame({
      type: MessageType.DATA,
      streamId: 1,
      connectionId: 1,
      serviceId: "WSS",
      payload: Buffer.from("reassembled!"),
    });
    server.sendRaw(frame.subarray(0, 5));
    server.sendRaw(frame.subarray(5));

    await waitFor(
      () => Buffer.concat(received).length >= "reassembled!".length,
    );
    expect(Buffer.concat(received).toString()).toBe("reassembled!");
    socket.destroy();
  });

  it("closes local sockets on STREAM_RESET for the active stream", async () => {
    const port = await makeProxy().start();
    const { socket } = await connectTcp(port);
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    server.sendRaw(
      encodeTunnelFrame({ type: MessageType.STREAM_RESET, streamId: 1 }),
    );
    await closed; // Socket destroyed by the proxy — no assertion needed beyond resolution.
  });

  it("sends CONNECTION_RESET when the local socket closes", async () => {
    const port = await makeProxy().start();
    const { socket } = await connectTcp(port);
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );

    socket.destroy();
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.CONNECTION_RESET),
    );
    const reset = server.received.find(
      (m) => m.type === MessageType.CONNECTION_RESET,
    )!;
    expect(reset.streamId).toBe(1);
    expect(reset.connectionId).toBe(1);
  });

  it("starts a new stream (incremented streamId) after a STREAM_RESET", async () => {
    const port = await makeProxy().start();
    const first = await connectTcp(port);
    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );
    server.sendRaw(
      encodeTunnelFrame({ type: MessageType.STREAM_RESET, streamId: 1 }),
    );
    await new Promise<void>((resolve) =>
      first.socket.once("close", () => resolve()),
    );

    const second = await connectTcp(port);
    await waitFor(() =>
      server.received.some(
        (m) => m.type === MessageType.STREAM_START && m.streamId === 2,
      ),
    );
    const restart = server.received.find(
      (m) => m.type === MessageType.STREAM_START && m.streamId === 2,
    )!;
    expect(restart.connectionId).toBe(1); // Connection ids restart per stream.
    second.socket.destroy();
  });

  it("omits serviceId when the tunnel advertises no services (V1-compat)", async () => {
    server.serviceIds = [];
    const port = await makeProxy().start();
    const { socket } = await connectTcp(port);

    await waitFor(() =>
      server.received.some((m) => m.type === MessageType.STREAM_START),
    );
    const streamStart = server.received.find(
      (m) => m.type === MessageType.STREAM_START,
    )!;
    expect(streamStart.serviceId).toBe(""); // proto3 default = unset.
    socket.destroy();
  });

  it("dispose() closes the TCP server and the websocket", async () => {
    const port = await makeProxy().start();
    proxy.dispose();

    await expect(connectTcp(port)).rejects.toThrow();
    await waitFor(() => server.received.length === server.received.length); // settle
  });
});
