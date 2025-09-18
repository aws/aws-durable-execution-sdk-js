import { commonParams } from "../endpoint/EndpointParameters";
import { de_AddPermission20150331Command, se_AddPermission20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class AddPermission20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "AddPermission20150331", {})
    .n("LambdaClient", "AddPermission20150331Command")
    .f(void 0, void 0)
    .ser(se_AddPermission20150331Command)
    .de(de_AddPermission20150331Command)
    .build() {
}
