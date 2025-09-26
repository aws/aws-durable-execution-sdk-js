import {
  CheckpointDurableExecutionRequest,
  GetDurableExecutionStateResponse,
  CheckpointDurableExecutionResponse,
  InvalidParameterValueException,
  Operation,
} from "@aws-sdk/client-lambda";
import { ParamsDictionary } from "express-serve-static-core";
import express from "express";
import type { Request } from "express";
import { convertDatesToTimestamps } from "../utils";
import { createCheckpointToken } from "./utils/tagged-strings";
import {
  decodeCheckpointToken,
  encodeCheckpointToken,
} from "./utils/checkpoint-token";
import { API_PATHS } from "./constants";
import { handleCheckpointServerError } from "./middleware/handle-checkpoint-server-error";
import { ExecutionManager } from "./storage/execution-manager";
import { createExecutionId } from "./utils/tagged-strings";
import {
  handleCallbackFailure,
  handleCallbackHeartbeat,
  handleCallbackSuccess,
} from "./handlers/callbacks";
import type { Server } from "http";
import { validateCheckpointUpdates } from "./validators/checkpoint-durable-execution-input-validator";
import { randomUUID } from "crypto";

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

  const app = express();

  app.use((req, _, next) => {
    req.executionManager = executionManager;
    next();
  });

  app.use(express.json());

  /**
   * Starts a durable execution. Returns the data needed for the handler invocation event.
   */
  app.post(
    API_PATHS.START_DURABLE_EXECUTION,
    (
      req: Request<
        ParamsDictionary,
        object,
        {
          payload: string;
        }
      >,
      res
    ) => {
      res.json(
        executionManager.startExecution({
          payload: req.body.payload,
          executionId: createExecutionId(),
        })
      );
    }
  );

  /**
   * Starts an invocation of a durable execution. Returns the data for an individual invocation for an
   * in-progress execution.
   */
  app.post(`${API_PATHS.START_INVOCATION}/:executionId`, (req, res) => {
    res.json(
      executionManager.startInvocation(
        createExecutionId(req.params.executionId)
      )
    );
  });

  /**
   * Long polls for checkpoint data for an execution. The API will return data once checkpoint data
   * is available. It will store data until the next API call for this execution ID.
   */
  app.get(
    `${API_PATHS.POLL_CHECKPOINT_DATA}/:executionId`,
    async (req, res) => {
      const executionId = createExecutionId(req.params.executionId);

      const checkpointStorage =
        executionManager.getCheckpointsByExecution(executionId);

      if (!checkpointStorage) {
        res.status(404).json({
          message: "Execution not found",
        });
        return;
      }

      const operations = await checkpointStorage.getPendingCheckpointUpdates();

      res.json({
        operations: convertDatesToTimestamps(operations),
        operationInvocationIdMap:
          checkpointStorage.getOperationInvocationIdMap(),
      });
    }
  );

  /**
   * Updates the checkpoint data for a particular execution and operation ID with the intended status.
   *
   * Used for resolving operations like wait steps, retries, and status transitions.
   */
  app.post(
    `${API_PATHS.UPDATE_CHECKPOINT_DATA}/:executionId/:operationId`,
    (
      req: Request<
        ParamsDictionary,
        object,
        {
          operationData: Operation;
        }
      >,
      res
    ) => {
      const executionId = createExecutionId(req.params.executionId);

      const checkpointStorage =
        executionManager.getCheckpointsByExecution(executionId);

      if (!checkpointStorage) {
        res.status(404).json({
          message: "Execution not found",
        });
        return;
      }

      if (!checkpointStorage.hasOperation(req.params.operationId)) {
        res.status(404).json({
          message: "Operation not found",
        });
        return;
      }

      const operation = checkpointStorage.updateOperation(
        req.params.operationId,
        req.body.operationData
      );

      res.json(
        convertDatesToTimestamps({
          operation,
        })
      );
    }
  );

  /**
   * The API for GetDurableExecutionState used by the Language SDK and DEX service model.
   */
  app.get(`${API_PATHS.GET_STATE}/:durableExecutionArn/state`, (req, res) => {
    const executionData = executionManager.getCheckpointsByExecution(
      createExecutionId(req.params.durableExecutionArn)
    );

    if (!executionData) {
      res.status(404).json({
        message: "Execution not found",
      });
      return;
    }

    const output: GetDurableExecutionStateResponse = {
      Operations: executionData.getState(),
      NextMarker: undefined,
    };

    res.json(convertDatesToTimestamps(output));
  });

  /**
   * The API for CheckpointDurableExecution used by the Language SDK and DEX service model.
   */
  app.post(
    `${API_PATHS.CHECKPOINT}/:durableExecutionArn/checkpoint`,
    (req, res) => {
      const storage = executionManager.getCheckpointsByExecution(
        createExecutionId(req.params.durableExecutionArn)
      );
      if (!storage) {
        res.status(404).json({
          message: "Execution not found",
        });
        return;
      }

      // TODO: validate the body instead of casting
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const input = req.body as CheckpointDurableExecutionRequest;
      const updates = input.Updates ?? [];

      if (!input.CheckpointToken) {
        throw new InvalidParameterValueException({
          message: "Checkpoint token is required",
          $metadata: {},
        });
      }

      const data = decodeCheckpointToken(
        createCheckpointToken(input.CheckpointToken)
      );

      try {
        validateCheckpointUpdates(updates, storage.operationDataMap);
        storage.registerUpdates(updates, data.invocationId);
      } catch (err: unknown) {
        if (err instanceof InvalidParameterValueException) {
          res.setHeaders(
            new Headers({
              "x-amzn-errortype": err.name,
            })
          );
          res.status(400).json({
            Type: err.name,
            message: err.message,
          });
          return;
        }
        throw err;
      }

      const output: CheckpointDurableExecutionResponse = {
        CheckpointToken: encodeCheckpointToken({
          executionId: data.executionId,
          invocationId: data.invocationId,
          token: randomUUID(),
        }),
        NewExecutionState: {
          // TODO: implement pagination
          Operations: Array.from(storage.operationDataMap.values()).map(
            (data) => data.operation
          ),
          NextMarker: undefined,
        },
      };

      res.json(convertDatesToTimestamps(output));
    }
  );

  app.post(
    `${API_PATHS.CALLBACKS}/:callbackId/succeed`,
    express.raw(),
    handleCallbackSuccess
  );

  app.post(`${API_PATHS.CALLBACKS}/:callbackId/fail`, handleCallbackFailure);

  app.post(
    `${API_PATHS.CALLBACKS}/:callbackId/heartbeat`,
    handleCallbackHeartbeat
  );

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
      console.info(
        `Checkpoint server listening ${
          address && typeof address !== "string"
            ? `on port ${address.port}`
            : ""
        }`
      );
      resolve(server);
    });

    server.addListener("close", () => {
      executionManager.cleanup();
    });
  });
}
