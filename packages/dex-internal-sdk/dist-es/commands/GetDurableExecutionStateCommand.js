import { commonParams } from "../endpoint/EndpointParameters";
import { GetDurableExecutionStateResponseFilterSensitiveLog, } from "../models/models_0";
import { de_GetDurableExecutionStateCommand, se_GetDurableExecutionStateCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetDurableExecutionStateCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetDurableExecutionState", {})
    .n("LambdaClient", "GetDurableExecutionStateCommand")
    .f(void 0, GetDurableExecutionStateResponseFilterSensitiveLog)
    .ser(se_GetDurableExecutionStateCommand)
    .de(de_GetDurableExecutionStateCommand)
    .build() {
}
