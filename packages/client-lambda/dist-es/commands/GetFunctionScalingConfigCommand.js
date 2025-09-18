import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetFunctionScalingConfigCommand, se_GetFunctionScalingConfigCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetFunctionScalingConfigCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetFunctionScalingConfig", {})
    .n("LambdaClient", "GetFunctionScalingConfigCommand")
    .f(void 0, void 0)
    .ser(se_GetFunctionScalingConfigCommand)
    .de(de_GetFunctionScalingConfigCommand)
    .build() {
}
