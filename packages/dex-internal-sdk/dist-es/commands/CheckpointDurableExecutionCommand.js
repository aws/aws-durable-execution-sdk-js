import { commonParams } from "../endpoint/EndpointParameters";
import { CheckpointDurableExecutionRequestFilterSensitiveLog, CheckpointDurableExecutionResponseFilterSensitiveLog, } from "../models/models_0";
import { de_CheckpointDurableExecutionCommand, se_CheckpointDurableExecutionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class CheckpointDurableExecutionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "CheckpointDurableExecution", {})
    .n("LambdaClient", "CheckpointDurableExecutionCommand")
    .f(CheckpointDurableExecutionRequestFilterSensitiveLog, CheckpointDurableExecutionResponseFilterSensitiveLog)
    .ser(se_CheckpointDurableExecutionCommand)
    .de(de_CheckpointDurableExecutionCommand)
    .build() {
}
