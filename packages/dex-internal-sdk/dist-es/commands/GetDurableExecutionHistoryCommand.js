import { commonParams } from "../endpoint/EndpointParameters";
import { GetDurableExecutionHistoryResponseFilterSensitiveLog } from "../models/models_0";
import {
  de_GetDurableExecutionHistoryCommand,
  se_GetDurableExecutionHistoryCommand,
} from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetDurableExecutionHistoryCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getSerdePlugin(config, this.serialize, this.deserialize),
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("DurableExecutionsFrontendService", "GetDurableExecutionHistory", {})
  .n("LambdaClient", "GetDurableExecutionHistoryCommand")
  .f(void 0, GetDurableExecutionHistoryResponseFilterSensitiveLog)
  .ser(se_GetDurableExecutionHistoryCommand)
  .de(de_GetDurableExecutionHistoryCommand)
  .build() {}
