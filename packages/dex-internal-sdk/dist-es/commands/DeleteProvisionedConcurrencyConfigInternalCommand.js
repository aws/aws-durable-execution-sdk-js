import { commonParams } from "../endpoint/EndpointParameters";
import { de_DeleteProvisionedConcurrencyConfigInternalCommand, se_DeleteProvisionedConcurrencyConfigInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class DeleteProvisionedConcurrencyConfigInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "DeleteProvisionedConcurrencyConfigInternal", {})
    .n("LambdaClient", "DeleteProvisionedConcurrencyConfigInternalCommand")
    .f(void 0, void 0)
    .ser(se_DeleteProvisionedConcurrencyConfigInternalCommand)
    .de(de_DeleteProvisionedConcurrencyConfigInternalCommand)
    .build() {
}
