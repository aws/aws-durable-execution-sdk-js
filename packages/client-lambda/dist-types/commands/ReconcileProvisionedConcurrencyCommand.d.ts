import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ReconcileProvisionedConcurrencyRequest } from "../models/models_1";
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
 * The input for {@link ReconcileProvisionedConcurrencyCommand}.
 */
export interface ReconcileProvisionedConcurrencyCommandInput extends ReconcileProvisionedConcurrencyRequest {
}
/**
 * @public
 *
 * The output of {@link ReconcileProvisionedConcurrencyCommand}.
 */
export interface ReconcileProvisionedConcurrencyCommandOutput extends __MetadataBearer {
}
declare const ReconcileProvisionedConcurrencyCommand_base: {
    new (input: ReconcileProvisionedConcurrencyCommandInput): import("@smithy/smithy-client").CommandImpl<ReconcileProvisionedConcurrencyCommandInput, ReconcileProvisionedConcurrencyCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ReconcileProvisionedConcurrencyCommandInput): import("@smithy/smithy-client").CommandImpl<ReconcileProvisionedConcurrencyCommandInput, ReconcileProvisionedConcurrencyCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ReconcileProvisionedConcurrencyCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ReconcileProvisionedConcurrencyCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ReconcileProvisionedConcurrencyRequest
 *   FunctionName: "STRING_VALUE", // required
 *   ReconciliationAction: "REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS" || "MARK_PROVISIONED_CONCURRENCY_AS_FAILED" || "RELEASE_PROVISIONED_CONCURRENCY" || "RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION", // required
 *   ProvisionedConcurrencyFunctionVersion: { // ProvisionedConcurrencyFunctionVersionReconciliationItem
 *     ProvisionedConcurrentExecutions: Number("int"),
 *     RevisionId: Number("long"),
 *     LastModified: "STRING_VALUE",
 *     PreWarmingStatus: "STRING_VALUE",
 *   },
 *   ProvisionedConcurrencyConfig: { // ProvisionedConcurrencyConfigReconciliationItem
 *     ProvisionedConcurrencyConfigArn: "STRING_VALUE",
 *     LastModified: "STRING_VALUE",
 *     PreWarmingStatusReason: "STRING_VALUE",
 *   },
 * };
 * const command = new ReconcileProvisionedConcurrencyCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param ReconcileProvisionedConcurrencyCommandInput - {@link ReconcileProvisionedConcurrencyCommandInput}
 * @returns {@link ReconcileProvisionedConcurrencyCommandOutput}
 * @see {@link ReconcileProvisionedConcurrencyCommandInput} for command's `input` shape.
 * @see {@link ReconcileProvisionedConcurrencyCommandOutput} for command's `response` shape.
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
export declare class ReconcileProvisionedConcurrencyCommand extends ReconcileProvisionedConcurrencyCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ReconcileProvisionedConcurrencyRequest;
            output: {};
        };
        sdk: {
            input: ReconcileProvisionedConcurrencyCommandInput;
            output: ReconcileProvisionedConcurrencyCommandOutput;
        };
    };
}
