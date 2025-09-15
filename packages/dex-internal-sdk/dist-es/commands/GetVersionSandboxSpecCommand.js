import { commonParams } from "../endpoint/EndpointParameters";
import { GetVersionSandboxSpecResponseFilterSensitiveLog, } from "../models/models_0";
import { de_GetVersionSandboxSpecCommand, se_GetVersionSandboxSpecCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetVersionSandboxSpecCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetVersionSandboxSpec", {})
    .n("LambdaClient", "GetVersionSandboxSpecCommand")
    .f(void 0, GetVersionSandboxSpecResponseFilterSensitiveLog)
    .ser(se_GetVersionSandboxSpecCommand)
    .de(de_GetVersionSandboxSpecCommand)
    .build() {
}
