/**
 * Manages the lifecycle of worker threads for the checkpoint server.
 * Handles spawning, communication, and cleanup of worker threads.
 */

import { Worker } from "worker_threads";
import path from "path";
import { WorkerResponse } from "../../../checkpoint-server/worker/worker-message-types";
import { access, constants } from "fs/promises";
import { defaultLogger } from "../../../logger";
import { WorkerClientApiHandler } from "./worker-client-api-handler";
import { ApiType } from "../../../checkpoint-server/worker-api/worker-api-types";
import { WorkerApiRequestMapping } from "../../../checkpoint-server/worker-api/worker-api-request";
import { WorkerApiResponseMapping } from "../../../checkpoint-server/worker-api/worker-api-response";
import { reparseDates } from "../../../utils";
import { RealDate } from "../real-timers/real-timers";

/**
 *  TODO: handle worker errors after they are started
 */
export class CheckpointWorkerManager {
  private worker: Worker | null = null;

  private static instance: CheckpointWorkerManager | undefined = undefined;

  private readonly workerApiHandler = new WorkerClientApiHandler();

  static getInstance() {
    this.instance ??= new CheckpointWorkerManager();
    return this.instance;
  }

  /**
   * Reset the singleton instance. Should only be used in tests.
   * @internal
   */
  static resetInstanceForTesting(): void {
    this.instance = undefined;
  }

  private async getWorkerPath(): Promise<string> {
    const devWorkerPath = path.resolve(
      __dirname,
      "../../../checkpoint-server/index.ts",
    );
    const prodWorkerPath = path.resolve(
      __dirname,
      "./checkpoint-server/index.js",
    );

    const isDev = await access(devWorkerPath, constants.F_OK)
      .then(() => true)
      .catch(() => false);

    return isDev ? devWorkerPath : prodWorkerPath;
  }

  /**
   * Starts the checkpoint server in the worker thread
   */
  async setup(): Promise<void> {
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
      defaultLogger.warn("There was a worker error: ", err);
      this.worker = null;
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        defaultLogger.warn(`Worker exited with code: ${code}`);
      }
      this.worker = null;
    });

    this.worker.on("message", (response: WorkerResponse) => {
      this.workerApiHandler.handleApiCallResponse(
        reparseDates(response.data, RealDate),
      );
    });
  }

  async sendApiRequest<TApiType extends ApiType>(
    apiType: TApiType,
    params: WorkerApiRequestMapping[TApiType],
  ): Promise<WorkerApiResponseMapping[TApiType]> {
    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    return this.workerApiHandler.callWorkerApi(apiType, params, this.worker);
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
    }
  }
}
