import { commonParams } from "../endpoint/EndpointParameters";
import { FunctionConfiguration20150331FilterSensitiveLog, } from "../models/models_0";
import { de_GetFunctionConfiguration20150331v2Command, se_GetFunctionConfiguration20150331v2Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetFunctionConfiguration20150331v2Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetFunctionConfiguration20150331v2", {})
    .n("LambdaClient", "GetFunctionConfiguration20150331v2Command")
    .f(void 0, FunctionConfiguration20150331FilterSensitiveLog)
    .ser(se_GetFunctionConfiguration20150331v2Command)
    .de(de_GetFunctionConfiguration20150331v2Command)
    .build() {
}
