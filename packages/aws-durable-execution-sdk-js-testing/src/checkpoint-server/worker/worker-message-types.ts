/**
 * Type definitions for worker thread message passing between main thread and checkpoint server worker
 */

import { WorkerApiRequestMessage } from "../worker-api/worker-api-request";
import { WorkerApiResponse } from "../worker-api/worker-api-response";
import { ApiType } from "../worker-api/worker-api-types";

export enum WorkerCommandType {
  API_REQUEST = "API_REQUEST",
}

export enum WorkerResponseType {
  API_RESPONSE = "API_RESPONSE",
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

export interface WorkerCommand {
  type: WorkerCommandType.API_REQUEST;
  data: WorkerApiRequestMessage;
}

export interface WorkerResponse {
  type: WorkerResponseType.API_RESPONSE;
  data: WorkerApiResponse<ApiType>;
}
