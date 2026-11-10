import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type MockedFunction,
} from "vitest";
import { withDurableExecution } from "./with-durable-execution";
import { Context } from "aws-lambda";
import {
  type DurableExecutionClient,
  DurableExecutionInvocationInput,
  InvocationStatus,
} from "./types";
import { DurableExecutionInvocationInputWithClient } from "./utils/durable-execution-invocation-input/durable-execution-invocation-input";
import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationEndInfo,
  InvocationInfo,
} from "./types/plugin";
import {
  loadConfiguredPlugins,
  PLUGIN_ENVIRONMENT_VARIABLE,
  PLUGIN_PROVIDER_EXPORT,
} from "./utils/plugin/plugin-loader";

// withDurableExecution calls loadConfiguredPlugins with no options, so the
// environment and the module import are not reachable from a test. The mock
// lets each test call the real loader with its own environment and import.
const pluginLoaderActual = vi.hoisted(() => ({
  loadConfiguredPlugins:
    undefined as unknown as typeof import("./utils/plugin/plugin-loader").loadConfiguredPlugins,
}));

vi.mock("./utils/plugin/plugin-loader", async () => {
  const actual = await vi.importActual<
    typeof import("./utils/plugin/plugin-loader")
  >("./utils/plugin/plugin-loader");
  pluginLoaderActual.loadConfiguredPlugins = actual.loadConfiguredPlugins;
  return { ...actual, loadConfiguredPlugins: vi.fn() };
});

const mockedLoadConfiguredPlugins = loadConfiguredPlugins as MockedFunction<
  typeof loadConfiguredPlugins
>;
const actualLoadConfiguredPlugins: typeof loadConfiguredPlugins = (...args) =>
  pluginLoaderActual.loadConfiguredPlugins(...args);

// An in-memory transport, carried by each event. The event has a next marker,
// so every invocation that starts reads execution state once. A test that
// expects no state read checks that getExecutionState was never called.
let client: DurableExecutionClient & {
  getExecutionState: ReturnType<typeof vi.fn>;
};
let nextExecution = 0;

/** The event and Lambda context of the next invocation, one execution each. */
const nextInvocation = (): [DurableExecutionInvocationInput, Context] => {
  nextExecution += 1;
  const executionArn = `arn:exec:${nextExecution}`;
  const input: DurableExecutionInvocationInput = {
    CheckpointToken: "token",
    DurableExecutionArn: executionArn,
    InitialExecutionState: {
      Operations: [
        {
          Id: "initial-op",
          Type: "EXECUTION",
          Status: "STARTED",
          StartTimestamp: new Date("2024-06-01T12:00:00Z"),
          ExecutionDetails: { InputPayload: "{}" },
        },
      ],
      NextMarker: "more",
    },
  };
  const event = new DurableExecutionInvocationInputWithClient(input, client);
  const context = {
    awsRequestId: `req-for-${executionArn}`,
    getRemainingTimeInMillis: () => 30_000,
  } as Context;
  return [event, context];
};

/**
 * Records what one plugin instance observed, so a test can assert that an
 * instance saw only its own invocation.
 */
class RecordingPlugin implements DurableInstrumentationPlugin {
  readonly startedArns: string[] = [];
  readonly endedArns: string[] = [];

  async onInvocationStart(info: InvocationInfo): Promise<void> {
    this.startedArns.push(info.executionArn);
  }

  async onInvocationEnd(info: InvocationEndInfo): Promise<void> {
    this.endedArns.push(info.executionArn);
  }
}

/** Collects every instance the SDK asks for, so tests can count them. */
function recordingFactory(): DurableInstrumentationPluginFactory<RecordingPlugin> & {
  readonly created: RecordingPlugin[];
} {
  const created: RecordingPlugin[] = [];
  return {
    created,
    createPlugin: (): RecordingPlugin => {
      const plugin = new RecordingPlugin();
      created.push(plugin);
      return plugin;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nextExecution = 0;
  mockedLoadConfiguredPlugins.mockImplementation(async (plugins) => [
    ...(plugins ?? []),
  ]);
  client = {
    checkpoint: async () => ({
      CheckpointToken: "next-token",
      NewExecutionState: {},
    }),
    getExecutionState: vi.fn(async () => ({ Operations: [] })),
  };
});

describe("plugins get one instance per invocation", () => {
  it("creates a fresh instance for each invocation", async () => {
    const factory = recordingFactory();
    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [factory],
    });

    await handler(...nextInvocation());
    await handler(...nextInvocation());

    expect(factory.created).toHaveLength(2);
    expect(factory.created[0]).not.toBe(factory.created[1]);
    expect(factory.created[0].startedArns).toEqual(["arn:exec:1"]);
    expect(factory.created[1].startedArns).toEqual(["arn:exec:2"]);
  });

  it("creates the instance before the first hook of its invocation", async () => {
    const events: string[] = [];
    const factory: DurableInstrumentationPluginFactory = {
      createPlugin: () => {
        events.push("created");
        return {
          onInvocationStart: async () => {
            events.push("onInvocationStart");
          },
          onInvocationEnd: async () => {
            events.push("onInvocationEnd");
          },
        };
      },
    };

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(...nextInvocation());

    expect(events).toEqual(["created", "onInvocationStart", "onInvocationEnd"]);
  });

  it("hands the factory the same invocation info onInvocationStart receives", async () => {
    let constructedWith: InvocationInfo | undefined;
    let startedWith: InvocationInfo | undefined;
    const factory: DurableInstrumentationPluginFactory = {
      createPlugin: (info) => {
        constructedWith = info;
        return {
          onInvocationStart: async (startInfo) => {
            startedWith = startInfo;
          },
        };
      },
    };

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(...nextInvocation());

    // Same object, so a plugin can take its identity at construction rather
    // than waiting for the first hook.
    expect(constructedWith).toBe(startedWith);
    expect(constructedWith).toMatchObject({
      executionArn: "arn:exec:1",
      requestId: "req-for-arn:exec:1",
      isFirstInvocation: true,
    });
  });

  it("gives two concurrent invocations distinct instances that see only their own state", async () => {
    const factory = recordingFactory();
    const releases: Array<() => void> = [];
    const handler = withDurableExecution(
      vi.fn().mockImplementation(
        () =>
          new Promise<Record<string, never>>((resolve) => {
            releases.push(() => resolve({}));
          }),
      ),
      { plugins: [factory] },
    );

    const first = handler(...nextInvocation());
    const second = handler(...nextInvocation());

    // Both invocations are in flight: each handler body is parked on its own gate.
    while (releases.length < 2) await Promise.resolve();
    expect(factory.created).toHaveLength(2);
    expect(factory.created[0]).not.toBe(factory.created[1]);

    // Finish them out of order, so a shared instance would interleave visibly.
    releases[1]();
    releases[0]();
    await Promise.all([first, second]);

    expect(factory.created[0].startedArns).toEqual(["arn:exec:1"]);
    expect(factory.created[0].endedArns).toEqual(["arn:exec:1"]);
    expect(factory.created[1].startedArns).toEqual(["arn:exec:2"]);
    expect(factory.created[1].endedArns).toEqual(["arn:exec:2"]);
  });

  it("shares state held in the factory closure across invocations", async () => {
    // The exporter stands in for what belongs to the execution environment: a
    // client, a tracer provider, a scheduler. It outlives every instance.
    const exporter = { exported: [] as string[] };
    let instances = 0;
    const factory: DurableInstrumentationPluginFactory = {
      createPlugin: () => {
        instances += 1;
        const instanceNumber = instances;
        return {
          onInvocationEnd: async (info) => {
            exporter.exported.push(`${info.executionArn}#${instanceNumber}`);
          },
        };
      },
    };

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(...nextInvocation());
    await handler(...nextInvocation());
    await handler(...nextInvocation());

    expect(instances).toBe(3);
    expect(exporter.exported).toEqual([
      "arn:exec:1#1",
      "arn:exec:2#2",
      "arn:exec:3#3",
    ]);
  });

  it("preserves factory order and isolates a throwing hook", async () => {
    const order: string[] = [];
    const throwingFactory: DurableInstrumentationPluginFactory = {
      createPlugin: () => ({
        onInvocationStart: () => {
          throw new Error("plugin bug");
        },
      }),
    };
    const first: DurableInstrumentationPluginFactory = {
      createPlugin: () => ({
        onInvocationStart: async () => {
          order.push("first");
        },
      }),
    };
    const second: DurableInstrumentationPluginFactory = {
      createPlugin: () => ({
        onInvocationStart: async () => {
          order.push("second");
        },
      }),
    };

    const handler = withDurableExecution(
      vi.fn().mockResolvedValue({ ok: true }),
      { plugins: [throwingFactory, first, second] },
    );

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
    expect(order).toEqual(["first", "second"]);
  });

  it("contains a throwing factory without disrupting the execution", async () => {
    const other = new RecordingPlugin();
    const throwingFactory: DurableInstrumentationPluginFactory = {
      createPlugin: () => {
        throw new Error("factory bug");
      },
    };

    const handler = withDurableExecution(
      vi.fn().mockResolvedValue({ ok: true }),
      { plugins: [throwingFactory, { createPlugin: () => other }] },
    );

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify({ ok: true }),
    });
    expect(other.startedArns).toEqual(["arn:exec:1"]);
  });

  it("keeps failing a handler's own error while a factory throws", async () => {
    const handlerError = new Error("handler error");
    const handler = withDurableExecution(
      vi.fn().mockRejectedValue(handlerError),
      {
        plugins: [
          {
            createPlugin: (): DurableInstrumentationPlugin => {
              throw new Error("factory bug");
            },
          },
        ],
      },
    );

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
    });
  });
});

describe("environment-configured providers", () => {
  const loadFromProvider = (provider: unknown): void => {
    mockedLoadConfiguredPlugins.mockImplementation((explicitPlugins) =>
      actualLoadConfiguredPlugins(explicitPlugins, {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => ({ [PLUGIN_PROVIDER_EXPORT]: provider }),
      }),
    );
  };

  it("creates one instance per invocation from the provider factory", async () => {
    const created: RecordingPlugin[] = [];
    loadFromProvider({
      createPlugin: () => {
        const plugin = new RecordingPlugin();
        created.push(plugin);
        return plugin;
      },
    });

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}));
    await handler(...nextInvocation());
    await handler(...nextInvocation());

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
    expect(created[0].startedArns).toEqual(["arn:exec:1"]);
    expect(created[1].startedArns).toEqual(["arn:exec:2"]);
  });

  it("mixes a provider factory with a factory from config", async () => {
    const configFactory = recordingFactory();
    const created: RecordingPlugin[] = [];
    loadFromProvider({
      createPlugin: () => {
        const plugin = new RecordingPlugin();
        created.push(plugin);
        return plugin;
      },
    });

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [configFactory],
    });
    await handler(...nextInvocation());
    await handler(...nextInvocation());

    expect(configFactory.created).toHaveLength(2);
    expect(created).toHaveLength(2);
  });

  it("contains a provider factory that throws at invocation time", async () => {
    loadFromProvider({
      createPlugin: (): DurableInstrumentationPlugin => {
        throw new Error("factory bug");
      },
    });

    const handler = withDurableExecution(
      vi.fn().mockResolvedValue({ ok: true }),
    );

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
  });

  it("still fails the invocation for a provider that is invalid at load time", async () => {
    // A bare function has no `createPlugin`, so the SDK could never build an
    // instance from it. That is a packaging mistake, not a plugin failure, and it
    // fails the invocation before any execution state is read.
    loadFromProvider(() => new RecordingPlugin());

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}));

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({ ErrorType: "PluginLoadError" }),
    });
    expect(client.getExecutionState).not.toHaveBeenCalled();
  });

  it("contains async provider rejections across invocations", async () => {
    loadFromProvider({
      async createPlugin() {
        await Promise.resolve();
        throw new Error("async provider factory bug");
      },
    });
    const userHandler = vi.fn().mockResolvedValue({ ok: true });
    const handler = withDurableExecution(userHandler);

    for (let invocation = 0; invocation < 2; invocation++) {
      await expect(handler(...nextInvocation())).resolves.toMatchObject({
        Status: InvocationStatus.SUCCEEDED,
        Result: JSON.stringify({ ok: true }),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(userHandler).toHaveBeenCalledTimes(2);
  });
});

describe("explicit plugins entries are validated like providers", () => {
  // The same mistake on either path is reported the same way: the entry cannot
  // produce an instance, so the invocation fails at load time instead of running
  // with the plugin silently absent for the life of the environment.
  beforeEach(() => {
    mockedLoadConfiguredPlugins.mockImplementation((explicitPlugins) =>
      actualLoadConfiguredPlugins(explicitPlugins, { environment: {} }),
    );
  });

  it("fails the invocation for a plugin instance passed instead of a factory", async () => {
    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [
        new RecordingPlugin() as unknown as DurableInstrumentationPluginFactory,
      ],
    });

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({ ErrorType: "PluginLoadError" }),
    });
    expect(client.getExecutionState).not.toHaveBeenCalled();
  });

  it("reports the same failure on every invocation, not only the first", async () => {
    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [
        new RecordingPlugin() as unknown as DurableInstrumentationPluginFactory,
      ],
    });

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
    });
    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
    });
  });

  it("runs the invocation normally when every entry is a factory", async () => {
    const factory = recordingFactory();
    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [factory],
    });

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
    expect(factory.created).toHaveLength(1);
  });
});

describe("a plugin class passed instead of a factory fails the invocation", () => {
  // The migration hazard: `plugins: [MyPlugin]` is callable, so without a
  // load-time check it reaches the per-invocation call, throws "Class
  // constructor cannot be invoked without 'new'", and is contained — the plugin
  // is then absent for the life of the execution environment and nothing says
  // why. A class carries no `createPlugin`, so the shape check turns that into a
  // reported failure.
  beforeEach(() => {
    mockedLoadConfiguredPlugins.mockImplementation((explicitPlugins) =>
      actualLoadConfiguredPlugins(explicitPlugins, { environment: {} }),
    );
  });

  it("fails with PluginLoadError rather than running with the plugin absent", async () => {
    const handlerFn = vi.fn().mockResolvedValue({ ok: true });
    const handler = withDurableExecution(handlerFn, {
      plugins: [
        RecordingPlugin as unknown as DurableInstrumentationPluginFactory,
      ],
    });

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorType: "PluginLoadError",
        ErrorMessage: expect.stringContaining(
          "Plugin at plugins[0] must be an object with a 'createPlugin(info)' method",
        ),
      }),
    });
    // The failure precedes any execution work, so the handler never ran and no
    // state was read.
    expect(handlerFn).not.toHaveBeenCalled();
    expect(client.getExecutionState).not.toHaveBeenCalled();
  });

  it("fails a class exported as a provider the same way", async () => {
    mockedLoadConfiguredPlugins.mockImplementation((explicitPlugins) =>
      actualLoadConfiguredPlugins(explicitPlugins, {
        environment: { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/plugin" },
        importModule: async () => ({
          [PLUGIN_PROVIDER_EXPORT]: RecordingPlugin,
        }),
      }),
    );

    const handler = withDurableExecution(vi.fn().mockResolvedValue({}));

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({
        ErrorType: "PluginLoadError",
        ErrorMessage: expect.stringContaining(
          "Plugin provider '@example/plugin' must be an object with a 'createPlugin(info)' method",
        ),
      }),
    });
    expect(client.getExecutionState).not.toHaveBeenCalled();
  });

  it("still runs the invocation for the factory form of the same class", async () => {
    const created: RecordingPlugin[] = [];
    const handler = withDurableExecution(vi.fn().mockResolvedValue({}), {
      plugins: [
        {
          createPlugin: () => {
            const plugin = new RecordingPlugin();
            created.push(plugin);
            return plugin;
          },
        },
      ],
    });

    await expect(handler(...nextInvocation())).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
    expect(created).toHaveLength(1);
    expect(created[0].startedArns).toEqual(["arn:exec:1"]);
  });
});

describe("SDK 3.x rejects legacy providers before user execution", () => {
  it.each(["explicit", "environment"] as const)(
    "returns PluginLoadError for %s v1 registration",
    async (registration) => {
      const createPlugin = vi.fn(() => new RecordingPlugin());
      const legacy = {
        pluginApiVersion: 1,
        pluginType: RecordingPlugin,
        createPlugin,
      };
      mockedLoadConfiguredPlugins.mockImplementation((explicit) =>
        actualLoadConfiguredPlugins(explicit, {
          environment:
            registration === "environment"
              ? { [PLUGIN_ENVIRONMENT_VARIABLE]: "@example/legacy-v1" }
              : {},
          importModule: async () => ({ [PLUGIN_PROVIDER_EXPORT]: legacy }),
        }),
      );
      const handlerFn = vi.fn(async () => ({ ok: true }));
      const handler = withDurableExecution(handlerFn, {
        plugins: registration === "explicit" ? [legacy] : [],
      });
      await expect(handler(...nextInvocation())).resolves.toMatchObject({
        Status: InvocationStatus.FAILED,
        Error: {
          ErrorType: "PluginLoadError",
          ErrorMessage: expect.stringContaining("legacy v1 provider contract"),
        },
      });
      expect(createPlugin).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    },
  );
});
