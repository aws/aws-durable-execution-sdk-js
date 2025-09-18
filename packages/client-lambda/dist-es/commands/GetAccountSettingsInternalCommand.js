import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetAccountSettingsInternalCommand, se_GetAccountSettingsInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetAccountSettingsInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetAccountSettingsInternal", {})
    .n("LambdaClient", "GetAccountSettingsInternalCommand")
    .f(void 0, void 0)
    .ser(se_GetAccountSettingsInternalCommand)
    .de(de_GetAccountSettingsInternalCommand)
    .build() {
}
