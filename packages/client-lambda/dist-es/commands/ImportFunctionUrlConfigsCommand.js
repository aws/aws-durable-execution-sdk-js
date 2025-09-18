import { commonParams } from "../endpoint/EndpointParameters";
import { de_ImportFunctionUrlConfigsCommand, se_ImportFunctionUrlConfigsCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ImportFunctionUrlConfigsCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ImportFunctionUrlConfigs", {})
    .n("LambdaClient", "ImportFunctionUrlConfigsCommand")
    .f(void 0, void 0)
    .ser(se_ImportFunctionUrlConfigsCommand)
    .de(de_ImportFunctionUrlConfigsCommand)
    .build() {
}
