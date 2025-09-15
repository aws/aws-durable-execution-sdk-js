import { commonParams } from "../endpoint/EndpointParameters";
import { UploadFunctionRequestFilterSensitiveLog, } from "../models/models_1";
import { de_UploadFunctionCommand, se_UploadFunctionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class UploadFunctionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UploadFunction", {})
    .n("LambdaClient", "UploadFunctionCommand")
    .f(UploadFunctionRequestFilterSensitiveLog, void 0)
    .ser(se_UploadFunctionCommand)
    .de(de_UploadFunctionCommand)
    .build() {
}
