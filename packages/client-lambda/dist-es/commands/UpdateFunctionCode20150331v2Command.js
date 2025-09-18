import { commonParams } from "../endpoint/EndpointParameters";
import { FunctionConfiguration20150331FilterSensitiveLog, } from "../models/models_0";
import { UpdateFunctionCodeRequest20150331FilterSensitiveLog, } from "../models/models_1";
import { de_UpdateFunctionCode20150331v2Command, se_UpdateFunctionCode20150331v2Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UpdateFunctionCode20150331v2Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UpdateFunctionCode20150331v2", {})
    .n("LambdaClient", "UpdateFunctionCode20150331v2Command")
    .f(UpdateFunctionCodeRequest20150331FilterSensitiveLog, FunctionConfiguration20150331FilterSensitiveLog)
    .ser(se_UpdateFunctionCode20150331v2Command)
    .de(de_UpdateFunctionCode20150331v2Command)
    .build() {
}
