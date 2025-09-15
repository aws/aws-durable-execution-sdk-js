import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetLayerVersionByArn20181031Command, se_GetLayerVersionByArn20181031Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetLayerVersionByArn20181031Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetLayerVersionByArn20181031", {})
    .n("LambdaClient", "GetLayerVersionByArn20181031Command")
    .f(void 0, void 0)
    .ser(se_GetLayerVersionByArn20181031Command)
    .de(de_GetLayerVersionByArn20181031Command)
    .build() {
}
