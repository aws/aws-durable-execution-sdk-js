import { commonParams } from "../endpoint/EndpointParameters";
import { SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog, } from "../models/models_1";
import { de_SendDurableExecutionCallbackSuccessCommand, se_SendDurableExecutionCallbackSuccessCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class SendDurableExecutionCallbackSuccessCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "SendDurableExecutionCallbackSuccess", {})
    .n("LambdaClient", "SendDurableExecutionCallbackSuccessCommand")
    .f(SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog, void 0)
    .ser(se_SendDurableExecutionCallbackSuccessCommand)
    .de(de_SendDurableExecutionCallbackSuccessCommand)
    .build() {
}
