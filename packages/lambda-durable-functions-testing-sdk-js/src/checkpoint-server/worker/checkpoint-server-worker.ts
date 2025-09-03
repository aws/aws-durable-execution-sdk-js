/**
 * Worker thread entry point for the checkpoint server.
 * Runs the Express server in isolation from the main thread event loop.
 */

import type { MessagePort } from "worker_threads";
import type { Server } from "http";
import { startCheckpointServer } from "../checkpoint-server";
import {
  WorkerCommand,
  WorkerResponse,
  WorkerCommandType,
  WorkerResponseType,
  ServerStartedData,
  ErrorData,
} from "./worker-message-types";

/**
 * Manages the checkpoint server within a worker thread.
 * Handles server lifecycle and message communication with the main thread.
 */
export class CheckpointServerWorker {
  private server: Server | null = null;

  constructor(private readonly messagePort: MessagePort) {}

  /**
   * Initializes the worker by setting up message handling and starting the server
   */
  async initialize(): Promise<void> {
    this.setupMessageHandling();
    await this.startServer();
  }

  /**
   * Sets up message handling from the main thread
   */
  private setupMessageHandling(): void {
    this.messagePort.on("message", (command: WorkerCommand) => {
      this.handleMessage(command);
    });
  }

  /**
   * Sends a response message to the main thread
   */
  private sendResponse(response: WorkerResponse): void {
    this.messagePort.postMessage(response);
  }

  /**
   * Sends an error response to the main thread
   */
  private sendError(error: Error): void {
    const errorData: ErrorData = {
      message: error.message,
      stack: error.stack,
      code: "code" in error ? String(error.code) : undefined,
    };

    this.sendResponse({
      type: WorkerResponseType.ERROR,
      data: errorData,
      error: error.message,
    });
  }

  /**
   * Starts the checkpoint server and notifies the main thread
   */
  async startServer(): Promise<void> {
    try {
      if (this.server) {
        this.sendError(new Error("Server is already running"));
        return;
      }

      this.server = await startCheckpointServer(0);

      const address = this.server.address();
      if (typeof address === "string" || typeof address?.port !== "number") {
        throw new Error("Could not find allocated port for checkpoint server");
      }

      const port = address.port;
      const serverData: ServerStartedData = {
        port,
        url: `http://127.0.0.1:${port}`,
      };

      this.sendResponse({
        type: WorkerResponseType.SERVER_STARTED,
        data: serverData,
      });
    } catch (error) {
      const errorToSend =
        error instanceof Error ? error : new Error(String(error));
      this.sendError(errorToSend);
    }
  }

  /**
   * Gracefully shuts down the server and closes the worker thread
   */
  async shutdownServer(): Promise<void> {
    try {
      if (!this.server) {
        throw new Error("Could not find running server");
      }

      const currentServer = this.server;
      await new Promise<void>((resolve) => {
        currentServer.closeAllConnections();
        currentServer.close(() => {
          this.server = null;
          resolve();
        });
      });

      this.sendResponse({
        type: WorkerResponseType.SERVER_SHUTDOWN,
      });
    } catch (error) {
      const errorToSend =
        error instanceof Error ? error : new Error(String(error));
      this.sendError(errorToSend);
    } finally {
      this.messagePort.close();
    }
  }

  /**
   * Main message handler for commands from the main thread
   */
  private handleMessage(command: WorkerCommand): void {
    switch (command.type) {
      case WorkerCommandType.SHUTDOWN_SERVER:
        void this.shutdownServer();
        break;
      default:
        this.sendError(new Error(`Unknown command: ${command.type}`));
    }
  }

  /**
   * Gets the current server instance (for testing)
   */
  getServer(): Server | null {
    return this.server;
  }
}
