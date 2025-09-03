import { CheckpointServerWorker } from "../checkpoint-server-worker";
import { startCheckpointServer } from "../../checkpoint-server";
import {
  WorkerCommand,
  WorkerCommandType,
  WorkerResponseType,
} from "../worker-message-types";
import type { MessagePort } from "worker_threads";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Mock the checkpoint server module
jest.mock("../../checkpoint-server");

const mockStartCheckpointServer = startCheckpointServer as jest.MockedFunction<
  typeof startCheckpointServer
>;

describe("CheckpointServerWorker", () => {
  let mockMessagePort: jest.Mocked<MessagePort>;
  let mockServer: jest.Mocked<Server>;
  let worker: CheckpointServerWorker;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock MessagePort
    mockMessagePort = {
      on: jest.fn(),
      postMessage: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
      start: jest.fn(),
      terminate: jest.fn(),
      ref: jest.fn(),
      unref: jest.fn(),
    } as unknown as jest.Mocked<MessagePort>;

    // Create mock Server
    mockServer = {
      address: jest.fn(),
      close: jest.fn(),
      closeAllConnections: jest.fn(),
      listen: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      once: jest.fn(),
    } as unknown as jest.Mocked<Server>;

    worker = new CheckpointServerWorker(mockMessagePort);
  });

  describe("constructor", () => {
    it("should create worker with message port", () => {
      expect(worker).toBeInstanceOf(CheckpointServerWorker);
      expect(worker.getServer()).toBeNull();
    });
  });

  describe("initialize", () => {
    it("should setup message handling and start server", async () => {
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.initialize();

      expect(mockMessagePort.on).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
      expect(mockStartCheckpointServer).toHaveBeenCalledWith(0);
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.SERVER_STARTED,
        data: {
          port: 3000,
          url: "http://127.0.0.1:3000",
        },
      });
    });

    it("should handle server start error", async () => {
      const error = new Error("Failed to start server");
      mockStartCheckpointServer.mockRejectedValue(error);

      await worker.initialize();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Failed to start server",
          stack: error.stack,
          code: undefined,
        },
        error: "Failed to start server",
      });
    });
  });

  describe("startServer", () => {
    it("should start server successfully", async () => {
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 4000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();

      expect(mockStartCheckpointServer).toHaveBeenCalledWith(0);
      expect(worker.getServer()).toBe(mockServer);
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.SERVER_STARTED,
        data: {
          port: 4000,
          url: "http://127.0.0.1:4000",
        },
      });
    });

    it("should handle server already running error", async () => {
      // First, start a server
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();
      jest.clearAllMocks();

      // Try to start again
      await worker.startServer();

      expect(mockStartCheckpointServer).not.toHaveBeenCalled();
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Server is already running",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Server is already running",
      });
    });

    it("should handle invalid server address", async () => {
      mockServer.address.mockReturnValue("invalid");
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Could not find allocated port for checkpoint server",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Could not find allocated port for checkpoint server",
      });
    });

    it("should handle null server address", async () => {
      mockServer.address.mockReturnValue(null);
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Could not find allocated port for checkpoint server",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Could not find allocated port for checkpoint server",
      });
    });

    it("should handle non-Error rejection", async () => {
      mockStartCheckpointServer.mockRejectedValue("string error");

      await worker.startServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "string error",
          stack: expect.any(String),
          code: undefined,
        },
        error: "string error",
      });
    });

    it("should handle error with code property", async () => {
      const errorWithCode = new Error("Error with code") as Error & {
        code: string;
      };
      errorWithCode.code = "EADDRINUSE";
      
      mockStartCheckpointServer.mockRejectedValue(errorWithCode);

      await worker.startServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Error with code",
          stack: expect.any(String),
          code: "EADDRINUSE",
        },
        error: "Error with code",
      });
    });
  });

  describe("shutdownServer", () => {
    beforeEach(async () => {
      // Set up a running server
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback();
        return mockServer;
      });
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();
      jest.clearAllMocks();
    });

    it("should shutdown server successfully", async () => {
      await worker.shutdownServer();

      expect(mockServer.closeAllConnections).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalledWith(expect.any(Function));
      expect(worker.getServer()).toBeNull();
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.SERVER_SHUTDOWN,
      });
      expect(mockMessagePort.close).toHaveBeenCalled();
    });

    it("should handle shutdown when no server is running", async () => {
      // Create a fresh worker with no server
      const freshWorker = new CheckpointServerWorker(mockMessagePort);

      await freshWorker.shutdownServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Could not find running server",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Could not find running server",
      });
      expect(mockMessagePort.close).toHaveBeenCalled();
    });

    it("should handle shutdown error but still close message port", async () => {
      const shutdownError = new Error("Shutdown failed");
      mockServer.close.mockImplementation(() => {
        throw shutdownError;
      });

      await worker.shutdownServer();

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Shutdown failed",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Shutdown failed",
      });
      expect(mockMessagePort.close).toHaveBeenCalled();
    });
  });

  describe("handleMessage", () => {
    beforeEach(async () => {
      // Set up message handling
      mockMessagePort.on.mockImplementation((event, listener) => {
        if (event === "message") {
          // Store the listener for manual triggering
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
          (worker as any).messageListener = listener;
        }
        return mockMessagePort;
      });

      // Set up a running server for shutdown tests
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4", 
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback();
        return mockServer;
      });
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.initialize();
      jest.clearAllMocks();
    });

    it("should handle SHUTDOWN_SERVER command", async () => {
      const command: WorkerCommand = {
        type: WorkerCommandType.SHUTDOWN_SERVER,
      };

      // Trigger the message handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const messageListener = (worker as any).messageListener;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      messageListener(command);

      // Wait for async shutdown to complete
      await new Promise(resolve => setImmediate(resolve));

      expect(mockServer.closeAllConnections).toHaveBeenCalled();
      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.SERVER_SHUTDOWN,
      });
    });

    it("should handle unknown command", () => {
      const command = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: "UNKNOWN_COMMAND" as any,
      };

      // Trigger the message handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const messageListener = (worker as any).messageListener;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      messageListener(command);

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Unknown command: UNKNOWN_COMMAND",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Unknown command: UNKNOWN_COMMAND",
      });
    });

    it("should handle null command type", () => {
      const command = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: null as any,
      };

      // Trigger the message handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const messageListener = (worker as any).messageListener;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      messageListener(command);

      expect(mockMessagePort.postMessage).toHaveBeenCalledWith({
        type: WorkerResponseType.ERROR,
        data: {
          message: "Unknown command: null",
          stack: expect.any(String),
          code: undefined,
        },
        error: "Unknown command: null",
      });
    });
  });

  describe("getServer", () => {
    it("should return null initially", () => {
      expect(worker.getServer()).toBeNull();
    });

    it("should return server after starting", async () => {
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();

      expect(worker.getServer()).toBe(mockServer);
    });

    it("should return null after shutdown", async () => {
      // Start server
      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);
      mockServer.close.mockImplementation((callback) => {
        if (callback) callback();
        return mockServer;
      });
      mockStartCheckpointServer.mockResolvedValue(mockServer);

      await worker.startServer();
      expect(worker.getServer()).toBe(mockServer);

      // Shutdown server
      await worker.shutdownServer();
      expect(worker.getServer()).toBeNull();
    });
  });
});
