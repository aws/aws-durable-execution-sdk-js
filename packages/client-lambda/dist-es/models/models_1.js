import { SENSITIVE_STRING } from "@smithy/smithy-client";
import { ErrorObjectFilterSensitiveLog } from "./models_0";
export const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (
  obj,
) => ({
  ...obj,
  ...(obj.Result && { Result: SENSITIVE_STRING }),
});
export const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
