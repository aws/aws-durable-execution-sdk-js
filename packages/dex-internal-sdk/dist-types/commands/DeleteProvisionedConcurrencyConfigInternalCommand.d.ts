import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteProvisionedConcurrencyConfigInternalRequest } from "../models/models_0";
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
 * The input for {@link DeleteProvisionedConcurrencyConfigInternalCommand}.
 */
export interface DeleteProvisionedConcurrencyConfigInternalCommandInput extends DeleteProvisionedConcurrencyConfigInternalRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteProvisionedConcurrencyConfigInternalCommand}.
 */
export interface DeleteProvisionedConcurrencyConfigInternalCommandOutput extends __MetadataBearer {
}
declare const DeleteProvisionedConcurrencyConfigInternalCommand_base: {
    new (input: DeleteProvisionedConcurrencyConfigInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteProvisionedConcurrencyConfigInternalCommandInput, DeleteProvisionedConcurrencyConfigInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteProvisionedConcurrencyConfigInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteProvisionedConcurrencyConfigInternalCommandInput, DeleteProvisionedConcurrencyConfigInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteProvisionedConcurrencyConfigInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteProvisionedConcurrencyConfigInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteProvisionedConcurrencyConfigInternalRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 * };
 * const command = new DeleteProvisionedConcurrencyConfigInternalCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteProvisionedConcurrencyConfigInternalCommandInput - {@link DeleteProvisionedConcurrencyConfigInternalCommandInput}
 * @returns {@link DeleteProvisionedConcurrencyConfigInternalCommandOutput}
 * @see {@link DeleteProvisionedConcurrencyConfigInternalCommandInput} for command's `input` shape.
 * @see {@link DeleteProvisionedConcurrencyConfigInternalCommandOutput} for command's `response` shape.
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
export declare class DeleteProvisionedConcurrencyConfigInternalCommand extends DeleteProvisionedConcurrencyConfigInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteProvisionedConcurrencyConfigInternalRequest;
            output: {};
        };
        sdk: {
            input: DeleteProvisionedConcurrencyConfigInternalCommandInput;
            output: DeleteProvisionedConcurrencyConfigInternalCommandOutput;
        };
    };
}
