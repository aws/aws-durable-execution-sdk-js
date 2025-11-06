import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
import { commonParams } from "../endpoint/EndpointParameters";
import { SendDurableExecutionCallbackFailureRequestFilterSensitiveLog } from "../models/models_0";
import {
  de_SendDurableExecutionCallbackFailureCommand,
  se_SendDurableExecutionCallbackFailureCommand,
} from "../protocols/Aws_restJson1";
export { $Command };
export class SendDurableExecutionCallbackFailureCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getSerdePlugin(config, this.serialize, this.deserialize),
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("AWSGirApiService", "SendDurableExecutionCallbackFailure", {})
  .n("LambdaClient", "SendDurableExecutionCallbackFailureCommand")
  .f(SendDurableExecutionCallbackFailureRequestFilterSensitiveLog, void 0)
  .ser(se_SendDurableExecutionCallbackFailureCommand)
  .de(de_SendDurableExecutionCallbackFailureCommand)
  .build() {}
