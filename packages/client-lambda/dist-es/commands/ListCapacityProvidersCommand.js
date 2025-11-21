import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { Command as $Command } from "@smithy/smithy-client";
import { commonParams } from "../endpoint/EndpointParameters";
import { ListCapacityProviders } from "../schemas/schemas_0";
export { $Command };
export class ListCapacityProvidersCommand extends $Command
  .classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
  })
  .s("AWSGirApiService", "ListCapacityProviders", {})
  .n("LambdaClient", "ListCapacityProvidersCommand")
  .sc(ListCapacityProviders)
  .build() {}
