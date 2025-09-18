import { commonParams } from "../endpoint/EndpointParameters";
import { de_PutFunctionScalingConfigCommand, se_PutFunctionScalingConfigCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class PutFunctionScalingConfigCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PutFunctionScalingConfig", {})
    .n("LambdaClient", "PutFunctionScalingConfigCommand")
    .f(void 0, void 0)
    .ser(se_PutFunctionScalingConfigCommand)
    .de(de_PutFunctionScalingConfigCommand)
    .build() {
}
