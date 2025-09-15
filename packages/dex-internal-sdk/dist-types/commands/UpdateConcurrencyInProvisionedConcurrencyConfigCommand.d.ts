import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateConcurrencyInProvisionedConcurrencyConfigRequest } from "../models/models_1";
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
 * The input for {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommand}.
 */
export interface UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput extends UpdateConcurrencyInProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommand}.
 */
export interface UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput extends __MetadataBearer {
}
declare const UpdateConcurrencyInProvisionedConcurrencyConfigCommand_base: {
    new (input: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateConcurrencyInProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateConcurrencyInProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateConcurrencyInProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   ConcurrentExecutions: Number("int"), // required
 * };
 * const command = new UpdateConcurrencyInProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput - {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput}
 * @returns {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput}
 * @see {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class UpdateConcurrencyInProvisionedConcurrencyConfigCommand extends UpdateConcurrencyInProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateConcurrencyInProvisionedConcurrencyConfigRequest;
            output: {};
        };
        sdk: {
            input: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput;
            output: UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
