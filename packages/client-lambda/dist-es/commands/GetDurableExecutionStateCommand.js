import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { Command as $Command } from "@smithy/smithy-client";
import { commonParams } from "../endpoint/EndpointParameters";
import { GetDurableExecutionState } from "../schemas/schemas_0";
export { $Command };
export class GetDurableExecutionStateCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("AWSGirApiService", "GetDurableExecutionState", {})
  .n("LambdaClient", "GetDurableExecutionStateCommand")
  .sc(GetDurableExecutionState)
  .build() {}
