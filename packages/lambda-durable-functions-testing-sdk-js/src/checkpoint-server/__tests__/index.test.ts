import { CheckpointServerWorker } from "../worker/checkpoint-server-worker";

// Mock dependencies
jest.mock("../worker/checkpoint-server-worker");

const MockCheckpointServerWorker = CheckpointServerWorker as jest.MockedClass<
  typeof CheckpointServerWorker
>;

describe("checkpoint-server/index", () => {
  let mockWorkerInstance: jest.Mocked<CheckpointServerWorker>;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock worker instance
    mockWorkerInstance = {
      initialize: jest.fn(),
      startServer: jest.fn(),
      shutdownServer: jest.fn(),
      getServer: jest.fn(),
    } as unknown as jest.Mocked<CheckpointServerWorker>;

    MockCheckpointServerWorker.mockImplementation(() => mockWorkerInstance);

    // Spy on console.error and process.exit
    processExitSpy = jest.spyOn(process, "exit").mockImplementation();
  });

  it("should not initialize worker when parentPort is null", () => {
    jest.isolateModules(() => {
      // Mock parentPort as null
      jest.doMock("worker_threads", () => ({
        parentPort: null,
      }));

      // Require the module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../index");

      // Should not create worker when parentPort is null
      expect(MockCheckpointServerWorker).not.toHaveBeenCalled();
    });
  });

  it("should initialize worker when parentPort is available", async () => {
    const mockParentPort = {
      postMessage: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
    };

    // Setup the mock before isolateModules
    mockWorkerInstance.initialize.mockResolvedValue();

    jest.isolateModules(() => {
      // Mock parentPort as available
      jest.doMock("worker_threads", () => ({
        parentPort: mockParentPort,
      }));

      // Require the module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../index");
    });

    // Give time for initialization
    await new Promise((resolve) => setImmediate(resolve));

    expect(MockCheckpointServerWorker).toHaveBeenCalledWith(mockParentPort);
    expect(mockWorkerInstance.initialize).toHaveBeenCalled();
  });

  it("should handle worker initialization error and exit", async () => {
    const mockParentPort = {
      postMessage: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
    };

    const initError = new Error("Initialization failed");

    // Setup the mock before isolateModules
    mockWorkerInstance.initialize.mockRejectedValue(initError);

    jest.isolateModules(() => {
      // Mock parentPort as available
      jest.doMock("worker_threads", () => ({
        parentPort: mockParentPort,
      }));

      // Require the module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../index");
    });

    // Give time for initialization and error handling
    await new Promise((resolve) => setImmediate(resolve));

    expect(MockCheckpointServerWorker).toHaveBeenCalledWith(mockParentPort);
    expect(mockWorkerInstance.initialize).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("should handle non-Error initialization failure", async () => {
    const mockParentPort = {
      postMessage: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
    };

    const initError = "String error";

    // Setup the mock before isolateModules
    mockWorkerInstance.initialize.mockRejectedValue(initError);

    jest.isolateModules(() => {
      // Mock parentPort as available
      jest.doMock("worker_threads", () => ({
        parentPort: mockParentPort,
      }));

      // Require the module
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../index");
    });

    // Give time for initialization and error handling
    await new Promise((resolve) => setImmediate(resolve));

    expect(MockCheckpointServerWorker).toHaveBeenCalledWith(mockParentPort);
    expect(mockWorkerInstance.initialize).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
