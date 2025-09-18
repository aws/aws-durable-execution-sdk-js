import { commonParams } from "../endpoint/EndpointParameters";
import { StopDurableExecutionRequestFilterSensitiveLog, } from "../models/models_1";
import { de_StopDurableExecutionCommand, se_StopDurableExecutionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class StopDurableExecutionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "StopDurableExecution", {})
    .n("LambdaClient", "StopDurableExecutionCommand")
    .f(StopDurableExecutionRequestFilterSensitiveLog, void 0)
    .ser(se_StopDurableExecutionCommand)
    .de(de_StopDurableExecutionCommand)
    .build() {
}
