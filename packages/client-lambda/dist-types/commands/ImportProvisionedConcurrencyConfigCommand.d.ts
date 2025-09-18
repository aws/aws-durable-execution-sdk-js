import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportProvisionedConcurrencyConfigRequest, ImportProvisionedConcurrencyConfigResponse } from "../models/models_1";
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
 * The input for {@link ImportProvisionedConcurrencyConfigCommand}.
 */
export interface ImportProvisionedConcurrencyConfigCommandInput extends ImportProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link ImportProvisionedConcurrencyConfigCommand}.
 */
export interface ImportProvisionedConcurrencyConfigCommandOutput extends ImportProvisionedConcurrencyConfigResponse, __MetadataBearer {
}
declare const ImportProvisionedConcurrencyConfigCommand_base: {
    new (input: ImportProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ImportProvisionedConcurrencyConfigCommandInput, ImportProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ImportProvisionedConcurrencyConfigCommandInput, ImportProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   MigrationProvisionedConcurrencyConfig: { // MigrationProvisionedConcurrencyConfig
 *     FunctionArn: "STRING_VALUE",
 *     RequestedProvisionedConcurrentExecutions: Number("int"),
 *     AvailableProvisionedConcurrentExecutions: Number("int"),
 *     AllocatedProvisionedConcurrentExecutions: Number("int"),
 *     Status: "IN_PROGRESS" || "READY" || "FAILED",
 *     StatusReason: "STRING_VALUE",
 *     LastModified: "STRING_VALUE",
 *     HashOfConsistentFields: "STRING_VALUE",
 *   },
 * };
 * const command = new ImportProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // { // ImportProvisionedConcurrencyConfigResponse
 * //   MigrationProvisionedConcurrencyConfig: { // MigrationProvisionedConcurrencyConfig
 * //     FunctionArn: "STRING_VALUE",
 * //     RequestedProvisionedConcurrentExecutions: Number("int"),
 * //     AvailableProvisionedConcurrentExecutions: Number("int"),
 * //     AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //     Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //     StatusReason: "STRING_VALUE",
 * //     LastModified: "STRING_VALUE",
 * //     HashOfConsistentFields: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param ImportProvisionedConcurrencyConfigCommandInput - {@link ImportProvisionedConcurrencyConfigCommandInput}
 * @returns {@link ImportProvisionedConcurrencyConfigCommandOutput}
 * @see {@link ImportProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link ImportProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class ImportProvisionedConcurrencyConfigCommand extends ImportProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportProvisionedConcurrencyConfigRequest;
            output: ImportProvisionedConcurrencyConfigResponse;
        };
        sdk: {
            input: ImportProvisionedConcurrencyConfigCommandInput;
            output: ImportProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
