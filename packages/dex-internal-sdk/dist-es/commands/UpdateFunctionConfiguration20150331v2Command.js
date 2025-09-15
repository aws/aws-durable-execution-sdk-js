import { commonParams } from "../endpoint/EndpointParameters";
import { FunctionConfiguration20150331FilterSensitiveLog, } from "../models/models_0";
import { UpdateFunctionConfigurationRequest20150331FilterSensitiveLog, } from "../models/models_1";
import { de_UpdateFunctionConfiguration20150331v2Command, se_UpdateFunctionConfiguration20150331v2Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UpdateFunctionConfiguration20150331v2Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UpdateFunctionConfiguration20150331v2", {})
    .n("LambdaClient", "UpdateFunctionConfiguration20150331v2Command")
    .f(UpdateFunctionConfigurationRequest20150331FilterSensitiveLog, FunctionConfiguration20150331FilterSensitiveLog)
    .ser(se_UpdateFunctionConfiguration20150331v2Command)
    .de(de_UpdateFunctionConfiguration20150331v2Command)
    .build() {
}
