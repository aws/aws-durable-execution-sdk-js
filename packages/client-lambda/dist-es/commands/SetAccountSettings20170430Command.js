import { commonParams } from "../endpoint/EndpointParameters";
import { de_SetAccountSettings20170430Command, se_SetAccountSettings20170430Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class SetAccountSettings20170430Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "SetAccountSettings20170430", {})
    .n("LambdaClient", "SetAccountSettings20170430Command")
    .f(void 0, void 0)
    .ser(se_SetAccountSettings20170430Command)
    .de(de_SetAccountSettings20170430Command)
    .build() {
}
