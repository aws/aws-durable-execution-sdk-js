import {
  InvalidParameterValueException,
  ErrorObject,
} from "@aws-sdk/client-lambda";
import { RequestHandler } from "express";
import { createCallbackId } from "../utils/tagged-strings";
import { CompleteCallbackStatus } from "../storage/callback-manager";

export const handleCallbackFailure: RequestHandler<
  { callbackId: string },
  unknown,
  ErrorObject
> = (req, res) => {
  const callbackId = createCallbackId(req.params.callbackId);
  const input = req.body;

  const storage = req.executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    res.status(404).json({
      message: "Execution not found",
    });
    return;
  }

  try {
    storage.completeCallback(
      {
        CallbackId: callbackId,
        Error: input,
      },
      CompleteCallbackStatus.FAILED
    );
  } catch (err) {
    if (err instanceof InvalidParameterValueException) {
      // TODO: use the correct aws-sdk serialization for InvalidParameterValueException
      res.status(400).json({
        message: err.message,
      });
      return;
    } else {
      throw err;
    }
  }

  res.json({});
};

export const handleCallbackSuccess: RequestHandler<
  {
    callbackId: string;
  },
  unknown,
  Buffer
> = (req, res) => {
  const callbackId = createCallbackId(req.params.callbackId);
  const input = req.body;

  const storage = req.executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    res.status(404).json({
      message: "Execution not found",
    });
    return;
  }

  if (!Buffer.isBuffer(input)) {
    res.status(400).json({
      message: "Invalid buffer input",
    });
    return;
  }

  // todo: should we use utf-8 string or something else?
  const result = input.toString("utf-8");

  try {
    storage.completeCallback(
      {
        CallbackId: callbackId,
        Result: result,
      },
      CompleteCallbackStatus.SUCCEEDED
    );
  } catch (err) {
    if (err instanceof InvalidParameterValueException) {
      res.status(400).json({
        message: err.message,
      });
      return;
    } else {
      throw err;
    }
  }

  res.json({});
};

export const handleCallbackHeartbeat: RequestHandler<{
  callbackId: string;
}> = (req, res) => {
  const callbackId = createCallbackId(req.params.callbackId);

  const storage = req.executionManager.getCheckpointsByCallbackId(callbackId);

  if (!storage) {
    res.status(404).json({
      message: "Execution not found",
    });
    return;
  }

  try {
    storage.heartbeatCallback(callbackId);
  } catch (err) {
    if (err instanceof InvalidParameterValueException) {
      res.status(400).json({
        message: err.message,
      });
      return;
    } else {
      throw err;
    }
  }

  res.json({});
};
