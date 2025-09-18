import { commonParams } from "../endpoint/EndpointParameters";
import { de_TagResourceBeforeResourceCreationCommand, se_TagResourceBeforeResourceCreationCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class TagResourceBeforeResourceCreationCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "TagResourceBeforeResourceCreation", {})
    .n("LambdaClient", "TagResourceBeforeResourceCreationCommand")
    .f(void 0, void 0)
    .ser(se_TagResourceBeforeResourceCreationCommand)
    .de(de_TagResourceBeforeResourceCreationCommand)
    .build() {
}
