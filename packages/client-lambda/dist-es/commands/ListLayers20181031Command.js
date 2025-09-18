import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListLayers20181031Command, se_ListLayers20181031Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListLayers20181031Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListLayers20181031", {})
    .n("LambdaClient", "ListLayers20181031Command")
    .f(void 0, void 0)
    .ser(se_ListLayers20181031Command)
    .de(de_ListLayers20181031Command)
    .build() {
}
