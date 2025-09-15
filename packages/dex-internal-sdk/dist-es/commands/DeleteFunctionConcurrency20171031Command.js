import { commonParams } from "../endpoint/EndpointParameters";
import { de_DeleteFunctionConcurrency20171031Command, se_DeleteFunctionConcurrency20171031Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class DeleteFunctionConcurrency20171031Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "DeleteFunctionConcurrency20171031", {})
    .n("LambdaClient", "DeleteFunctionConcurrency20171031Command")
    .f(void 0, void 0)
    .ser(se_DeleteFunctionConcurrency20171031Command)
    .de(de_DeleteFunctionConcurrency20171031Command)
    .build() {
}
