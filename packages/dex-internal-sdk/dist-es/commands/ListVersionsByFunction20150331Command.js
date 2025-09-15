import { commonParams } from "../endpoint/EndpointParameters";
import { ListVersionsByFunctionResponse20150331FilterSensitiveLog, } from "../models/models_1";
import { de_ListVersionsByFunction20150331Command, se_ListVersionsByFunction20150331Command, } from "../protocols/Aws_restJson1";
import { getEndpointPlugin } from "@smithy/middleware-endpoint";
import { getSerdePlugin } from "@smithy/middleware-serde";
import { Command as $Command } from "@smithy/smithy-client";
export { $Command };
export class ListVersionsByFunction20150331Command extends $Command.classBuilder()
    .ep(commonParams)
    .m(function (Command, cs, config, o) {
    return [
        getSerdePlugin(config, this.serialize, this.deserialize),
        getEndpointPlugin(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "ListVersionsByFunction20150331", {})
    .n("LambdaClient", "ListVersionsByFunction20150331Command")
    .f(void 0, ListVersionsByFunctionResponse20150331FilterSensitiveLog)
    .ser(se_ListVersionsByFunction20150331Command)
    .de(de_ListVersionsByFunction20150331Command)
    .build() {
}
