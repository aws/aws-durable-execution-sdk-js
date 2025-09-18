import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { SafeDeleteProvisionedConcurrencyConfigRequest } from "../models/models_1";
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
 * The input for {@link SafeDeleteProvisionedConcurrencyConfigCommand}.
 */
export interface SafeDeleteProvisionedConcurrencyConfigCommandInput extends SafeDeleteProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link SafeDeleteProvisionedConcurrencyConfigCommand}.
 */
export interface SafeDeleteProvisionedConcurrencyConfigCommandOutput extends __MetadataBearer {
}
declare const SafeDeleteProvisionedConcurrencyConfigCommand_base: {
    new (input: SafeDeleteProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<SafeDeleteProvisionedConcurrencyConfigCommandInput, SafeDeleteProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: SafeDeleteProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<SafeDeleteProvisionedConcurrencyConfigCommandInput, SafeDeleteProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, SafeDeleteProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, SafeDeleteProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // SafeDeleteProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   LastModified: "STRING_VALUE", // required
 * };
 * const command = new SafeDeleteProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param SafeDeleteProvisionedConcurrencyConfigCommandInput - {@link SafeDeleteProvisionedConcurrencyConfigCommandInput}
 * @returns {@link SafeDeleteProvisionedConcurrencyConfigCommandOutput}
 * @see {@link SafeDeleteProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link SafeDeleteProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class SafeDeleteProvisionedConcurrencyConfigCommand extends SafeDeleteProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: SafeDeleteProvisionedConcurrencyConfigRequest;
            output: {};
        };
        sdk: {
            input: SafeDeleteProvisionedConcurrencyConfigCommandInput;
            output: SafeDeleteProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
