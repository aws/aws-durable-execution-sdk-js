"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetEventSourceMapping20150331Command = exports.$Command = void 0;
const EndpointParameters_1 = require("../endpoint/EndpointParameters");
const Aws_restJson1_1 = require("../protocols/Aws_restJson1");
const middleware_endpoint_1 = require("@smithy/middleware-endpoint");
const middleware_serde_1 = require("@smithy/middleware-serde");
const smithy_client_1 = require("@smithy/smithy-client");
Object.defineProperty(exports, "$Command", { enumerable: true, get: function () { return smithy_client_1.Command; } });
class GetEventSourceMapping20150331Command extends smithy_client_1.Command.classBuilder()
    .ep(EndpointParameters_1.commonParams)
    .m(function (Command, cs, config, o) {
    return [
        (0, middleware_serde_1.getSerdePlugin)(config, this.serialize, this.deserialize),
        (0, middleware_endpoint_1.getEndpointPlugin)(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "GetEventSourceMapping20150331", {})
    .n("LambdaClient", "GetEventSourceMapping20150331Command")
    .f(void 0, void 0)
    .ser(Aws_restJson1_1.se_GetEventSourceMapping20150331Command)
    .de(Aws_restJson1_1.de_GetEventSourceMapping20150331Command)
    .build() {
}
exports.GetEventSourceMapping20150331Command = GetEventSourceMapping20150331Command;
