import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetPublicAccessBlockConfigCommand, se_GetPublicAccessBlockConfigCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetPublicAccessBlockConfigCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetPublicAccessBlockConfig", {})
    .n("LambdaClient", "GetPublicAccessBlockConfigCommand")
    .f(void 0, void 0)
    .ser(se_GetPublicAccessBlockConfigCommand)
    .de(de_GetPublicAccessBlockConfigCommand)
    .build() {
}
