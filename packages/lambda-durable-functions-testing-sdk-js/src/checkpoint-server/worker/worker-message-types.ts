/**
 * Type definitions for worker thread message passing between main thread and checkpoint server worker
 */

export enum WorkerCommandType {
  START_SERVER = "START_SERVER",
  SHUTDOWN_SERVER = "SHUTDOWN_SERVER",
}

export enum WorkerResponseType {
  SERVER_STARTED = "SERVER_STARTED",
  ERROR = "ERROR",
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
    };
