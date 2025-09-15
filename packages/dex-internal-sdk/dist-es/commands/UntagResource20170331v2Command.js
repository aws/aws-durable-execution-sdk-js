import { commonParams } from "../endpoint/EndpointParameters";
import { de_UntagResource20170331v2Command, se_UntagResource20170331v2Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UntagResource20170331v2Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UntagResource20170331v2", {})
    .n("LambdaClient", "UntagResource20170331v2Command")
    .f(void 0, void 0)
    .ser(se_UntagResource20170331v2Command)
    .de(de_UntagResource20170331v2Command)
    .build() {
}
