"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PutPublicAccessBlockConfigCommand = exports.$Command = void 0;
const EndpointParameters_1 = require("../endpoint/EndpointParameters");
const Aws_restJson1_1 = require("../protocols/Aws_restJson1");
const middleware_endpoint_1 = require("@smithy/middleware-endpoint");
const middleware_serde_1 = require("@smithy/middleware-serde");
const smithy_client_1 = require("@smithy/smithy-client");
Object.defineProperty(exports, "$Command", { enumerable: true, get: function () { return smithy_client_1.Command; } });
class PutPublicAccessBlockConfigCommand extends smithy_client_1.Command.classBuilder()
    .ep(EndpointParameters_1.commonParams)
    .m(function (Command, cs, config, o) {
    return [
        (0, middleware_serde_1.getSerdePlugin)(config, this.serialize, this.deserialize),
        (0, middleware_endpoint_1.getEndpointPlugin)(config, Command.getEndpointParameterInstructions()),
    ];
})
    .s("AWSGirApiService", "PutPublicAccessBlockConfig", {})
    .n("LambdaClient", "PutPublicAccessBlockConfigCommand")
    .f(void 0, void 0)
    .ser(Aws_restJson1_1.se_PutPublicAccessBlockConfigCommand)
    .de(Aws_restJson1_1.de_PutPublicAccessBlockConfigCommand)
    .build() {
}
exports.PutPublicAccessBlockConfigCommand = PutPublicAccessBlockConfigCommand;
