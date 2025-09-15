import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DisablePublicAccessBlockConfigRequest, DisablePublicAccessBlockConfigResponse } from "../models/models_0";
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
 * The input for {@link DisablePublicAccessBlockConfigCommand}.
 */
export interface DisablePublicAccessBlockConfigCommandInput extends DisablePublicAccessBlockConfigRequest {
}
/**
 * @public
 *
 * The output of {@link DisablePublicAccessBlockConfigCommand}.
 */
export interface DisablePublicAccessBlockConfigCommandOutput extends DisablePublicAccessBlockConfigResponse, __MetadataBearer {
}
declare const DisablePublicAccessBlockConfigCommand_base: {
    new (input: DisablePublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DisablePublicAccessBlockConfigCommandInput, DisablePublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DisablePublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DisablePublicAccessBlockConfigCommandInput, DisablePublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DisablePublicAccessBlockConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DisablePublicAccessBlockConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DisablePublicAccessBlockConfigRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new DisablePublicAccessBlockConfigCommand(input);
 * const response = await client.send(command);
 * // { // DisablePublicAccessBlockConfigResponse
 * //   Disabled: true || false,
 * // };
 *
 * ```
 *
 * @param DisablePublicAccessBlockConfigCommandInput - {@link DisablePublicAccessBlockConfigCommandInput}
 * @returns {@link DisablePublicAccessBlockConfigCommandOutput}
 * @see {@link DisablePublicAccessBlockConfigCommandInput} for command's `input` shape.
 * @see {@link DisablePublicAccessBlockConfigCommandOutput} for command's `response` shape.
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
export declare class DisablePublicAccessBlockConfigCommand extends DisablePublicAccessBlockConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DisablePublicAccessBlockConfigRequest;
            output: DisablePublicAccessBlockConfigResponse;
        };
        sdk: {
            input: DisablePublicAccessBlockConfigCommandInput;
            output: DisablePublicAccessBlockConfigCommandOutput;
        };
    };
}
