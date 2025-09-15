import { commonParams } from "../endpoint/EndpointParameters";
import { de_SendDurableExecutionCallbackHeartbeatCommand, se_SendDurableExecutionCallbackHeartbeatCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class SendDurableExecutionCallbackHeartbeatCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "SendDurableExecutionCallbackHeartbeat", {})
    .n("LambdaClient", "SendDurableExecutionCallbackHeartbeatCommand")
    .f(void 0, void 0)
    .ser(se_SendDurableExecutionCallbackHeartbeatCommand)
    .de(de_SendDurableExecutionCallbackHeartbeatCommand)
    .build() {
}
