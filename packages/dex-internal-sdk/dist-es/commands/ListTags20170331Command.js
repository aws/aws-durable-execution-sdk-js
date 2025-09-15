import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListTags20170331Command, se_ListTags20170331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListTags20170331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListTags20170331", {})
    .n("LambdaClient", "ListTags20170331Command")
    .f(void 0, void 0)
    .ser(se_ListTags20170331Command)
    .de(de_ListTags20170331Command)
    .build() {
}
