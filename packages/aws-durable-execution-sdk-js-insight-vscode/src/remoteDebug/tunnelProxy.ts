/*
 * Adapted from aws-toolkit-vscode (Apache-2.0),
 * packages/core/src/lambda/remoteDebugging/localProxy.ts
 */

/**
 * Pure-Node SOURCE-mode local proxy for AWS IoT Secure Tunneling.
 *
 * A durable-function remote debug session works like this: the Lambda-side
 * debug layer connects to the tunnel as the DESTINATION (using the
 * destination access token), and this module connects as the SOURCE — it
 * listens on a local TCP port and relays every byte between the debugger
 * (e.g. VS Code's js-debug attaching to `localhost:<port>`) and the tunnel's
 * WebSocket data plane. The Secure Tunneling service in the middle never
 * sees plaintext debugger traffic semantics; it just moves opaque payloads.
 *
 * This is a from-scratch adaptation of the AWS Toolkit's `LocalProxy`
 * (the only known pure-TypeScript implementation of the tunneling data
 * plane — the official `aws-iot-securetunneling-localproxy` is a C++
 * binary we don't want to ship/spawn). Two deliberate differences:
 *
 * 1. **Cross-WebSocket-frame reassembly.** Tunnel frames (2-byte big-endian
 *    length prefix + protobuf bytes) are *loosely coupled* with WebSocket
 *    frames: one WS frame may carry several tunnel frames, or only a slice
 *    of one that completes in a later WS frame (per the official
 *    V3WebSocketProtocolGuide). The toolkit version drops any tunnel frame
 *    that doesn't fit entirely in the current WS frame, which silently
 *    corrupts the stream under load. {@link FrameDecoder} keeps a
 *    persistent carry-over buffer so partial frames survive across WS
 *    messages.
 * 2. **Zero `vscode` imports.** This module must run both in the extension
 *    host and in a plain Node child process, so it takes an optional
 *    {@link LocalTunnelProxyOptions.onLog} callback instead of a logger
 *    dependency.
 *
 * Protocol notes that shape the implementation (all from the V2/V3
 * WebSocket protocol guides in `aws-samples/aws-iot-securetunneling-localproxy`):
 *
 * - Subprotocol `aws.iot.securetunneling-3.0` adds CONNECTION_START /
 *   CONNECTION_RESET and the `connectionId` field, allowing many
 *   simultaneous TCP connections per stream — the first local TCP accept
 *   sends STREAM_START (the tunnel-level "TCP SYN") with `connectionId: 1`,
 *   each subsequent accept sends CONNECTION_START with a fresh id.
 * - The `client-token` header is what makes the access token reusable: the
 *   service binds the token to the first client token it sees, so we MUST
 *   send the SAME token on every reconnect (and without one the token is
 *   single-use, making reconnect impossible). Hence it is generated once
 *   per proxy instance, not per connection.
 * - DATA payloads are capped at 63 KB (64512 bytes); larger TCP reads are
 *   chunked (see {@link chunkForTunnel}).
 * - The service sends SERVICE_IDS right after the handshake with the
 *   service ids configured at `OpenTunnel` time; every subsequent message
 *   we send must carry the matching `serviceId` (or none at all, when the
 *   tunnel was opened without services). `start()` therefore only resolves
 *   after SERVICE_IDS arrives — sending STREAM_START with the wrong/missing
 *   serviceId would get the stream reset.
 * - After ANY stream teardown (STREAM_RESET, SESSION_RESET, or a WebSocket
 *   drop — which invalidates all streams), the next local connection must
 *   open a NEW stream with a new, temporally-unique streamId; we increment.
 */

import * as crypto from "node:crypto";
import * as net from "node:net";
import * as protobuf from "protobufjs";
import WebSocket from "ws";

/**
 * Message types of the Secure Tunneling protocol (V3). Values are the wire
 * enum values from the official schema — do not renumber.
 */
export enum MessageType {
  UNKNOWN = 0,
  DATA = 1,
  STREAM_START = 2,
  STREAM_RESET = 3,
  SESSION_RESET = 4,
  SERVICE_IDS = 5,
  CONNECTION_START = 6,
  CONNECTION_RESET = 7,
}

/**
 * The V3 protobuf schema, embedded as a string and parsed at runtime with
 * protobufjs — no codegen step and no `.proto` file to locate at runtime
 * (the extension is bundled with esbuild, so on-disk resources are
 * unreliable). Copied verbatim from the official protocol guide; the
 * service closes the WebSocket if a client extends the schema, so keep it
 * exactly as published.
 */
const TUNNEL_PROTOBUF_SCHEMA = `
syntax = "proto3";
package com.amazonaws.iot.securedtunneling;
message Message {
    Type    type         = 1;
    int32   streamId     = 2;
    bool    ignorable    = 3;
    bytes   payload      = 4;
    string  serviceId    = 5;
    repeated string availableServiceIds = 6;
    uint32 connectionId = 7;

    enum Type {
        UNKNOWN = 0;
        DATA = 1;
        STREAM_START = 2;
        STREAM_RESET = 3;
        SESSION_RESET = 4;
        SERVICE_IDS = 5;
        CONNECTION_START = 6;
        CONNECTION_RESET = 7;
    }
}`;

/** A decoded tunnel message with protobuf defaults filled in. */
export interface TunnelMessage {
  type: MessageType;
  streamId: number;
  ignorable: boolean;
  payload: Uint8Array;
  serviceId: string;
  availableServiceIds: string[];
  connectionId: number;
}

/** Fields a caller may set when encoding a message. */
export type TunnelMessageInput = Partial<TunnelMessage> & {
  type: MessageType;
};

/**
 * Max protobuf `payload` bytes per DATA message — "The payload of any
 * message may not contain more than 63kb (64512 bytes) of data" (protocol
 * guide). The tunnel service resets streams that violate this, so TCP reads
 * larger than this are split before sending.
 */
export const MAX_PAYLOAD_BYTES = 64512;

// Parsed lazily and cached: protobuf.parse is pure CPU work with no I/O,
// but there's no reason to pay it at module load for consumers that never
// open a tunnel.
let cachedMessageType: protobuf.Type | undefined;

/** The parsed protobufjs `Message` type (singleton). Exported for tests. */
export function getTunnelMessageType(): protobuf.Type {
  if (!cachedMessageType) {
    cachedMessageType = protobuf
      .parse(TUNNEL_PROTOBUF_SCHEMA)
      .root.lookupType("com.amazonaws.iot.securedtunneling.Message");
  }
  return cachedMessageType;
}

/**
 * Encode a tunnel message into a wire frame: 2-byte unsigned big-endian
 * length prefix followed by the protobuf bytes (the framing mandated by the
 * protocol guide — WebSocket frame boundaries are NOT message boundaries,
 * so the length prefix is the only reliable delimiter).
 */
export function encodeTunnelFrame(message: TunnelMessageInput): Buffer {
  const messageType = getTunnelMessageType();
  const err = messageType.verify(message);
  if (err) {
    throw new Error(`Invalid tunnel message: ${err}`);
  }
  const encoded = messageType.encode(messageType.create(message)).finish();
  if (encoded.length > 0xffff) {
    // Can't be represented in the 2-byte prefix; MAX_PAYLOAD_BYTES chunking
    // upstream makes this unreachable in practice, but fail loudly rather
    // than sending a corrupt frame.
    throw new Error(`Tunnel frame too large: ${encoded.length} bytes`);
  }
  const frame = Buffer.alloc(2 + encoded.length);
  frame.writeUInt16BE(encoded.length, 0);
  Buffer.from(encoded).copy(frame, 2);
  return frame;
}

/**
 * Incremental decoder for the length-prefixed tunnel framing.
 *
 * The protocol guide is explicit that "a WebSocket frame may contain
 * multiple tunneling frames, or it may contain only a slice of a tunneling
 * frame started in a previous WebSocket frame and will finish in a later
 * WebSocket frame" — so the decoder treats input as a continuous byte
 * stream: `push()` appends to a persistent buffer and drains every COMPLETE
 * frame, leaving any partial tail for the next call. (This is the fix for
 * the toolkit implementation, which discarded partial frames.)
 *
 * One decoder instance must be used per WebSocket connection and discarded
 * on reconnect: a new connection is a new byte stream, and stale partial
 * bytes would desynchronize the framing forever.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** Append raw WebSocket bytes; returns every complete message decoded. */
  push(data: Buffer): TunnelMessage[] {
    this.buffer =
      this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);
    const messageType = getTunnelMessageType();
    const messages: TunnelMessage[] = [];
    while (this.buffer.length >= 2) {
      const frameLength = this.buffer.readUInt16BE(0);
      if (this.buffer.length < 2 + frameLength) {
        break; // Partial frame — keep buffering until the rest arrives.
      }
      const frameBytes = this.buffer.subarray(2, 2 + frameLength);
      this.buffer = Buffer.from(this.buffer.subarray(2 + frameLength));
      const decoded = messageType.decode(frameBytes);
      // toObject with defaults gives us a uniform shape (payload always a
      // byte array, availableServiceIds always an array) instead of protobuf
      // presence semantics leaking into every call site.
      messages.push(
        messageType.toObject(decoded, {
          defaults: true,
        }) as unknown as TunnelMessage,
      );
    }
    return messages;
  }
}

/**
 * Split an outgoing TCP read into tunnel-legal DATA payload chunks (see
 * {@link MAX_PAYLOAD_BYTES}). Exported for direct unit testing — the
 * chunk boundaries are otherwise unobservable end-to-end because the OS
 * already fragments TCP reads unpredictably.
 */
export function chunkForTunnel(data: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += MAX_PAYLOAD_BYTES) {
    chunks.push(data.subarray(offset, offset + MAX_PAYLOAD_BYTES));
  }
  return chunks;
}

export interface LocalTunnelProxyOptions {
  /**
   * Region the tunnel was opened in. The data-plane endpoint is regional
   * and MUST match the `OpenTunnel` region or the handshake 4xx's.
   */
  region: string;
  /** The `sourceAccessToken` from `OpenTunnel` / `RotateTunnelAccessToken`. */
  sourceAccessToken: string;
  /** Local TCP port to listen on; 0/undefined picks an ephemeral port. */
  port?: number;
  /**
   * TEST SEAM: overrides the WebSocket endpoint origin (e.g.
   * `ws://127.0.0.1:12345`) so tests can point the proxy at an in-process
   * mock server. The `/tunnel?local-proxy-mode=source` path is always
   * appended. Never set this in production code.
   */
  endpoint?: string;
  /**
   * Optional log sink. A callback rather than a logger import keeps this
   * module runnable outside the extension host (rule: zero vscode imports).
   */
  onLog?: (level: "debug" | "warn" | "error", message: string) => void;
}

/** Milliseconds before the first reconnect attempt; grows by 1.5x each try. */
const RECONNECT_BASE_DELAY_MS = 2500;
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 30_000;
/**
 * How long `start()` waits for SERVICE_IDS after the WebSocket opens. The
 * service sends it immediately after the handshake, so anything beyond a
 * few seconds means something is wrong — but be generous for slow links.
 */
const SERVICE_IDS_TIMEOUT_MS = 30_000;

/**
 * SOURCE-mode local proxy: a `net.Server` on 127.0.0.1 whose accepted
 * sockets are multiplexed over one Secure Tunneling WebSocket.
 *
 * Lifecycle: `new LocalTunnelProxy(opts)` → `await start()` (resolves with
 * the actual listening port once the tunnel is fully usable, i.e. the
 * WebSocket is open AND SERVICE_IDS has arrived) → point a TCP client at
 * `127.0.0.1:<port>` → `dispose()` when done. A disposed proxy cannot be
 * restarted — create a new instance (the client token is single-instance
 * state, see below).
 */
export class LocalTunnelProxy {
  private readonly region: string;
  private readonly accessToken: string;
  private readonly requestedPort: number;
  private readonly endpointOverride: string | undefined;
  private readonly onLog: (
    level: "debug" | "warn" | "error",
    message: string,
  ) => void;

  /**
   * Generated ONCE per proxy instance (dashless UUIDv4 → 32 chars, matching
   * the service's `^[a-zA-Z0-9-]{32,128}$` requirement; `crypto.randomUUID`
   * rather than the `uuid` package because the latter's current build is
   * ESM-only and this module must load under CommonJS) and reused on every
   * reconnect. The service pairs the access token to this value on first
   * use — reconnecting with a different client token (or none) is rejected,
   * which is exactly the failure mode that makes debug sessions die on a
   * transient network blip.
   */
  private readonly clientToken: string = crypto.randomUUID().replace(/-/g, "");

  private ws: WebSocket | undefined;
  private tcpServer: net.Server | undefined;
  /** Live local sockets keyed by tunnel connectionId. */
  private readonly connections = new Map<number, net.Socket>();
  private frameDecoder = new FrameDecoder();

  /**
   * Empty until SERVICE_IDS arrives. When the tunnel was opened without
   * `destinationConfig.services` the list comes back empty and we operate
   * in V1-compat mode: no `serviceId` on any outgoing message. Mixing the
   * two styles on one stream gets it reset, so the value is captured once
   * and stamped uniformly.
   */
  private serviceId = "";

  /**
   * Whether SERVICE_IDS has arrived at least once. Needed because the
   * service sends it immediately after the handshake — with a local/mock
   * endpoint it can be emitted in the same tick as 'open', BEFORE
   * `waitForServiceIds()` has installed its waiter, so the waiter must be
   * able to resolve retroactively.
   */
  private serviceIdsReceived = false;

  /**
   * Stream bookkeeping. `streamStarted` tracks whether the current
   * `currentStreamId` has been claimed by a STREAM_START; it flips false on
   * any teardown (reset messages or WebSocket drop) and the id is bumped so
   * the next local connection opens a fresh stream — streamIds only need to
   * be temporally unique within the tunnel, so a counter suffices.
   */
  private currentStreamId = 1;
  private streamStarted = false;
  private nextConnectionId = 1;

  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private started = false;

  /** Pending `start()` waiter for the initial SERVICE_IDS (see start()). */
  private serviceIdsWaiter:
    | {
        resolve: () => void;
        reject: (err: Error) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;

  constructor(opts: LocalTunnelProxyOptions) {
    this.region = opts.region;
    this.accessToken = opts.sourceAccessToken;
    this.requestedPort = opts.port ?? 0;
    this.endpointOverride = opts.endpoint;
    this.onLog = opts.onLog ?? (() => {});
  }

  /**
   * Start the local TCP server and connect the tunnel WebSocket. Resolves
   * with the ACTUAL listening port (meaningful when an ephemeral port was
   * requested) only once the proxy is genuinely ready to accept a debugger
   * connection: WebSocket open and SERVICE_IDS received. Resolving earlier
   * would let the caller attach a debugger whose first packets we'd have to
   * drop or send with a guessed serviceId.
   */
  async start(): Promise<number> {
    if (this.started) {
      throw new Error("LocalTunnelProxy.start() may only be called once");
    }
    if (this.disposed) {
      throw new Error("LocalTunnelProxy has been disposed");
    }
    this.started = true;

    try {
      const port = await this.startTcpServer();
      await this.connectWebSocket();
      await this.waitForServiceIds();
      return port;
    } catch (err) {
      // Leave nothing half-open on a failed start; the caller only gets an
      // exception, so it has no handle with which to clean up.
      this.dispose();
      throw err;
    }
  }

  /**
   * Tear everything down: pending reconnects, keepalive pings, all local
   * sockets, the TCP server, and the WebSocket. Idempotent, synchronous
   * best-effort — dispose() is called from error paths where nothing can
   * be awaited.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopPing();

    this.serviceIdsWaiter?.reject(new Error("LocalTunnelProxy disposed"));
    this.clearServiceIdsWaiter();

    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();

    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = undefined;
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = undefined;
      // Listeners are removed first so the 'close' that terminate() causes
      // doesn't re-enter our reconnect logic.
      ws.removeAllListeners();
      try {
        ws.terminate();
      } catch {
        // Already closed/destroyed — nothing to do.
      }
    }
  }

  // ---------------------------------------------------------------- TCP --

  private startTcpServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) =>
        this.handleNewTcpConnection(socket),
      );
      this.tcpServer = server;
      server.once("error", reject);
      // 127.0.0.1 only: the proxy is an unauthenticated raw relay into the
      // Lambda sandbox's debug port — it must never be reachable off-host.
      server.listen(this.requestedPort, "127.0.0.1", () => {
        server.removeListener("error", reject);
        server.on("error", (err) =>
          this.onLog("error", `TCP server error: ${err}`),
        );
        const address = server.address() as net.AddressInfo;
        this.onLog(
          "debug",
          `TCP server listening on 127.0.0.1:${address.port}`,
        );
        resolve(address.port);
      });
    });
  }

  private handleNewTcpConnection(socket: net.Socket): void {
    if (this.disposed || this.ws?.readyState !== WebSocket.OPEN) {
      // No tunnel to relay into (e.g. mid-reconnect). Refusing outright is
      // kinder than accepting and black-holing the debugger's handshake.
      this.onLog("warn", "Rejecting local connection: tunnel not connected");
      socket.destroy();
      return;
    }

    if (!this.streamStarted) {
      this.streamStarted = true;
      this.nextConnectionId = 1;
    }
    const connectionId = this.nextConnectionId++;
    const streamId = this.currentStreamId;
    this.connections.set(connectionId, socket);
    this.onLog(
      "debug",
      `Local connection ${connectionId} opened (stream ${streamId})`,
    );

    socket.on("data", (data) => this.sendData(streamId, connectionId, data));
    // 'close' always follows 'error', so the reset logic lives there; the
    // handler exists only to keep the error from crashing the process.
    socket.on("error", (err) =>
      this.onLog("debug", `Local connection ${connectionId} error: ${err}`),
    );
    socket.on("close", () => {
      // delete() returning false means the connection was already removed
      // because the REMOTE side reset it — echoing a CONNECTION_RESET back
      // for a connection the destination already tore down is noise.
      if (this.connections.delete(connectionId)) {
        this.onLog(
          "debug",
          `Local connection ${connectionId} closed; sending CONNECTION_RESET`,
        );
        this.sendMessage({
          type: MessageType.CONNECTION_RESET,
          streamId,
          connectionId,
        });
      }
    });

    // First connection on a stream is the tunnel-level SYN (STREAM_START);
    // later ones multiplex onto the existing stream (CONNECTION_START).
    // No ack comes back — per the protocol guide the source "may
    // immediately send request data and assume the destination will
    // connect", with failure surfacing as a STREAM_RESET.
    this.sendMessage({
      type:
        connectionId === 1
          ? MessageType.STREAM_START
          : MessageType.CONNECTION_START,
      streamId,
      connectionId,
    });
  }

  private sendData(streamId: number, connectionId: number, data: Buffer): void {
    for (const chunk of chunkForTunnel(data)) {
      this.sendMessage({
        type: MessageType.DATA,
        streamId,
        connectionId,
        payload: chunk,
      });
    }
  }

  // ---------------------------------------------------------- WebSocket --

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const origin =
        this.endpointOverride ??
        `wss://data.tunneling.iot.${this.region}.amazonaws.com:443`;
      const url = `${origin}/tunnel?local-proxy-mode=source`;

      // Each connection is a fresh byte stream: stale partial-frame bytes
      // from the previous socket would desync the framing permanently.
      this.frameDecoder = new FrameDecoder();

      const ws = new WebSocket(url, ["aws.iot.securetunneling-3.0"], {
        headers: {
          "access-token": this.accessToken,
          "client-token": this.clientToken,
        },
        handshakeTimeout: 30_000,
      });
      this.ws = ws;

      let opened = false;
      ws.on("open", () => {
        opened = true;
        this.onLog("debug", "Tunnel WebSocket connected");
        this.reconnectAttempts = 0;
        this.startPing();
        resolve();
      });
      ws.on("message", (data) => this.handleWebSocketMessage(data));
      ws.on("error", (err) => {
        this.onLog("error", `Tunnel WebSocket error: ${err}`);
        if (!opened) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      ws.on("close", (code, reason) => {
        this.onLog(
          "debug",
          `Tunnel WebSocket closed: ${code} ${reason.toString()}`,
        );
        this.handleWebSocketClosed();
        if (!opened) {
          reject(new Error(`Tunnel WebSocket closed before open: ${code}`));
        }
      });
      // The service normally never pings, but the guide requires clients to
      // answer if it does.
      ws.on("ping", (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.pong(data);
        }
      });
    });
  }

  private handleWebSocketClosed(): void {
    this.stopPing();
    // A WebSocket drop invalidates every stream: the service pairs streams
    // to the connection, so surviving sockets can never receive more data.
    // Kill them now so the debugger sees a clean disconnect instead of a
    // hang, and arrange for the next local connect to open a new stream.
    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();
    this.endStream();

    if (!this.disposed) {
      this.scheduleReconnect();
    }
  }

  /**
   * Reconnect with exponential backoff (2.5s × 1.5^n, 10 attempts), always
   * presenting the same client token — that's the entire reason the token
   * is instance state. After the attempts are exhausted the proxy disposes
   * itself: silently staying half-alive would leave the debugger port
   * accepting connections it can never serve.
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onLog(
        "error",
        "Max tunnel reconnect attempts reached; disposing proxy",
      );
      this.dispose();
      return;
    }
    this.reconnectAttempts++;
    const delay =
      RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempts - 1);
    this.onLog(
      "debug",
      `Reconnecting tunnel in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.disposed) {
        return;
      }
      this.connectWebSocket().catch(() => {
        // The 'close' handler usually schedules the next attempt, but a
        // handshake-level failure can reject without a close event; the
        // reconnectTimer guard above makes double-scheduling harmless.
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    // The service closes idle connections; the C++ localproxy and the
    // toolkit both keep the socket warm with a ping every 30s. The random
    // payload mirrors them (some intermediaries dedupe empty pings).
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping(crypto.randomBytes(16));
      } else {
        this.stopPing();
      }
    }, PING_INTERVAL_MS);
    // Don't let the keepalive timer hold a plain-Node process open after
    // everything else has finished.
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  // ------------------------------------------------------------ receive --

  private handleWebSocketMessage(data: WebSocket.RawData): void {
    // ws hands us Buffer | ArrayBuffer | Buffer[] depending on fragmentation
    // and options; normalize before feeding the frame decoder.
    const buf = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    let messages: TunnelMessage[];
    try {
      messages = this.frameDecoder.push(buf);
    } catch (err) {
      // A frame that fails to decode means the framing is desynchronized —
      // there is no way to resynchronize a length-prefixed stream, so the
      // only safe move is to drop the connection and let reconnect logic
      // start a clean one.
      this.onLog("error", `Failed to decode tunnel frame: ${err}`);
      this.ws?.terminate();
      return;
    }
    for (const message of messages) {
      this.processMessage(message);
    }
  }

  private processMessage(message: TunnelMessage): void {
    switch (message.type) {
      case MessageType.SERVICE_IDS:
        this.handleServiceIds(message);
        break;
      case MessageType.DATA:
        this.handleData(message);
        break;
      case MessageType.STREAM_RESET:
        // Ignore resets for streams other than the live one — the guide
        // says stale-stream messages are expected after reconnects and must
        // be discarded silently.
        if (message.streamId === this.currentStreamId) {
          this.onLog(
            "debug",
            `STREAM_RESET for active stream ${message.streamId}`,
          );
          this.teardownActiveStream();
        }
        break;
      case MessageType.SESSION_RESET:
        // Rare service-originated "everything is gone" — same handling as a
        // stream reset but unconditional.
        this.onLog("debug", "SESSION_RESET received");
        this.teardownActiveStream();
        break;
      case MessageType.CONNECTION_RESET: {
        const connectionId = message.connectionId || 1;
        const socket = this.connections.get(connectionId);
        if (socket && message.streamId === this.currentStreamId) {
          this.onLog(
            "debug",
            `CONNECTION_RESET for connection ${connectionId}`,
          );
          // Remove BEFORE destroy so the socket's close handler doesn't
          // echo a CONNECTION_RESET back for a connection the remote side
          // already reset.
          this.connections.delete(connectionId);
          socket.destroy();
        }
        break;
      }
      default:
        // STREAM_START/CONNECTION_START are destination-bound and must
        // never reach a source; unknown types with ignorable=true may be
        // skipped per the guide. Either way: log and move on.
        this.onLog("debug", `Ignoring message of type ${message.type}`);
        break;
    }
  }

  private handleServiceIds(message: TunnelMessage): void {
    // First (or only) service id becomes the one stamped on every outgoing
    // message; an empty list means the tunnel has no service multiplexing
    // and messages must omit serviceId entirely (V1-compat).
    this.serviceId = message.availableServiceIds[0] ?? "";
    this.serviceIdsReceived = true;
    this.onLog(
      "debug",
      `SERVICE_IDS received: [${message.availableServiceIds.join(", ")}]`,
    );
    this.serviceIdsWaiter?.resolve();
    this.clearServiceIdsWaiter();
  }

  private handleData(message: TunnelMessage): void {
    if (message.streamId !== this.currentStreamId) {
      return; // Stale stream — discard silently per the protocol guide.
    }
    // connectionId 0/absent means 1 by protocol definition ("will always
    // make destination v3 localproxy reinterpret it as connection ID set to
    // 1" — same rule applies to us as receiver).
    const socket = this.connections.get(message.connectionId || 1);
    if (socket?.writable) {
      socket.write(Buffer.from(message.payload));
    }
  }

  /** Close all sockets of the active stream and retire its streamId. */
  private teardownActiveStream(): void {
    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();
    this.endStream();
  }

  private endStream(): void {
    if (this.streamStarted) {
      this.streamStarted = false;
      this.currentStreamId++;
      this.nextConnectionId = 1;
    }
  }

  // --------------------------------------------------------------- send --

  private sendMessage(fields: {
    type: MessageType;
    streamId: number;
    connectionId: number;
    payload?: Buffer;
  }): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.onLog(
        "warn",
        `Dropping ${MessageType[fields.type]}: tunnel not connected`,
      );
      return;
    }
    const message: TunnelMessageInput = {
      type: fields.type,
      streamId: fields.streamId,
      connectionId: fields.connectionId,
    };
    // serviceId consistency rule: if the stream was opened with a serviceId
    // every message must carry it, and if the tunnel has none NO message may
    // carry one — so it's included only when SERVICE_IDS gave us one.
    if (this.serviceId) {
      message.serviceId = this.serviceId;
    }
    if (fields.payload) {
      message.payload = fields.payload;
    }
    try {
      this.ws.send(encodeTunnelFrame(message));
    } catch (err) {
      this.onLog("error", `Failed to send tunnel message: ${err}`);
    }
  }

  // ------------------------------------------------------------ helpers --

  private waitForServiceIds(): Promise<void> {
    if (this.serviceIdsReceived) {
      return Promise.resolve(); // Arrived before the waiter (see field doc).
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clearServiceIdsWaiter();
        reject(
          new Error(
            "Timed out waiting for SERVICE_IDS from the tunnel service",
          ),
        );
      }, SERVICE_IDS_TIMEOUT_MS);
      timer.unref?.();
      this.serviceIdsWaiter = { resolve, reject, timer };
    });
  }

  private clearServiceIdsWaiter(): void {
    if (this.serviceIdsWaiter) {
      clearTimeout(this.serviceIdsWaiter.timer);
      this.serviceIdsWaiter = undefined;
    }
  }
}
