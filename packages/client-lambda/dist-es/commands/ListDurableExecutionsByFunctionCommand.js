import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListDurableExecutionsByFunctionCommand, se_ListDurableExecutionsByFunctionCommand, } from "../protocols/Aws_restJson1";
export { $Command };
export class ListDurableExecutionsByFunctionCommand extends $Command
    .classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListDurableExecutionsByFunction", {})
    .n("LambdaClient", "ListDurableExecutionsByFunctionCommand")
    .f(void 0, void 0)
    .ser(se_ListDurableExecutionsByFunctionCommand)
    .de(de_ListDurableExecutionsByFunctionCommand)
    .build() {
}
