import { ErrorRequestHandler } from "express";

export const handleCheckpointServerError: ErrorRequestHandler = (
  err: unknown,
  req,
  res,
  // Express requires error handlers to have 4 parameters, even if not all are used
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next
) => {
  console.error("Checkpoint server error:", err);
  res.status(500).json({
    message:
      typeof err === "object" && err && "message" in err
        ? err.message
        : "Unexpected error",
  });
};
