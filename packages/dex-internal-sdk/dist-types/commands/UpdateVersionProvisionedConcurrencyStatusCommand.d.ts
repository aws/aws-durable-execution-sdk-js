import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateVersionProvisionedConcurrencyStatusRequest, UpdateVersionProvisionedConcurrencyStatusResponse } from "../models/models_1";
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
 * The input for {@link UpdateVersionProvisionedConcurrencyStatusCommand}.
 */
export interface UpdateVersionProvisionedConcurrencyStatusCommandInput extends UpdateVersionProvisionedConcurrencyStatusRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateVersionProvisionedConcurrencyStatusCommand}.
 */
export interface UpdateVersionProvisionedConcurrencyStatusCommandOutput extends UpdateVersionProvisionedConcurrencyStatusResponse, __MetadataBearer {
}
declare const UpdateVersionProvisionedConcurrencyStatusCommand_base: {
    new (input: UpdateVersionProvisionedConcurrencyStatusCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateVersionProvisionedConcurrencyStatusCommandInput, UpdateVersionProvisionedConcurrencyStatusCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateVersionProvisionedConcurrencyStatusCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateVersionProvisionedConcurrencyStatusCommandInput, UpdateVersionProvisionedConcurrencyStatusCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateVersionProvisionedConcurrencyStatusCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateVersionProvisionedConcurrencyStatusCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateVersionProvisionedConcurrencyStatusRequest
 *   FunctionName: "STRING_VALUE", // required
 *   DesiredConcurrentExecutions: Number("int"), // required
 *   ProvisionedConcurrentExecutions: Number("int"), // required
 *   Status: "IN_PROGRESS" || "READY" || "FAILED",
 *   RevisionId: "STRING_VALUE", // required
 *   VersionStatus: "DELETING" || "NONE",
 * };
 * const command = new UpdateVersionProvisionedConcurrencyStatusCommand(input);
 * const response = await client.send(command);
 * // { // UpdateVersionProvisionedConcurrencyStatusResponse
 * //   AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //   Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //   RevisionId: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param UpdateVersionProvisionedConcurrencyStatusCommandInput - {@link UpdateVersionProvisionedConcurrencyStatusCommandInput}
 * @returns {@link UpdateVersionProvisionedConcurrencyStatusCommandOutput}
 * @see {@link UpdateVersionProvisionedConcurrencyStatusCommandInput} for command's `input` shape.
 * @see {@link UpdateVersionProvisionedConcurrencyStatusCommandOutput} for command's `response` shape.
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
export declare class UpdateVersionProvisionedConcurrencyStatusCommand extends UpdateVersionProvisionedConcurrencyStatusCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateVersionProvisionedConcurrencyStatusRequest;
            output: UpdateVersionProvisionedConcurrencyStatusResponse;
        };
        sdk: {
            input: UpdateVersionProvisionedConcurrencyStatusCommandInput;
            output: UpdateVersionProvisionedConcurrencyStatusCommandOutput;
        };
    };
}
