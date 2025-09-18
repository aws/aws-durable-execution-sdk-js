import { commonParams } from "../endpoint/EndpointParameters";
import { UpdateFunctionCodeRequestFilterSensitiveLog, } from "../models/models_1";
import { de_UpdateFunctionCodeCommand, se_UpdateFunctionCodeCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UpdateFunctionCodeCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UpdateFunctionCode", {})
    .n("LambdaClient", "UpdateFunctionCodeCommand")
    .f(UpdateFunctionCodeRequestFilterSensitiveLog, void 0)
    .ser(se_UpdateFunctionCodeCommand)
    .de(de_UpdateFunctionCodeCommand)
    .build() {
}
