import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetPolicy20150331v2Command, se_GetPolicy20150331v2Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetPolicy20150331v2Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetPolicy20150331v2", {})
    .n("LambdaClient", "GetPolicy20150331v2Command")
    .f(void 0, void 0)
    .ser(se_GetPolicy20150331v2Command)
    .de(de_GetPolicy20150331v2Command)
    .build() {
}
