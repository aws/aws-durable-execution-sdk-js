import { commonParams } from "../endpoint/EndpointParameters";
import { ImportFunctionVersionRequestFilterSensitiveLog, ImportFunctionVersionResponseFilterSensitiveLog, } from "../models/models_1";
import { de_ImportFunctionVersionCommand, se_ImportFunctionVersionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ImportFunctionVersionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ImportFunctionVersion", {})
    .n("LambdaClient", "ImportFunctionVersionCommand")
    .f(ImportFunctionVersionRequestFilterSensitiveLog, ImportFunctionVersionResponseFilterSensitiveLog)
    .ser(se_ImportFunctionVersionCommand)
    .de(de_ImportFunctionVersionCommand)
    .build() {
}
