import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { Command as $Command } from "@smithy/smithy-client";
import { commonParams } from "../endpoint/EndpointParameters";
import { GetCapacityProvider } from "../schemas/schemas_0";
export { $Command };
export class GetCapacityProviderCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("AWSGirApiService", "GetCapacityProvider", {})
  .n("LambdaClient", "GetCapacityProviderCommand")
  .sc(GetCapacityProvider)
  .build() {}
