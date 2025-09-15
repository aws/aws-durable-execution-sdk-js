import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DisableFunctionRequest } from "../models/models_0";
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
 * The input for {@link DisableFunctionCommand}.
 */
export interface DisableFunctionCommandInput extends DisableFunctionRequest {
}
/**
 * @public
 *
 * The output of {@link DisableFunctionCommand}.
 */
export interface DisableFunctionCommandOutput extends __MetadataBearer {
}
declare const DisableFunctionCommand_base: {
    new (input: DisableFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<DisableFunctionCommandInput, DisableFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DisableFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<DisableFunctionCommandInput, DisableFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DisableFunctionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DisableFunctionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DisableFunctionRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new DisableFunctionCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DisableFunctionCommandInput - {@link DisableFunctionCommandInput}
 * @returns {@link DisableFunctionCommandOutput}
 * @see {@link DisableFunctionCommandInput} for command's `input` shape.
 * @see {@link DisableFunctionCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class DisableFunctionCommand extends DisableFunctionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DisableFunctionRequest;
            output: {};
        };
        sdk: {
            input: DisableFunctionCommandInput;
            output: DisableFunctionCommandOutput;
        };
    };
}
