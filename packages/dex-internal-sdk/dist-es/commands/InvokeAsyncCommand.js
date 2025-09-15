import { commonParams } from "../endpoint/EndpointParameters";
import { InvokeAsyncRequestFilterSensitiveLog, InvokeAsyncResponseFilterSensitiveLog, } from "../models/models_1";
import { de_InvokeAsyncCommand, se_InvokeAsyncCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class InvokeAsyncCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "InvokeAsync", {})
    .n("LambdaClient", "InvokeAsyncCommand")
    .f(InvokeAsyncRequestFilterSensitiveLog, InvokeAsyncResponseFilterSensitiveLog)
    .ser(se_InvokeAsyncCommand)
    .de(de_InvokeAsyncCommand)
    .build() {
}
