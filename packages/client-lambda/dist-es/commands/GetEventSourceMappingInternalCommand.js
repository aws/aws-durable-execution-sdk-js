import { commonParams } from "../endpoint/EndpointParameters";
import { de_GetEventSourceMappingInternalCommand, se_GetEventSourceMappingInternalCommand, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class GetEventSourceMappingInternalCommand extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetEventSourceMappingInternal", {})
    .n("LambdaClient", "GetEventSourceMappingInternalCommand")
    .f(void 0, void 0)
    .ser(se_GetEventSourceMappingInternalCommand)
    .de(de_GetEventSourceMappingInternalCommand)
    .build() {
}
