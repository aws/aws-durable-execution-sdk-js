/**
 * Manages the lifecycle of worker threads for the checkpoint server.
 * Handles spawning, communication, and cleanup of worker threads.
 */

import { Worker } from "worker_threads";
import path from "path";
import {
  WorkerResponse,
  WorkerResponseType,
  WorkerCommandType,
  ServerStartedData,
} from "../../checkpoint-server/worker/worker-message-types";
import { access, constants } from "fs/promises";

interface ServerInfo {
  url: string;
  port: number;
}

/**
 *  TODO: handle worker errors after they are started
 */
export class CheckpointServerWorkerManager {
  private worker: Worker | null = null;
  private readonly SHUTDOWN_TIMEOUT = 3000; // 3 seconds
  private readonly COMMAND_TIMEOUT = 4000; // 4 seconds

  private serverInfo: ServerInfo | null = null;

  private static instance: CheckpointServerWorkerManager | undefined =
    undefined;

  static getInstance() {
    this.instance ??= new CheckpointServerWorkerManager();
    return this.instance;
  }

  /**
   * Reset the singleton instance. Should only be used in tests.
   * @internal
   */
  static resetInstanceForTesting(): void {
    this.instance = undefined;
  }

  /**
   * Gets the current server URL and port if available
   */
  getServerInfo(): ServerInfo | null {
    return this.serverInfo;
  }

  private async waitForServerStart(): Promise<ServerStartedData> {
    const worker = this.worker;
    if (!worker) {
      throw new Error("Could not start server: worker not initialized");
    }

    return new Promise<ServerStartedData>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Starting the server timed out"));
      }, this.COMMAND_TIMEOUT);

      const errorListener = (err: Error): void => {
        clearTimeout(timeout);
        reject(err);
      };

      worker.addListener("error", errorListener);

      worker.once("message", (response: WorkerResponse) => {
        worker.removeListener("error", errorListener);

        clearTimeout(timeout);

        if (response.type === WorkerResponseType.SERVER_STARTED) {
          resolve(response.data);
          return;
        }

        reject(
          new Error(
            response.type === WorkerResponseType.ERROR
              ? response.error
              : "Unknown start response received"
          )
        );
      });
    });
  }

  private async waitForServerShutdown(): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      throw new Error("Could not stop server: worker not initialized");
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Stopping the server timed out"));
      }, this.SHUTDOWN_TIMEOUT);

      const errorListener = (err: Error): void => {
        clearTimeout(timeout);
        reject(err);
      };

      worker.addListener("error", errorListener);

      // Wait for graceful shutdown response
      worker.once("message", (response: WorkerResponse) => {
        worker.removeListener("error", errorListener);

        clearTimeout(timeout);
        if (response.type === WorkerResponseType.SERVER_SHUTDOWN) {
          resolve();
          return;
        }

        reject(
          new Error(
            response.type === WorkerResponseType.ERROR
              ? response.error
              : "Unknown stop response received"
          )
        );
      });

      worker.postMessage({ type: WorkerCommandType.SHUTDOWN_SERVER });
    });
  }

  private async getWorkerPath(): Promise<string> {
    const devWorkerPath = path.resolve(
      __dirname,
      "../../checkpoint-server/index.ts"
    );
    const prodWorkerPath = path.resolve(
      __dirname,
      "./checkpoint-server/index.js"
    );

    const isDev = await access(devWorkerPath, constants.F_OK)
      .then(() => true)
      .catch(() => false);

    return isDev ? devWorkerPath : prodWorkerPath;
  }

  /**
   * Starts the checkpoint server in the worker thread
   */
  async setup(): Promise<ServerStartedData> {
    const workerPath = await this.getWorkerPath();
    if (this.worker) {
      throw new Error("Worker thread is already running");
    }
    const worker = new Worker(workerPath, {
      execArgv: workerPath.endsWith(".ts")
        ? ["--require", "tsx/cjs"]
        : undefined,
    });
    this.worker = worker;

    worker.on("error", (err) => {
      console.warn("There was a worker error: ", err);
      this.worker = null;
      this.serverInfo = null;
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        console.warn(`Worker exited with code: ${code}`);
      }
      this.worker = null;
      this.serverInfo = null;
    });

    const serverInfo = await this.waitForServerStart();
    this.serverInfo = serverInfo;

    return serverInfo;
  }

  /**
   * Gracefully shuts down worker. Force terminates if the worker could not be shut
   * down gracefully.
   */
  async teardown(): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    try {
      await this.waitForServerShutdown();
      worker.unref();
    } catch {
      // If there was any error or timeout, force shutdown the worker
      try {
        await worker.terminate();
      } catch {
        // Ignore terminate errors - worker might already be dead
      }
    } finally {
      // Always clear worker and server info after teardown
      this.worker = null;
      this.serverInfo = null;
    }
  }
}
