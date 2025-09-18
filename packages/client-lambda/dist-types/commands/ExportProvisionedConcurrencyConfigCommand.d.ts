import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ExportProvisionedConcurrencyConfigRequest, ExportProvisionedConcurrencyConfigResponse } from "../models/models_0";
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
 * The input for {@link ExportProvisionedConcurrencyConfigCommand}.
 */
export interface ExportProvisionedConcurrencyConfigCommandInput extends ExportProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link ExportProvisionedConcurrencyConfigCommand}.
 */
export interface ExportProvisionedConcurrencyConfigCommandOutput extends ExportProvisionedConcurrencyConfigResponse, __MetadataBearer {
}
declare const ExportProvisionedConcurrencyConfigCommand_base: {
    new (input: ExportProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ExportProvisionedConcurrencyConfigCommandInput, ExportProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ExportProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ExportProvisionedConcurrencyConfigCommandInput, ExportProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ExportProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ExportProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ExportProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 * };
 * const command = new ExportProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // { // ExportProvisionedConcurrencyConfigResponse
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
 * @param ExportProvisionedConcurrencyConfigCommandInput - {@link ExportProvisionedConcurrencyConfigCommandInput}
 * @returns {@link ExportProvisionedConcurrencyConfigCommandOutput}
 * @see {@link ExportProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link ExportProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class ExportProvisionedConcurrencyConfigCommand extends ExportProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ExportProvisionedConcurrencyConfigRequest;
            output: ExportProvisionedConcurrencyConfigResponse;
        };
        sdk: {
            input: ExportProvisionedConcurrencyConfigCommandInput;
            output: ExportProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
