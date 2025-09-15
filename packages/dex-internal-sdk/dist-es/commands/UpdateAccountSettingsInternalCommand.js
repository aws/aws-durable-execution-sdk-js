import { commonParams } from "../endpoint/EndpointParameters";
import { de_UpdateAccountSettingsInternalCommand, se_UpdateAccountSettingsInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UpdateAccountSettingsInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UpdateAccountSettingsInternal", {})
    .n("LambdaClient", "UpdateAccountSettingsInternalCommand")
    .f(void 0, void 0)
    .ser(se_UpdateAccountSettingsInternalCommand)
    .de(de_UpdateAccountSettingsInternalCommand)
    .build() {
}
