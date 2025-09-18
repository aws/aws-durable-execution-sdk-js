import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateProvisionedConcurrencyConfigRequest, UpdateProvisionedConcurrencyConfigResponse } from "../models/models_1";
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
 * The input for {@link UpdateProvisionedConcurrencyConfigCommand}.
 */
export interface UpdateProvisionedConcurrencyConfigCommandInput extends UpdateProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateProvisionedConcurrencyConfigCommand}.
 */
export interface UpdateProvisionedConcurrencyConfigCommandOutput extends UpdateProvisionedConcurrencyConfigResponse, __MetadataBearer {
}
declare const UpdateProvisionedConcurrencyConfigCommand_base: {
    new (input: UpdateProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateProvisionedConcurrencyConfigCommandInput, UpdateProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateProvisionedConcurrencyConfigCommandInput, UpdateProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Status: "IN_PROGRESS" || "READY" || "FAILED", // required
 *   StatusReason: "STRING_VALUE",
 *   LastModified: "STRING_VALUE",
 *   ProvisionedConcurrentExecutions: Number("int"),
 *   ProvisionedConcurrencyStatusReasonCode: "RESOURCE_NON_INVOCABLE" || "RELEASE_AND_CREATE_CONFIG",
 * };
 * const command = new UpdateProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // { // UpdateProvisionedConcurrencyConfigResponse
 * //   Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //   StatusReason: "STRING_VALUE",
 * //   LastModified: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param UpdateProvisionedConcurrencyConfigCommandInput - {@link UpdateProvisionedConcurrencyConfigCommandInput}
 * @returns {@link UpdateProvisionedConcurrencyConfigCommandOutput}
 * @see {@link UpdateProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link UpdateProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class UpdateProvisionedConcurrencyConfigCommand extends UpdateProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateProvisionedConcurrencyConfigRequest;
            output: UpdateProvisionedConcurrencyConfigResponse;
        };
        sdk: {
            input: UpdateProvisionedConcurrencyConfigCommandInput;
            output: UpdateProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
