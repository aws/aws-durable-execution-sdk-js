import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteProvisionedConcurrencyConfigRequest } from "../models/models_0";
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
 * The input for {@link DeleteProvisionedConcurrencyConfigCommand}.
 */
export interface DeleteProvisionedConcurrencyConfigCommandInput extends DeleteProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteProvisionedConcurrencyConfigCommand}.
 */
export interface DeleteProvisionedConcurrencyConfigCommandOutput extends __MetadataBearer {
}
declare const DeleteProvisionedConcurrencyConfigCommand_base: {
    new (input: DeleteProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteProvisionedConcurrencyConfigCommandInput, DeleteProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteProvisionedConcurrencyConfigCommandInput, DeleteProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 * };
 * const command = new DeleteProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteProvisionedConcurrencyConfigCommandInput - {@link DeleteProvisionedConcurrencyConfigCommandInput}
 * @returns {@link DeleteProvisionedConcurrencyConfigCommandOutput}
 * @see {@link DeleteProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link DeleteProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class DeleteProvisionedConcurrencyConfigCommand extends DeleteProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteProvisionedConcurrencyConfigRequest;
            output: {};
        };
        sdk: {
            input: DeleteProvisionedConcurrencyConfigCommandInput;
            output: DeleteProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
