import { ErrorObject } from "@aws-sdk/client-lambda";

export class CallbackError extends Error {
  public data?: string;
  public cause?: Error;
  constructor(errorObject?: ErrorObject) {
    super("Callback failed");
    this.name = "CallbackError";

    if (errorObject) {
      const cause = new Error(errorObject.ErrorMessage);
      cause.stack = errorObject.StackTrace?.join("\n");
      cause.name = errorObject.ErrorType ?? cause.name;
      this.cause = cause;
    }

    this.data = errorObject?.ErrorData;
  }
}
