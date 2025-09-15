"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateFunctionCode20150331v2Command = exports.$Command = void 0;
const EndpointParameters_1 = require("../endpoint/EndpointParameters");
const models_0_1 = require("../models/models_0");
const models_1_1 = require("../models/models_1");
const Aws_restJson1_1 = require("../protocols/Aws_restJson1");
const middleware_endpoint_1 = require("@smithy/middleware-endpoint");
const middleware_serde_1 = require("@smithy/middleware-serde");
const smithy_client_1 = require("@smithy/smithy-client");
Object.defineProperty(exports, "$Command", { enumerable: true, get: function () { return smithy_client_1.Command; } });
class UpdateFunctionCode20150331v2Command extends smithy_client_1.Command.classBuilder()
    .ep(EndpointParameters_1.commonParams)
    .m(function (Command, cs, config, o) {
    return [
        (0, middleware_serde_1.getSerdePlugin)(config, this.serialize, this.deserialize),
        (0, middleware_endpoint_1.getEndpointPlugin)(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "UpdateFunctionCode20150331v2", {})
    .n("LambdaClient", "UpdateFunctionCode20150331v2Command")
    .f(models_1_1.UpdateFunctionCodeRequest20150331FilterSensitiveLog, models_0_1.FunctionConfiguration20150331FilterSensitiveLog)
    .ser(Aws_restJson1_1.se_UpdateFunctionCode20150331v2Command)
    .de(Aws_restJson1_1.de_UpdateFunctionCode20150331v2Command)
    .build() {
}
exports.UpdateFunctionCode20150331v2Command = UpdateFunctionCode20150331v2Command;
