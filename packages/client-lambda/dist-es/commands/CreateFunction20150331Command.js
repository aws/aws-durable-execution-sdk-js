import { commonParams } from "../endpoint/EndpointParameters";
import { CreateFunctionRequestFilterSensitiveLog, FunctionConfiguration20150331FilterSensitiveLog, } from "../models/models_0";
import { de_CreateFunction20150331Command, se_CreateFunction20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class CreateFunction20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "CreateFunction20150331", {})
    .n("LambdaClient", "CreateFunction20150331Command")
    .f(CreateFunctionRequestFilterSensitiveLog, FunctionConfiguration20150331FilterSensitiveLog)
    .ser(se_CreateFunction20150331Command)
    .de(de_CreateFunction20150331Command)
    .build() {
}
