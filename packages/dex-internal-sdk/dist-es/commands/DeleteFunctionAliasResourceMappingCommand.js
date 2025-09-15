import { commonParams } from "../endpoint/EndpointParameters";
import { de_DeleteFunctionAliasResourceMappingCommand, se_DeleteFunctionAliasResourceMappingCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class DeleteFunctionAliasResourceMappingCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "DeleteFunctionAliasResourceMapping", {})
    .n("LambdaClient", "DeleteFunctionAliasResourceMappingCommand")
    .f(void 0, void 0)
    .ser(se_DeleteFunctionAliasResourceMappingCommand)
    .de(de_DeleteFunctionAliasResourceMappingCommand)
    .build() {
}
