import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListAliases20150331Command, se_ListAliases20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListAliases20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListAliases20150331", {})
    .n("LambdaClient", "ListAliases20150331Command")
    .f(void 0, void 0)
    .ser(se_ListAliases20150331Command)
    .de(de_ListAliases20150331Command)
    .build() {
}
