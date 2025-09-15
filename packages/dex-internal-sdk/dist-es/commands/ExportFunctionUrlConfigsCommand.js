import { commonParams } from "../endpoint/EndpointParameters";
import { de_ExportFunctionUrlConfigsCommand, se_ExportFunctionUrlConfigsCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ExportFunctionUrlConfigsCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ExportFunctionUrlConfigs", {})
    .n("LambdaClient", "ExportFunctionUrlConfigsCommand")
    .f(void 0, void 0)
    .ser(se_ExportFunctionUrlConfigsCommand)
    .de(de_ExportFunctionUrlConfigsCommand)
    .build() {
}
