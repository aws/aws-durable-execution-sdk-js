import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetAccountSettings20160819Command, se_GetAccountSettings20160819Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetAccountSettings20160819Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetAccountSettings20160819", {})
    .n("LambdaClient", "GetAccountSettings20160819Command")
    .f(void 0, void 0)
    .ser(se_GetAccountSettings20160819Command)
    .de(de_GetAccountSettings20160819Command)
    .build() {
}
