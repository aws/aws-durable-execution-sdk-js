import { commonParams } from "../endpoint/EndpointParameters";
import { de_DisableReplication20170630Command, se_DisableReplication20170630Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class DisableReplication20170630Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "DisableReplication20170630", {})
    .n("LambdaClient", "DisableReplication20170630Command")
    .f(void 0, void 0)
    .ser(se_DisableReplication20170630Command)
    .de(de_DisableReplication20170630Command)
    .build() {
}
