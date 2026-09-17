import { withDurableExecution } from "./with-durable-execution";
import { initializeExecutionContext } from "./context/execution-context/execution-context";
import { createDurableContext } from "./context/durable-context/durable-context";
import { CheckpointManager } from "./utils/checkpoint/checkpoint-manager";
import { Context } from "aws-lambda";
import {
  DurableExecutionInvocationInput,
  DurableExecutionMode,
  InvocationStatus,
} from "./types";
import {
  DurableInstrumentationPlugin,
  DurableInstrumentationPluginFactory,
  InvocationEndInfo,
  InvocationInfo,
} from "./types/plugin";
import { TEST_CONSTANTS } from "./testing/test-constants";
import {
  loadConfiguredPlugins,
  PLUGIN_ENVIRONMENT_VARIABLE,
  PLUGIN_PROVIDER_EXPORT,
} from "./utils/plugin/plugin-loader";

jest.mock("./context/execution-context/execution-context");
jest.mock("./context/durable-context/durable-context");
jest.mock("./utils/checkpoint/checkpoint-manager");
jest.mock("./utils/logger/logger", () => ({ log: jest.fn() }));
jest.mock("./utils/plugin/plugin-loader", () => {
  const actual = jest.requireActual("./utils/plugin/plugin-loader");
  return { ...actual, loadConfiguredPlugins: jest.fn() };
});

const mockedLoadConfiguredPlugins =
  loadConfiguredPlugins as jest.MockedFunction<typeof loadConfiguredPlugins>;
const actualLoadConfiguredPlugins = (
  jest.requireActual("./utils/plugin/plugin-loader") as {
    loadConfiguredPlugins: typeof loadConfiguredPlugins;
  }
).loadConfiguredPlugins;

const mockEvent: DurableExecutionInvocationInput = {
  CheckpointToken: "token",
  DurableExecutionArn: "arn:test",
  InitialExecutionState: { Operations: [], NextMarker: "" },
};
const mockContext = {} as Context;

const executionContextFor = (
  executionArn: string,
): Record<string, unknown> => ({
  _stepData: {
    "initial-op": {
      StartTimestamp: new Date("2024-06-01T12:00:00Z"),
      ExecutionDetails: { InputPayload: "{}" },
    },
  },
  durableExecutionArn: executionArn,
  requestId: `req-for-${executionArn}`,
  terminationManager: {
    getTerminationPromise: () => new Promise(() => {}),
    terminate: jest.fn(),
    setCheckpointTerminatingCallback: jest.fn(),
  },
});

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
  const factory = (): RecordingPlugin => {
    const plugin = new RecordingPlugin();
    created.push(plugin);
    return plugin;
  };
  return Object.assign(factory, { created });
}

beforeEach(() => {
  jest.clearAllMocks();
  let nextExecution = 0;
  mockedLoadConfiguredPlugins.mockImplementation(async (plugins) => [
    ...(plugins ?? []),
  ]);
  (initializeExecutionContext as jest.Mock).mockImplementation(async () => {
    nextExecution += 1;
    return {
      executionContext: executionContextFor(`arn:exec:${nextExecution}`),
      checkpointToken: TEST_CONSTANTS.CHECKPOINT_TOKEN,
      durableExecutionMode: DurableExecutionMode.ExecutionMode,
    };
  });
  (createDurableContext as jest.Mock).mockReturnValue({});
  (CheckpointManager as unknown as jest.Mock).mockImplementation(() => ({
    checkpoint: jest.fn().mockResolvedValue(undefined),
    setTerminating: jest.fn(),
    dispose: jest.fn(),
    waitForQueueCompletion: jest.fn().mockResolvedValue(undefined),
  }));
});

describe("plugins get one instance per invocation", () => {
  it("creates a fresh instance for each invocation", async () => {
    const factory = recordingFactory();
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [factory],
    });

    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);

    expect(factory.created).toHaveLength(2);
    expect(factory.created[0]).not.toBe(factory.created[1]);
    expect(factory.created[0].startedArns).toEqual(["arn:exec:1"]);
    expect(factory.created[1].startedArns).toEqual(["arn:exec:2"]);
  });

  it("creates the instance before the first hook of its invocation", async () => {
    const events: string[] = [];
    const factory: DurableInstrumentationPluginFactory = () => {
      events.push("created");
      return {
        onInvocationStart: async () => {
          events.push("onInvocationStart");
        },
        onInvocationEnd: async () => {
          events.push("onInvocationEnd");
        },
      };
    };

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(mockEvent, mockContext);

    expect(events).toEqual(["created", "onInvocationStart", "onInvocationEnd"]);
  });

  it("hands the factory the same invocation info onInvocationStart receives", async () => {
    let constructedWith: InvocationInfo | undefined;
    let startedWith: InvocationInfo | undefined;
    const factory: DurableInstrumentationPluginFactory = (info) => {
      constructedWith = info;
      return {
        onInvocationStart: async (startInfo) => {
          startedWith = startInfo;
        },
      };
    };

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(mockEvent, mockContext);

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
      jest.fn().mockImplementation(
        () =>
          new Promise<Record<string, never>>((resolve) => {
            releases.push(() => resolve({}));
          }),
      ),
      { plugins: [factory] },
    );

    const first = handler(mockEvent, mockContext);
    const second = handler(mockEvent, mockContext);

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
    const factory: DurableInstrumentationPluginFactory = () => {
      instances += 1;
      const instanceNumber = instances;
      return {
        onInvocationEnd: async (info) => {
          exporter.exported.push(`${info.executionArn}#${instanceNumber}`);
        },
      };
    };

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [factory],
    });
    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);

    expect(instances).toBe(3);
    expect(exporter.exported).toEqual([
      "arn:exec:1#1",
      "arn:exec:2#2",
      "arn:exec:3#3",
    ]);
  });

  it("preserves factory order and isolates a throwing hook", async () => {
    const order: string[] = [];
    const throwingFactory: DurableInstrumentationPluginFactory = () => ({
      onInvocationStart: () => {
        throw new Error("plugin bug");
      },
    });
    const first: DurableInstrumentationPluginFactory = () => ({
      onInvocationStart: async () => {
        order.push("first");
      },
    });
    const second: DurableInstrumentationPluginFactory = () => ({
      onInvocationStart: async () => {
        order.push("second");
      },
    });

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
      { plugins: [throwingFactory, first, second] },
    );

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
    expect(order).toEqual(["first", "second"]);
  });

  it("contains a throwing factory without disrupting the execution", async () => {
    const other = new RecordingPlugin();
    const throwingFactory: DurableInstrumentationPluginFactory = () => {
      throw new Error("factory bug");
    };

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
      { plugins: [throwingFactory, () => other] },
    );

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
      Result: JSON.stringify({ ok: true }),
    });
    expect(other.startedArns).toEqual(["arn:exec:1"]);
  });

  it("keeps failing a handler's own error while a factory throws", async () => {
    const handlerError = new Error("handler error");
    const handler = withDurableExecution(
      jest.fn().mockRejectedValue(handlerError),
      {
        plugins: [
          (): DurableInstrumentationPlugin => {
            throw new Error("factory bug");
          },
        ],
      },
    );

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
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
    loadFromProvider(() => {
      const plugin = new RecordingPlugin();
      created.push(plugin);
      return plugin;
    });

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}));
    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
    expect(created[0].startedArns).toEqual(["arn:exec:1"]);
    expect(created[1].startedArns).toEqual(["arn:exec:2"]);
  });

  it("mixes a provider factory with a factory from config", async () => {
    const configFactory = recordingFactory();
    const created: RecordingPlugin[] = [];
    loadFromProvider(() => {
      const plugin = new RecordingPlugin();
      created.push(plugin);
      return plugin;
    });

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [configFactory],
    });
    await handler(mockEvent, mockContext);
    await handler(mockEvent, mockContext);

    expect(configFactory.created).toHaveLength(2);
    expect(created).toHaveLength(2);
  });

  it("contains a provider factory that throws at invocation time", async () => {
    loadFromProvider((): DurableInstrumentationPlugin => {
      throw new Error("factory bug");
    });

    const handler = withDurableExecution(
      jest.fn().mockResolvedValue({ ok: true }),
    );

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
  });

  it("still fails the invocation for a provider that is invalid at load time", async () => {
    // Not callable, so the SDK could never build an instance from it. That is a
    // packaging mistake, not a plugin failure, and it fails the invocation
    // before any execution state is read.
    loadFromProvider({ createPlugin: () => new RecordingPlugin() });

    const handler = withDurableExecution(jest.fn().mockResolvedValue({}));

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({ ErrorType: "PluginLoadError" }),
    });
    expect(initializeExecutionContext).not.toHaveBeenCalled();
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
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [
        new RecordingPlugin() as unknown as DurableInstrumentationPluginFactory,
      ],
    });

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
      Error: expect.objectContaining({ ErrorType: "PluginLoadError" }),
    });
    expect(initializeExecutionContext).not.toHaveBeenCalled();
  });

  it("reports the same failure on every invocation, not only the first", async () => {
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [
        new RecordingPlugin() as unknown as DurableInstrumentationPluginFactory,
      ],
    });

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
    });
    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.FAILED,
    });
  });

  it("runs the invocation normally when every entry is a factory", async () => {
    const factory = recordingFactory();
    const handler = withDurableExecution(jest.fn().mockResolvedValue({}), {
      plugins: [factory],
    });

    await expect(handler(mockEvent, mockContext)).resolves.toMatchObject({
      Status: InvocationStatus.SUCCEEDED,
    });
    expect(factory.created).toHaveLength(1);
  });
});
