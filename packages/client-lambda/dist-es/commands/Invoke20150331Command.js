import { commonParams } from "../endpoint/EndpointParameters";
import { InvocationRequestFilterSensitiveLog, InvocationResponseFilterSensitiveLog, } from "../models/models_1";
import { de_Invoke20150331Command, se_Invoke20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class Invoke20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "Invoke20150331", {})
    .n("LambdaClient", "Invoke20150331Command")
    .f(InvocationRequestFilterSensitiveLog, InvocationResponseFilterSensitiveLog)
    .ser(se_Invoke20150331Command)
    .de(de_Invoke20150331Command)
    .build() {
}
