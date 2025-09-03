import { commonParams } from "../endpoint/EndpointParameters";
import { GetDurableExecutionResponseFilterSensitiveLog } from "../models/models_0";
import {
  de_GetDurableExecutionCommand,
  se_GetDurableExecutionCommand,
} from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetDurableExecutionCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getSerdePlugin(config, this.serialize, this.deserialize),
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("DurableExecutionsFrontendService", "GetDurableExecution", {})
  .n("LambdaClient", "GetDurableExecutionCommand")
  .f(void 0, GetDurableExecutionResponseFilterSensitiveLog)
  .ser(se_GetDurableExecutionCommand)
  .de(de_GetDurableExecutionCommand)
  .build() {}
