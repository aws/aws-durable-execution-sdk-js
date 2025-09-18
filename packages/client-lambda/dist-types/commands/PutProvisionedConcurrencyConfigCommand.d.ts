import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutProvisionedConcurrencyConfigRequest, PutProvisionedConcurrencyConfigResponse } from "../models/models_1";
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
 * The input for {@link PutProvisionedConcurrencyConfigCommand}.
 */
export interface PutProvisionedConcurrencyConfigCommandInput extends PutProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutProvisionedConcurrencyConfigCommand}.
 */
export interface PutProvisionedConcurrencyConfigCommandOutput extends PutProvisionedConcurrencyConfigResponse, __MetadataBearer {
}
declare const PutProvisionedConcurrencyConfigCommand_base: {
    new (input: PutProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutProvisionedConcurrencyConfigCommandInput, PutProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutProvisionedConcurrencyConfigCommandInput, PutProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 *   ProvisionedConcurrentExecutions: Number("int"), // required
 * };
 * const command = new PutProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutProvisionedConcurrencyConfigResponse
 * //   RequestedProvisionedConcurrentExecutions: Number("int"),
 * //   AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //   Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //   StatusReason: "STRING_VALUE",
 * //   LastModified: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param PutProvisionedConcurrencyConfigCommandInput - {@link PutProvisionedConcurrencyConfigCommandInput}
 * @returns {@link PutProvisionedConcurrencyConfigCommandOutput}
 * @see {@link PutProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link PutProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
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
export declare class PutProvisionedConcurrencyConfigCommand extends PutProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutProvisionedConcurrencyConfigRequest;
            output: PutProvisionedConcurrencyConfigResponse;
        };
        sdk: {
            input: PutProvisionedConcurrencyConfigCommandInput;
            output: PutProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
