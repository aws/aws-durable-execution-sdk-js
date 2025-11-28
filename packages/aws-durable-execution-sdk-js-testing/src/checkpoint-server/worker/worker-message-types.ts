/**
 * Type definitions for worker thread message passing between main thread and checkpoint server worker
 */

import { WorkerApiRequest } from "../worker-api/worker-api-request";
import { WorkerApiResponse } from "../worker-api/worker-api-response";
import { ApiType } from "../worker-api/worker-api-types";

export enum WorkerCommandType {
  START_SERVER = "START_SERVER",
  SHUTDOWN_SERVER = "SHUTDOWN_SERVER",
  API_REQUEST = "API_REQUEST",
}

export enum WorkerResponseType {
  SERVER_STARTED = "SERVER_STARTED",
  ERROR = "ERROR",
  API_RESPONSE = "API_RESPONSE",
  SERVER_SHUTDOWN = "SERVER_SHUTDOWN",
}

export interface ServerStartedData {
  port: number;
  url: string;
}

export interface ErrorData {
  message: string;
  stack?: string;
  code?: string;
}

export type WorkerCommand =
  | {
      type: WorkerCommandType.START_SERVER;
      port?: number;
    }
  | {
      type: WorkerCommandType.SHUTDOWN_SERVER;
    }
  | {
      type: WorkerCommandType.API_REQUEST;
      data: WorkerApiRequest<ApiType>;
    };

export type WorkerResponse =
  | {
      type: WorkerResponseType.SERVER_STARTED;
      data: ServerStartedData;
    }
  | {
      type: WorkerResponseType.ERROR;
      data: ErrorData;
      error: string;
    }
  | {
      type: WorkerResponseType.SERVER_SHUTDOWN;
    }
  | {
      type: WorkerResponseType.API_RESPONSE;
      data: WorkerApiResponse<ApiType>;
    };
