import { commonParams } from "../endpoint/EndpointParameters";
import { PublishLayerVersionRequest20181031FilterSensitiveLog, } from "../models/models_1";
import { de_PublishLayerVersion20181031Command, se_PublishLayerVersion20181031Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class PublishLayerVersion20181031Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PublishLayerVersion20181031", {})
    .n("LambdaClient", "PublishLayerVersion20181031Command")
    .f(PublishLayerVersionRequest20181031FilterSensitiveLog, void 0)
    .ser(se_PublishLayerVersion20181031Command)
    .de(de_PublishLayerVersion20181031Command)
    .build() {
}
