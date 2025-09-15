import { commonParams } from "../endpoint/EndpointParameters";
import { FunctionConfiguration20150331FilterSensitiveLog, } from "../models/models_0";
import { de_PublishVersion20150331Command, se_PublishVersion20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class PublishVersion20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PublishVersion20150331", {})
    .n("LambdaClient", "PublishVersion20150331Command")
    .f(void 0, FunctionConfiguration20150331FilterSensitiveLog)
    .ser(se_PublishVersion20150331Command)
    .de(de_PublishVersion20150331Command)
    .build() {
}
