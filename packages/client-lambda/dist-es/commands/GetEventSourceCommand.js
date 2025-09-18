import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetEventSourceCommand, se_GetEventSourceCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetEventSourceCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetEventSource", {})
    .n("LambdaClient", "GetEventSourceCommand")
    .f(void 0, void 0)
    .ser(se_GetEventSourceCommand)
    .de(de_GetEventSourceCommand)
    .build() {
}
