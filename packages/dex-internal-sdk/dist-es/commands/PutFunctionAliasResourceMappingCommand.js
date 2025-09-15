import { commonParams } from "../endpoint/EndpointParameters";
import { de_PutFunctionAliasResourceMappingCommand, se_PutFunctionAliasResourceMappingCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class PutFunctionAliasResourceMappingCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PutFunctionAliasResourceMapping", {})
    .n("LambdaClient", "PutFunctionAliasResourceMappingCommand")
    .f(void 0, void 0)
    .ser(se_PutFunctionAliasResourceMappingCommand)
    .de(de_PutFunctionAliasResourceMappingCommand)
    .build() {
}
