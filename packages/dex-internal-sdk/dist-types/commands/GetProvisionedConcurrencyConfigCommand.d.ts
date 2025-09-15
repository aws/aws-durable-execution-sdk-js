import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetProvisionedConcurrencyConfigRequest, GetProvisionedConcurrencyConfigResponse } from "../models/models_0";
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
 * The input for {@link GetProvisionedConcurrencyConfigCommand}.
 */
export interface GetProvisionedConcurrencyConfigCommandInput extends GetProvisionedConcurrencyConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetProvisionedConcurrencyConfigCommand}.
 */
export interface GetProvisionedConcurrencyConfigCommandOutput extends GetProvisionedConcurrencyConfigResponse, __MetadataBearer {
}
declare const GetProvisionedConcurrencyConfigCommand_base: {
    new (input: GetProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetProvisionedConcurrencyConfigCommandInput, GetProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetProvisionedConcurrencyConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetProvisionedConcurrencyConfigCommandInput, GetProvisionedConcurrencyConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetProvisionedConcurrencyConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetProvisionedConcurrencyConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetProvisionedConcurrencyConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 * };
 * const command = new GetProvisionedConcurrencyConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetProvisionedConcurrencyConfigResponse
 * //   RequestedProvisionedConcurrentExecutions: Number("int"),
 * //   AvailableProvisionedConcurrentExecutions: Number("int"),
 * //   AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //   Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //   StatusReason: "STRING_VALUE",
 * //   LastModified: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetProvisionedConcurrencyConfigCommandInput - {@link GetProvisionedConcurrencyConfigCommandInput}
 * @returns {@link GetProvisionedConcurrencyConfigCommandOutput}
 * @see {@link GetProvisionedConcurrencyConfigCommandInput} for command's `input` shape.
 * @see {@link GetProvisionedConcurrencyConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ProvisionedConcurrencyConfigNotFoundException} (client fault)
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
export declare class GetProvisionedConcurrencyConfigCommand extends GetProvisionedConcurrencyConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetProvisionedConcurrencyConfigRequest;
            output: GetProvisionedConcurrencyConfigResponse;
        };
        sdk: {
            input: GetProvisionedConcurrencyConfigCommandInput;
            output: GetProvisionedConcurrencyConfigCommandOutput;
        };
    };
}
