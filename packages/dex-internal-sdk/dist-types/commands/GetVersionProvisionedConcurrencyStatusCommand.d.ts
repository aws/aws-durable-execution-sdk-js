import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetVersionProvisionedConcurrencyStatusRequest, GetVersionProvisionedConcurrencyStatusResponse } from "../models/models_0";
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
 * The input for {@link GetVersionProvisionedConcurrencyStatusCommand}.
 */
export interface GetVersionProvisionedConcurrencyStatusCommandInput extends GetVersionProvisionedConcurrencyStatusRequest {
}
/**
 * @public
 *
 * The output of {@link GetVersionProvisionedConcurrencyStatusCommand}.
 */
export interface GetVersionProvisionedConcurrencyStatusCommandOutput extends GetVersionProvisionedConcurrencyStatusResponse, __MetadataBearer {
}
declare const GetVersionProvisionedConcurrencyStatusCommand_base: {
    new (input: GetVersionProvisionedConcurrencyStatusCommandInput): import("@smithy/smithy-client").CommandImpl<GetVersionProvisionedConcurrencyStatusCommandInput, GetVersionProvisionedConcurrencyStatusCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetVersionProvisionedConcurrencyStatusCommandInput): import("@smithy/smithy-client").CommandImpl<GetVersionProvisionedConcurrencyStatusCommandInput, GetVersionProvisionedConcurrencyStatusCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetVersionProvisionedConcurrencyStatusCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetVersionProvisionedConcurrencyStatusCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetVersionProvisionedConcurrencyStatusRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new GetVersionProvisionedConcurrencyStatusCommand(input);
 * const response = await client.send(command);
 * // { // GetVersionProvisionedConcurrencyStatusResponse
 * //   AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //   PreWarmingStatus: "STRING_VALUE",
 * //   RevisionId: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetVersionProvisionedConcurrencyStatusCommandInput - {@link GetVersionProvisionedConcurrencyStatusCommandInput}
 * @returns {@link GetVersionProvisionedConcurrencyStatusCommandOutput}
 * @see {@link GetVersionProvisionedConcurrencyStatusCommandInput} for command's `input` shape.
 * @see {@link GetVersionProvisionedConcurrencyStatusCommandOutput} for command's `response` shape.
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
export declare class GetVersionProvisionedConcurrencyStatusCommand extends GetVersionProvisionedConcurrencyStatusCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetVersionProvisionedConcurrencyStatusRequest;
            output: GetVersionProvisionedConcurrencyStatusResponse;
        };
        sdk: {
            input: GetVersionProvisionedConcurrencyStatusCommandInput;
            output: GetVersionProvisionedConcurrencyStatusCommandOutput;
        };
    };
}
