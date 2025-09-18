import { commonParams } from "../endpoint/EndpointParameters";
import { de_PutPublicAccessBlockConfigCommand, se_PutPublicAccessBlockConfigCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class PutPublicAccessBlockConfigCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PutPublicAccessBlockConfig", {})
    .n("LambdaClient", "PutPublicAccessBlockConfigCommand")
    .f(void 0, void 0)
    .ser(se_PutPublicAccessBlockConfigCommand)
    .de(de_PutPublicAccessBlockConfigCommand)
    .build() {
}
