import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionCodeSigningConfigRequest } from "../models/models_0";
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
 * The input for {@link DeleteFunctionCodeSigningConfigCommand}.
 */
export interface DeleteFunctionCodeSigningConfigCommandInput extends DeleteFunctionCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionCodeSigningConfigCommand}.
 */
export interface DeleteFunctionCodeSigningConfigCommandOutput extends __MetadataBearer {
}
declare const DeleteFunctionCodeSigningConfigCommand_base: {
    new (input: DeleteFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionCodeSigningConfigCommandInput, DeleteFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionCodeSigningConfigCommandInput, DeleteFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionCodeSigningConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new DeleteFunctionCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteFunctionCodeSigningConfigCommandInput - {@link DeleteFunctionCodeSigningConfigCommandInput}
 * @returns {@link DeleteFunctionCodeSigningConfigCommandOutput}
 * @see {@link DeleteFunctionCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionCodeSigningConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CodeSigningConfigNotFoundException} (client fault)
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class DeleteFunctionCodeSigningConfigCommand extends DeleteFunctionCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionCodeSigningConfigRequest;
            output: {};
        };
        sdk: {
            input: DeleteFunctionCodeSigningConfigCommandInput;
            output: DeleteFunctionCodeSigningConfigCommandOutput;
        };
    };
}
