import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ValidateProvisionedConcurrencyFunctionVersionRequest, ValidateProvisionedConcurrencyFunctionVersionResponse } from "../models/models_1";
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
 * The input for {@link ValidateProvisionedConcurrencyFunctionVersionCommand}.
 */
export interface ValidateProvisionedConcurrencyFunctionVersionCommandInput extends ValidateProvisionedConcurrencyFunctionVersionRequest {
}
/**
 * @public
 *
 * The output of {@link ValidateProvisionedConcurrencyFunctionVersionCommand}.
 */
export interface ValidateProvisionedConcurrencyFunctionVersionCommandOutput extends ValidateProvisionedConcurrencyFunctionVersionResponse, __MetadataBearer {
}
declare const ValidateProvisionedConcurrencyFunctionVersionCommand_base: {
    new (input: ValidateProvisionedConcurrencyFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ValidateProvisionedConcurrencyFunctionVersionCommandInput, ValidateProvisionedConcurrencyFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ValidateProvisionedConcurrencyFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ValidateProvisionedConcurrencyFunctionVersionCommandInput, ValidateProvisionedConcurrencyFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ValidateProvisionedConcurrencyFunctionVersionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ValidateProvisionedConcurrencyFunctionVersionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ValidateProvisionedConcurrencyFunctionVersionRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new ValidateProvisionedConcurrencyFunctionVersionCommand(input);
 * const response = await client.send(command);
 * // { // ValidateProvisionedConcurrencyFunctionVersionResponse
 * //   DesiredProvisionedConcurrentExecutions: Number("int"),
 * // };
 *
 * ```
 *
 * @param ValidateProvisionedConcurrencyFunctionVersionCommandInput - {@link ValidateProvisionedConcurrencyFunctionVersionCommandInput}
 * @returns {@link ValidateProvisionedConcurrencyFunctionVersionCommandOutput}
 * @see {@link ValidateProvisionedConcurrencyFunctionVersionCommandInput} for command's `input` shape.
 * @see {@link ValidateProvisionedConcurrencyFunctionVersionCommandOutput} for command's `response` shape.
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
export declare class ValidateProvisionedConcurrencyFunctionVersionCommand extends ValidateProvisionedConcurrencyFunctionVersionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ValidateProvisionedConcurrencyFunctionVersionRequest;
            output: ValidateProvisionedConcurrencyFunctionVersionResponse;
        };
        sdk: {
            input: ValidateProvisionedConcurrencyFunctionVersionCommandInput;
            output: ValidateProvisionedConcurrencyFunctionVersionCommandOutput;
        };
    };
}
