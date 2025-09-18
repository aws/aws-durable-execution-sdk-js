import { commonParams } from "../endpoint/EndpointParameters";
import { de_ListLayerVersionsInternalCommand, se_ListLayerVersionsInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListLayerVersionsInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListLayerVersionsInternal", {})
    .n("LambdaClient", "ListLayerVersionsInternalCommand")
    .f(void 0, void 0)
    .ser(se_ListLayerVersionsInternalCommand)
    .de(de_ListLayerVersionsInternalCommand)
    .build() {
}
