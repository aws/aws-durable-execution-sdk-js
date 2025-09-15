import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { SendDurableExecutionCallbackHeartbeatRequest, SendDurableExecutionCallbackHeartbeatResponse } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link SendDurableExecutionCallbackHeartbeatCommand}.
 */
export interface SendDurableExecutionCallbackHeartbeatCommandInput extends SendDurableExecutionCallbackHeartbeatRequest {
}
/**
 * @public
 *
 * The output of {@link SendDurableExecutionCallbackHeartbeatCommand}.
 */
export interface SendDurableExecutionCallbackHeartbeatCommandOutput extends SendDurableExecutionCallbackHeartbeatResponse, __MetadataBearer {
}
declare const SendDurableExecutionCallbackHeartbeatCommand_base: {
    new (input: SendDurableExecutionCallbackHeartbeatCommandInput): import("@smithy/smithy-client").CommandImpl<SendDurableExecutionCallbackHeartbeatCommandInput, SendDurableExecutionCallbackHeartbeatCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: SendDurableExecutionCallbackHeartbeatCommandInput): import("@smithy/smithy-client").CommandImpl<SendDurableExecutionCallbackHeartbeatCommandInput, SendDurableExecutionCallbackHeartbeatCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, SendDurableExecutionCallbackHeartbeatCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, SendDurableExecutionCallbackHeartbeatCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // SendDurableExecutionCallbackHeartbeatRequest
 *   CallbackId: "STRING_VALUE", // required
 * };
 * const command = new SendDurableExecutionCallbackHeartbeatCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param SendDurableExecutionCallbackHeartbeatCommandInput - {@link SendDurableExecutionCallbackHeartbeatCommandInput}
 * @returns {@link SendDurableExecutionCallbackHeartbeatCommandOutput}
 * @see {@link SendDurableExecutionCallbackHeartbeatCommandInput} for command's `input` shape.
 * @see {@link SendDurableExecutionCallbackHeartbeatCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link CallbackTimeoutException} (client fault)
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class SendDurableExecutionCallbackHeartbeatCommand extends SendDurableExecutionCallbackHeartbeatCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: SendDurableExecutionCallbackHeartbeatRequest;
            output: {};
        };
        sdk: {
            input: SendDurableExecutionCallbackHeartbeatCommandInput;
            output: SendDurableExecutionCallbackHeartbeatCommandOutput;
        };
    };
}
