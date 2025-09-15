import { commonParams } from "../endpoint/EndpointParameters";
import { InvokeWithResponseStreamRequestFilterSensitiveLog, InvokeWithResponseStreamResponseFilterSensitiveLog, } from "../models/models_1";
import { de_InvokeWithResponseStreamCommand, se_InvokeWithResponseStreamCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class InvokeWithResponseStreamCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "InvokeWithResponseStream", {
    eventStream: {
        output: true,
    },
})
    .n("LambdaClient", "InvokeWithResponseStreamCommand")
    .f(InvokeWithResponseStreamRequestFilterSensitiveLog, InvokeWithResponseStreamResponseFilterSensitiveLog)
    .ser(se_InvokeWithResponseStreamCommand)
    .de(de_InvokeWithResponseStreamCommand)
    .build() {
}
