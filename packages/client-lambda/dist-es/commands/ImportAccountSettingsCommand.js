import { commonParams } from "../endpoint/EndpointParameters";
import { de_ImportAccountSettingsCommand, se_ImportAccountSettingsCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ImportAccountSettingsCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ImportAccountSettings", {})
    .n("LambdaClient", "ImportAccountSettingsCommand")
    .f(void 0, void 0)
    .ser(se_ImportAccountSettingsCommand)
    .de(de_ImportAccountSettingsCommand)
    .build() {
}
