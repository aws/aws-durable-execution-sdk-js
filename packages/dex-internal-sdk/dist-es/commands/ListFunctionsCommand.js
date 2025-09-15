import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListFunctionsCommand, se_ListFunctionsCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListFunctionsCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListFunctions", {})
    .n("LambdaClient", "ListFunctionsCommand")
    .f(void 0, void 0)
    .ser(se_ListFunctionsCommand)
    .de(de_ListFunctionsCommand)
    .build() {
}
