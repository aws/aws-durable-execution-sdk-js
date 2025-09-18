import { commonParams } from "../endpoint/EndpointParameters";
import { de_ResignFunctionVersionCommand, se_ResignFunctionVersionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ResignFunctionVersionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ResignFunctionVersion", {})
    .n("LambdaClient", "ResignFunctionVersionCommand")
    .f(void 0, void 0)
    .ser(se_ResignFunctionVersionCommand)
    .de(de_ResignFunctionVersionCommand)
    .build() {
}
