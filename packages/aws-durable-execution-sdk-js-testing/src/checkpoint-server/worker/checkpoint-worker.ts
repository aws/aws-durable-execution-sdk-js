/**
 * Worker thread entry point for the checkpoint server.
 * Runs the Express server in isolation from the main thread event loop.
 */

import type { MessagePort } from "worker_threads";
import {
  WorkerCommand,
  WorkerResponse,
  WorkerResponseType,
} from "./worker-message-types";
import { WorkerServerApiHandler } from "../worker-api/worker-server-api-handler";
import { WorkerApiResponseMapping } from "../worker-api/worker-api-response";
import { ApiType } from "../worker-api/worker-api-types";

/**
 * Manages the checkpoint server within a worker thread.
 * Handles server lifecycle and message communication with the main thread.
 */
export class CheckpointWorker {
  private readonly workerServerApiHandler = new WorkerServerApiHandler();

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

    // This logic is only for PollCheckpointData
    // TODO: replace this with event-based resolution
    // instead of long-polling promises
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
