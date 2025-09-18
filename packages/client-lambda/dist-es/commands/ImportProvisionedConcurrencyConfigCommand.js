import { commonParams } from "../endpoint/EndpointParameters";
import { de_ImportProvisionedConcurrencyConfigCommand, se_ImportProvisionedConcurrencyConfigCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ImportProvisionedConcurrencyConfigCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ImportProvisionedConcurrencyConfig", {})
    .n("LambdaClient", "ImportProvisionedConcurrencyConfigCommand")
    .f(void 0, void 0)
    .ser(se_ImportProvisionedConcurrencyConfigCommand)
    .de(de_ImportProvisionedConcurrencyConfigCommand)
    .build() {
}
