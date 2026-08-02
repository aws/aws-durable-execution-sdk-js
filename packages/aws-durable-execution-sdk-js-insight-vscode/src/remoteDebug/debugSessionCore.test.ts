const lambdaSend = jest.fn();
const iotSend = jest.fn();
jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn(() => ({ send: lambdaSend })),
  GetFunctionConfigurationCommand: jest.fn((input) => ({
    __t: "getConfig",
    input,
  })),
  UpdateFunctionConfigurationCommand: jest.fn((input) => ({
    __t: "updateConfig",
    input,
  })),
  InvokeCommand: jest.fn((input) => ({ __t: "invoke", input })),
  PublishVersionCommand: jest.fn((input) => ({ __t: "publishVersion", input })),
  DeleteFunctionCommand: jest.fn((input) => ({ __t: "deleteFunction", input })),
}));
jest.mock("@aws-sdk/client-iotsecuretunneling", () => ({
  IoTSecureTunnelingClient: jest.fn(() => ({ send: iotSend })),
  OpenTunnelCommand: jest.fn((input) => ({ __t: "openTunnel", input })),
  CloseTunnelCommand: jest.fn((input) => ({ __t: "closeTunnel", input })),
}));

// Stubbed proxy: this test file must never open real sockets — the real
// LocalTunnelProxy has its own test suite (tunnelProxy.test.ts).
const proxyStart = jest.fn();
const proxyDispose = jest.fn();
jest.mock("./tunnelProxy", () => ({
  LocalTunnelProxy: jest.fn(() => ({
    start: proxyStart,
    dispose: proxyDispose,
  })),
}));

import { startRemoteDebugSession } from "./debugSessionCore";
import { LocalTunnelProxy } from "./tunnelProxy";

type Cmd = { __t: string; input: Record<string, unknown> };

/** All inputs sent through a mock client's send(), filtered by command tag. */
function sentInputs(send: jest.Mock, tag: string): Record<string, unknown>[] {
  return send.mock.calls
    .map((c) => c[0] as Cmd)
    .filter((c) => c.__t === tag)
    .map((c) => c.input);
}

const EXISTING_LAYER = "arn:aws:lambda:us-east-1:111122223333:layer:mine:1";
const EXPECTED_DEBUG_LAYER =
  "arn:aws:lambda:us-east-1:166855510987:layer:LDKLayerX86:3";

/** Base pre-debug configuration the mocked GetFunctionConfiguration returns. */
function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    FunctionName: "my-fn",
    Runtime: "nodejs22.x",
    Timeout: 60,
    Layers: [{ Arn: EXISTING_LAYER }],
    Environment: { Variables: { FOO: "bar" } },
    Architectures: ["x86_64"],
    // Always "already settled" so waitForUpdateSuccessful returns on its
    // first poll — these tests exercise orchestration, not polling delays.
    LastUpdateStatus: "Successful",
    ...overrides,
  };
}

function installDefaultMocks(configOverrides: Record<string, unknown> = {}) {
  lambdaSend.mockImplementation((cmd: Cmd) => {
    switch (cmd.__t) {
      case "getConfig":
        return Promise.resolve(baseConfig(configOverrides));
      case "updateConfig":
        return Promise.resolve({});
      case "publishVersion":
        return Promise.resolve({ Version: "7" });
      case "deleteFunction":
        return Promise.resolve({});
      case "invoke":
        return Promise.resolve({
          StatusCode: 200,
          Payload: new TextEncoder().encode('{"ok":true}'),
          LogResult: Buffer.from("START RequestId\nEND", "utf-8").toString(
            "base64",
          ),
        });
      default:
        return Promise.reject(new Error(`unexpected command ${cmd.__t}`));
    }
  });
  iotSend.mockImplementation((cmd: Cmd) => {
    switch (cmd.__t) {
      case "openTunnel":
        return Promise.resolve({
          tunnelId: "tunnel-123",
          sourceAccessToken: "src-token",
          destinationAccessToken: "dst-token",
        });
      case "closeTunnel":
        return Promise.resolve({});
      default:
        return Promise.reject(new Error(`unexpected command ${cmd.__t}`));
    }
  });
  proxyStart.mockResolvedValue(5858);
}

const startOpts = {
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
  functionName: "my-fn",
};

beforeEach(() => {
  jest.clearAllMocks();
  installDefaultMocks();
});

describe("startRemoteDebugSession — happy path", () => {
  it("applies the debug mutation, publishes a version, and restores $LATEST right away", async () => {
    const handle = await startRemoteDebugSession(startOpts);

    expect(handle.port).toBe(5858);
    // The session debugs the PUBLISHED version, not $LATEST — that is what
    // earns it a dedicated sandbox (DAR-431), so durable replays land back on
    // the sandbox the debugger is attached to.
    expect(handle.functionQualifier).toBe("7");

    // Tunnel opened with the verified parameters.
    expect(sentInputs(iotSend, "openTunnel")).toEqual([
      {
        description: "WorkflowStudioDebug",
        timeoutConfig: { maxLifetimeTimeoutMinutes: 720 },
        destinationConfig: { services: ["WSS"] },
      },
    ]);

    // TWO config mutations by the time setup finishes: the debug shape, then
    // the immediate restore. $LATEST carries the debug layer only for the few
    // seconds between them, instead of for the whole session.
    const updates = sentInputs(lambdaSend, "updateConfig");
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      FunctionName: "my-fn",
      Timeout: 900,
      Layers: [EXISTING_LAYER, EXPECTED_DEBUG_LAYER],
      Environment: {
        Variables: {
          FOO: "bar",
          AWS_LAMBDA_EXEC_WRAPPER: "/opt/bin/ldk_wrapper",
          AWS_LDK_DESTINATION_TOKEN: "dst-token",
          // AWS_LAMBDA_DEBUG_ON_LATEST is deliberately absent — we are not
          // debugging $LATEST.
        },
      },
    });
    expect(updates[1]).toEqual({
      FunctionName: "my-fn",
      Timeout: 60,
      Layers: [EXISTING_LAYER],
      Environment: { Variables: { FOO: "bar" } },
    });

    // The version is published from the mutated $LATEST, BEFORE the restore.
    expect(sentInputs(lambdaSend, "publishVersion")).toEqual([
      {
        FunctionName: "my-fn",
        Description: "Workflow Studio remote debug session",
      },
    ]);
    const order = lambdaSend.mock.calls.map((c) => (c[0] as Cmd).__t);
    expect(order.indexOf("publishVersion")).toBeGreaterThan(
      order.indexOf("updateConfig"),
    );
    expect(order.lastIndexOf("updateConfig")).toBeGreaterThan(
      order.indexOf("publishVersion"),
    );

    // Proxy started with the SOURCE token in the right region.
    expect(LocalTunnelProxy).toHaveBeenCalledWith({
      region: "us-east-1",
      sourceAccessToken: "src-token",
      port: undefined,
    });
    expect(proxyStart).toHaveBeenCalledTimes(1);
  });

  it("fails (and cleans up) when PublishVersion returns no version", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      lambdaSend.mockImplementation((cmd: Cmd) => {
        switch (cmd.__t) {
          case "getConfig":
            return Promise.resolve(baseConfig());
          case "updateConfig":
            return Promise.resolve({});
          case "publishVersion":
            return Promise.resolve({}); // no Version field
          default:
            return Promise.resolve({});
        }
      });
      await expect(startRemoteDebugSession(startOpts)).rejects.toThrow(
        /no version number/,
      );
      // $LATEST reverted and the tunnel cleaned up.
      const updates = sentInputs(lambdaSend, "updateConfig");
      expect(updates[updates.length - 1].Timeout).toBe(60);
      expect(sentInputs(iotSend, "closeTunnel")).toEqual([
        { tunnelId: "tunnel-123", delete: true },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("preserves a pre-existing exec wrapper as ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER", async () => {
    installDefaultMocks({
      Environment: {
        Variables: { FOO: "bar", AWS_LAMBDA_EXEC_WRAPPER: "/opt/other" },
      },
    });
    await startRemoteDebugSession(startOpts);
    const [update] = sentInputs(lambdaSend, "updateConfig");
    const vars = (update.Environment as { Variables: Record<string, string> })
      .Variables;
    expect(vars.AWS_LAMBDA_EXEC_WRAPPER).toBe("/opt/bin/ldk_wrapper");
    expect(vars.ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER).toBe("/opt/other");
  });

  it("passes layerArnOverride through instead of the built-in layer", async () => {
    const custom = "arn:aws:lambda:us-east-1:999:layer:MyLdk:9";
    await startRemoteDebugSession({ ...startOpts, layerArnOverride: custom });
    const [update] = sentInputs(lambdaSend, "updateConfig");
    expect(update.Layers).toEqual([EXISTING_LAYER, custom]);
  });
});

describe("dispose — teardown", () => {
  it("does NOT delete the debug version by default, and closes the tunnel", async () => {
    const handle = await startRemoteDebugSession(startOpts);
    await handle.dispose();

    // A durable execution PINS its version: deleting it while the execution
    // can still resume would break the execution itself, so deletion is
    // opt-in and the default keeps the version.
    expect(sentInputs(lambdaSend, "deleteFunction")).toHaveLength(0);
    // No further config churn either — $LATEST was already restored at setup.
    expect(sentInputs(lambdaSend, "updateConfig")).toHaveLength(2);

    expect(proxyDispose).toHaveBeenCalledTimes(1);
    expect(sentInputs(iotSend, "closeTunnel")).toEqual([
      { tunnelId: "tunnel-123", delete: true },
    ]);
  });

  it("deletes the debug version when the caller confirms the execution finished", async () => {
    const handle = await startRemoteDebugSession(startOpts);
    await handle.dispose({ deleteVersion: true });

    expect(sentInputs(lambdaSend, "deleteFunction")).toEqual([
      { FunctionName: "my-fn", Qualifier: "7" },
    ]);
  });

  it("leaves $LATEST untouched during teardown (it was restored at setup)", async () => {
    installDefaultMocks({
      Timeout: 42,
      Layers: [{ Arn: EXISTING_LAYER }],
      Environment: { Variables: { FOO: "bar", KEEP: "me" } },
    });
    const handle = await startRemoteDebugSession(startOpts);
    const updatesBefore = sentInputs(lambdaSend, "updateConfig");
    // The setup-time restore already put the original config back verbatim.
    expect(updatesBefore[1]).toEqual({
      FunctionName: "my-fn",
      Timeout: 42,
      Layers: [EXISTING_LAYER],
      Environment: { Variables: { FOO: "bar", KEEP: "me" } },
    });

    await handle.dispose();
    expect(sentInputs(lambdaSend, "updateConfig")).toHaveLength(
      updatesBefore.length,
    );
  });
});

describe("preflight rejections", () => {
  it("rejects when 5 layers are already attached, before touching anything", async () => {
    installDefaultMocks({
      Layers: [1, 2, 3, 4, 5].map((n) => ({ Arn: `arn:layer:${n}` })),
    });
    await expect(startRemoteDebugSession(startOpts)).rejects.toThrow(
      /already has 5 layers/,
    );
    expect(sentInputs(iotSend, "openTunnel")).toHaveLength(0);
    expect(sentInputs(lambdaSend, "updateConfig")).toHaveLength(0);
  });

  it("rejects non-nodejs runtimes", async () => {
    installDefaultMocks({ Runtime: "python3.13" });
    await expect(startRemoteDebugSession(startOpts)).rejects.toThrow(
      /Node\.js runtimes only/,
    );
    expect(sentInputs(iotSend, "openTunnel")).toHaveLength(0);
  });
});

describe("dispose — idempotent and best-effort", () => {
  it("never throws when CloseTunnel fails, and warns instead", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handle = await startRemoteDebugSession(startOpts);
      iotSend.mockImplementation((cmd: Cmd) =>
        cmd.__t === "closeTunnel"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({}),
      );
      await expect(handle.dispose()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("tunnel close failed: boom"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("never throws when deleting the debug version fails, and still closes the tunnel", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handle = await startRemoteDebugSession(startOpts);
      lambdaSend.mockImplementation((cmd: Cmd) =>
        cmd.__t === "deleteFunction"
          ? Promise.reject(new Error("delete-fail"))
          : Promise.resolve(baseConfig()),
      );
      await expect(
        handle.dispose({ deleteVersion: true }),
      ).resolves.toBeUndefined();
      expect(sentInputs(iotSend, "closeTunnel")).toEqual([
        { tunnelId: "tunnel-123", delete: true },
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("debug version 7 delete failed: delete-fail"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("is idempotent — a second dispose is a complete no-op", async () => {
    const handle = await startRemoteDebugSession(startOpts);
    await handle.dispose({ deleteVersion: true });
    const deletesAfterFirst = sentInputs(lambdaSend, "deleteFunction").length;
    const closesAfterFirst = sentInputs(iotSend, "closeTunnel").length;
    const proxyDisposesAfterFirst = proxyDispose.mock.calls.length;

    await handle.dispose({ deleteVersion: true });
    expect(sentInputs(lambdaSend, "deleteFunction")).toHaveLength(
      deletesAfterFirst,
    );
    expect(sentInputs(iotSend, "closeTunnel")).toHaveLength(closesAfterFirst);
    expect(proxyDispose).toHaveBeenCalledTimes(proxyDisposesAfterFirst);
  });
});

describe("invoke", () => {
  it("targets the published debug version with LogType Tail and decodes payload + LogResult", async () => {
    const handle = await startRemoteDebugSession(startOpts);
    const result = await handle.invoke('{"orderId":"12345"}');

    const [invokeInput] = sentInputs(lambdaSend, "invoke");
    expect(invokeInput.FunctionName).toBe("my-fn");
    // The published version — NOT $LATEST, which no longer carries the layer.
    expect(invokeInput.Qualifier).toBe("7");
    expect(invokeInput.LogType).toBe("Tail");
    // No InvocationType: the SDK default (RequestResponse) keeps the call
    // synchronous, holding the sandbox open at breakpoints.
    expect(invokeInput.InvocationType).toBeUndefined();
    expect(
      Buffer.from(invokeInput.Payload as Uint8Array).toString("utf-8"),
    ).toBe('{"orderId":"12345"}');

    expect(result.statusCode).toBe(200);
    expect(result.payload).toBe('{"ok":true}');
    expect(result.logTail).toBe("START RequestId\nEND");
  });

  it("omits logTail when the response carries no LogResult", async () => {
    const handle = await startRemoteDebugSession(startOpts);
    lambdaSend.mockImplementation((cmd: Cmd) =>
      cmd.__t === "invoke"
        ? Promise.resolve({
            StatusCode: 200,
            Payload: new TextEncoder().encode("null"),
          })
        : Promise.resolve(baseConfig()),
    );
    const result = await handle.invoke("{}");
    expect(result.logTail).toBeUndefined();
    expect(result.payload).toBe("null");
  });
});

describe("setup failure safety net", () => {
  it("reverts the config and closes the tunnel when the proxy fails to start", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      proxyStart.mockRejectedValue(new Error("no tunnel for you"));
      await expect(startRemoteDebugSession(startOpts)).rejects.toThrow(
        "no tunnel for you",
      );
      // Debug mutation happened, then was reverted (2 updates total).
      const updates = sentInputs(lambdaSend, "updateConfig");
      expect(updates).toHaveLength(2);
      expect(updates[1].Timeout).toBe(60);
      expect(updates[1].Layers).toEqual([EXISTING_LAYER]);
      expect(sentInputs(iotSend, "closeTunnel")).toEqual([
        { tunnelId: "tunnel-123", delete: true },
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
