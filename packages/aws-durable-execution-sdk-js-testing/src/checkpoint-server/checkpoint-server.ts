import express, { Request } from "express";
import {
  CheckpointDurableExecutionRequest,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { convertDatesToTimestamps } from "../utils";
import { API_PATHS } from "./constants";
import { handleCheckpointServerError } from "./middleware/handle-checkpoint-server-error";
import { ExecutionManager } from "./storage/execution-manager";
import {
  processCallbackFailure,
  processCallbackHeartbeat,
  processCallbackSuccess,
} from "./handlers/callbacks";
import {
  processStartDurableExecution,
  processStartInvocation,
  processCompleteInvocation,
} from "./handlers/execution-handlers";
import {
  processPollCheckpointData,
  processUpdateCheckpointData,
  processCheckpointDurableExecution,
} from "./handlers/checkpoint-handlers";
import { processGetDurableExecutionState } from "./handlers/state-handlers";
import type { Server } from "http";
import { createRequestLogger } from "./middleware/request-logger";
import { defaultLogger } from "../logger";
import { ExecutionId, InvocationId } from "./utils/tagged-strings";
import { UpdateCheckpointDataRequest } from "./worker-api/worker-api-request";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      executionManager: ExecutionManager;
    }
  }
}

export async function startCheckpointServer(port: number) {
  const executionManager = new ExecutionManager();
  const logger = defaultLogger.child("Server");

  const app = express();

  app.use((req, _, next) => {
    req.executionManager = executionManager;
    next();
  });

  app.use(createRequestLogger());
  app.use(express.json({ limit: "1mb" })); // Increase limit to handle large step results
  app.use(express.raw({ limit: "1mb" })); // Also increase raw body limit

  /**
   * Starts a durable execution. Returns the data needed for the handler invocation event.
   */
  app.post(
    API_PATHS.START_DURABLE_EXECUTION,
    (req: Request<object, unknown, { payload: string }>, res) => {
      const result = processStartDurableExecution(
        req.body.payload,
        req.executionManager,
      );
      res.json(convertDatesToTimestamps(result));
    },
  );

  /**
   * Starts an invocation of a durable execution. Returns the data for an individual invocation for an
   * in-progress execution.
   */
  app.post(`${API_PATHS.START_INVOCATION}/:executionId`, (req, res) => {
    const result = processStartInvocation(
      req.params.executionId,
      req.executionManager,
    );
    res.json(convertDatesToTimestamps(result));
  });

  app.post(
    `${API_PATHS.COMPLETE_INVOCATION}/:executionId`,
    (
      req: Request<
        { executionId: ExecutionId },
        unknown,
        { invocationId: InvocationId; error?: ErrorObject }
      >,
      res,
    ) => {
      const result = processCompleteInvocation(
        req.params.executionId,
        req.body.invocationId,
        req.body.error,
        req.executionManager,
      );
      res.json(convertDatesToTimestamps(result));
    },
  );

  /**
   * Long polls for checkpoint data for an execution. The API will return data once checkpoint data
   * is available. It will store data until the next API call for this execution ID.
   */
  app.get(
    `${API_PATHS.POLL_CHECKPOINT_DATA}/:executionId`,
    async (req, res) => {
      const result = await processPollCheckpointData(
        req.params.executionId,
        req.executionManager,
      );
      res.json({
        operations: convertDatesToTimestamps(result.operations),
      });
    },
  );

  /**
   * Updates the checkpoint data for a particular execution and operation ID with the intended status.
   *
   * Used for resolving operations like wait steps, retries, and status transitions, and also for resolving the execution itself.
   */
  app.post(
    `${API_PATHS.UPDATE_CHECKPOINT_DATA}/:executionId/:operationId`,
    (
      req: Request<
        {
          executionId: ExecutionId;
          operationId: string;
        },
        unknown,
        Pick<UpdateCheckpointDataRequest, "operationData" | "payload" | "error">
      >,
      res,
    ) => {
      const result = processUpdateCheckpointData(
        req.params.executionId,
        req.params.operationId,
        req.body.operationData,
        req.body.payload,
        req.body.error,
        req.executionManager,
      );
      res.json(convertDatesToTimestamps({ operation: result }));
    },
  );

  /**
   * The API for GetDurableExecutionState used by the Language SDK and DEX service model.
   */
  app.get(`${API_PATHS.GET_STATE}/:durableExecutionArn/state`, (req, res) => {
    const result = processGetDurableExecutionState(
      req.params.durableExecutionArn,
      req.executionManager,
    );
    res.json(convertDatesToTimestamps(result));
  });

  /**
   * The API for CheckpointDurableExecution used by the Language SDK and DEX service model.
   */
  app.post(
    `${API_PATHS.CHECKPOINT}/:durableExecutionArn/checkpoint`,
    (
      req: Request<
        {
          durableExecutionArn: string;
        },
        unknown,
        CheckpointDurableExecutionRequest
      >,
      res,
    ) => {
      const result = processCheckpointDurableExecution(
        req.params.durableExecutionArn,
        req.body,
        req.executionManager,
      );
      res.json(convertDatesToTimestamps(result));
    },
  );

  app.post(
    `${API_PATHS.CALLBACKS}/:callbackId/succeed`,
    (
      req: Request<
        {
          callbackId: string;
        },
        unknown,
        Buffer
      >,
      res,
    ) => {
      const result = processCallbackSuccess(
        req.params.callbackId,
        req.body,
        req.executionManager,
      );
      res.json(result);
    },
  );

  app.post(
    `${API_PATHS.CALLBACKS}/:callbackId/fail`,
    (
      req: Request<
        {
          callbackId: string;
        },
        unknown,
        ErrorObject
      >,
      res,
    ) => {
      const result = processCallbackFailure(
        req.params.callbackId,
        req.body,
        req.executionManager,
      );
      res.json(result);
    },
  );

  app.post(`${API_PATHS.CALLBACKS}/:callbackId/heartbeat`, (req, res) => {
    const result = processCallbackHeartbeat(
      req.params.callbackId,
      req.executionManager,
    );
    res.json(result);
  });

  app.use((_req, res) => {
    res.status(404).json({
      message: "Not found",
    });
  });

  app.use(handleCheckpointServerError);

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err) => {
      if (err) {
        reject(err);
        return;
      }

      const address = server.address();
      logger.debug(
        `Checkpoint server listening ${
          address && typeof address !== "string"
            ? `on port ${address.port}`
            : ""
        }`,
      );
      resolve(server);
    });

    server.addListener("close", () => {
      executionManager.cleanup();
    });
  });
}
