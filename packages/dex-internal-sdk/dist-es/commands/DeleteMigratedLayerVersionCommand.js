import { commonParams } from "../endpoint/EndpointParameters";
import { de_DeleteMigratedLayerVersionCommand, se_DeleteMigratedLayerVersionCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class DeleteMigratedLayerVersionCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "DeleteMigratedLayerVersion", {})
    .n("LambdaClient", "DeleteMigratedLayerVersionCommand")
    .f(void 0, void 0)
    .ser(se_DeleteMigratedLayerVersionCommand)
    .de(de_DeleteMigratedLayerVersionCommand)
    .build() {
}
