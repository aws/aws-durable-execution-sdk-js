import { commonParams } from "../endpoint/EndpointParameters";
import { GetFunctionInternalResponseFilterSensitiveLog, } from "../models/models_0";
import { de_GetFunctionInternalCommand, se_GetFunctionInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetFunctionInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetFunctionInternal", {})
    .n("LambdaClient", "GetFunctionInternalCommand")
    .f(void 0, GetFunctionInternalResponseFilterSensitiveLog)
    .ser(se_GetFunctionInternalCommand)
    .de(de_GetFunctionInternalCommand)
    .build() {
}
