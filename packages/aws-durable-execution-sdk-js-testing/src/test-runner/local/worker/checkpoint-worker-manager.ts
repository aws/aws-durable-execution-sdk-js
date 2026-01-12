/**
 * Manages the lifecycle of worker threads for the checkpoint server.
 * Handles spawning, communication, and cleanup of worker threads.
 */

import { Worker } from "worker_threads";
import path from "path";
import { WorkerResponse } from "../../../checkpoint-server/worker/worker-message-types";
import { defaultLogger } from "../../../logger";
import { WorkerClientApiHandler } from "./worker-client-api-handler";
import { ApiType } from "../../../checkpoint-server/worker-api/worker-api-types";
import { WorkerApiRequestMapping } from "../../../checkpoint-server/worker-api/worker-api-request";
import { WorkerApiResponseMapping } from "../../../checkpoint-server/worker-api/worker-api-response";
import { reparseDates } from "../../../utils";
import { RealDate } from "../real-timers/real-timers";

export type CheckpointWorkerManagerParams =
  | {
      checkpointDelaySettings?: number;
    }
  | undefined;

/**
 *  TODO: handle worker errors after they are started
 */
export class CheckpointWorkerManager {
  private worker: Worker | null = null;

  private static instance: CheckpointWorkerManager | undefined = undefined;

  private readonly workerApiHandler = new WorkerClientApiHandler();

  constructor(private readonly params?: CheckpointWorkerManagerParams) {}

  private static createInstance(params: CheckpointWorkerManagerParams) {
    if (this.instance) {
      throw new Error("CheckpointWorkerManager was already created");
    }
    this.instance = new CheckpointWorkerManager(params);
    return this.instance;
  }

  static getInstance(params?: CheckpointWorkerManagerParams) {
    if (!this.instance) {
      if (params) {
        this.instance = this.createInstance(params);
      } else {
        throw new Error("CheckpointWorkerManager has not been created");
      }
    }
    return this.instance;
  }

  /**
   * Reset the singleton instance. Should only be used in tests.
   * @internal
   */
  static resetInstanceForTesting(): void {
    this.instance = undefined;
  }

  private getWorkerPath(): string {
    const devWorkerPath = path.resolve(
      __dirname,
      "../../../checkpoint-server/index.ts",
    );
    const prodWorkerFiletype = process.env.IS_ESM ? "mjs" : "js";
    const prodWorkerPath = path.resolve(
      __dirname,
      `./checkpoint-server/index.${prodWorkerFiletype}`,
    );

    return process.env.NODE_ENV === "production"
      ? prodWorkerPath
      : devWorkerPath;
  }

  /**
   * Starts the checkpoint server in the worker thread
   */
  async setup(): Promise<void> {
    const workerPath = this.getWorkerPath();
    if (this.worker) {
      throw new Error("Worker thread is already running");
    }
    const worker = new Worker(workerPath, {
      execArgv: workerPath.endsWith(".ts")
        ? ["--require", "tsx/cjs"]
        : undefined,
      workerData: this.params satisfies CheckpointWorkerManagerParams,
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

    // Return a promise for future compatability. We may want to wait for an initial message
    // to the worker to ensure that it is active
    return Promise.resolve();
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
