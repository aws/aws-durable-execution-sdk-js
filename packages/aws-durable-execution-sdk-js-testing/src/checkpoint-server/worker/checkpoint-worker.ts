/**
 * Worker thread entry point for the checkpoint server.
 * Processes checkpoint data and API requests separately from the main thread event loop.
 */

import { MessagePort, workerData } from "worker_threads";
import {
  WorkerCommand,
  WorkerResponse,
  WorkerResponseType,
} from "./worker-message-types";
import { WorkerServerApiHandler } from "../worker-api/worker-server-api-handler";
import { WorkerApiResponseMapping } from "../worker-api/worker-api-response";
import { ApiType } from "../worker-api/worker-api-types";
import { CheckpointWorkerManagerParams } from "../../test-runner/local/worker/checkpoint-worker-manager";

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const workerParams = workerData as CheckpointWorkerManagerParams;

/**
 * Manages the checkpoint server within a worker thread.
 * Handles server lifecycle and message communication with the main thread.
 */
export class CheckpointWorker {
  private readonly workerServerApiHandler = new WorkerServerApiHandler(
    workerParams,
  );

  constructor(private readonly messagePort: MessagePort) {}

  initialize() {
    this.setupMessageHandling();
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
   * Main message handler for commands from the main thread
   */
  private handleMessage(command: WorkerCommand): void {
    let response: WorkerApiResponseMapping[ApiType];
    try {
      response = this.workerServerApiHandler.performApiCall(command.data);
    } catch (error: unknown) {
      this.sendResponse({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          requestId: command.data.requestId,
          type: command.data.type,
          error,
        },
      });
      return;
    }

    if (response instanceof Promise) {
      response
        .then((data) => {
          this.sendResponse({
            type: WorkerResponseType.API_RESPONSE,
            data: {
              requestId: command.data.requestId,
              type: command.data.type,
              response: data,
            },
          });
        })
        .catch((error: unknown) => {
          this.sendResponse({
            type: WorkerResponseType.API_RESPONSE,
            data: {
              type: command.data.type,
              requestId: command.data.requestId,
              error,
            },
          });
        });
    } else {
      this.sendResponse({
        type: WorkerResponseType.API_RESPONSE,
        data: {
          type: command.data.type,
          requestId: command.data.requestId,
          response,
        },
      });
    }
  }
}
