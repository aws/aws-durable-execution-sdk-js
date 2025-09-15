import { commonParams } from "../endpoint/EndpointParameters";
import { ExportFunctionVersionResponseFilterSensitiveLog, } from "../models/models_0";
import { de_ExportFunctionVersionCommand, se_ExportFunctionVersionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ExportFunctionVersionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ExportFunctionVersion", {})
    .n("LambdaClient", "ExportFunctionVersionCommand")
    .f(void 0, ExportFunctionVersionResponseFilterSensitiveLog)
    .ser(se_ExportFunctionVersionCommand)
    .de(de_ExportFunctionVersionCommand)
    .build() {
}
