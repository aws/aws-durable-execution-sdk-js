import { commonParams } from "../endpoint/EndpointParameters";
import { de_TagResource20170331Command, se_TagResource20170331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class TagResource20170331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "TagResource20170331", {})
    .n("LambdaClient", "TagResource20170331Command")
    .f(void 0, void 0)
    .ser(se_TagResource20170331Command)
    .de(de_TagResource20170331Command)
    .build() {
}
