import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ResignFunctionAliasRequest, ResignFunctionAliasResponse } from "../models/models_1";
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
 * The input for {@link ResignFunctionAliasCommand}.
 */
export interface ResignFunctionAliasCommandInput extends ResignFunctionAliasRequest {
}
/**
 * @public
 *
 * The output of {@link ResignFunctionAliasCommand}.
 */
export interface ResignFunctionAliasCommandOutput extends ResignFunctionAliasResponse, __MetadataBearer {
}
declare const ResignFunctionAliasCommand_base: {
    new (input: ResignFunctionAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ResignFunctionAliasCommandInput, ResignFunctionAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ResignFunctionAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ResignFunctionAliasCommandInput, ResignFunctionAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ResignFunctionAliasCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ResignFunctionAliasCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ResignFunctionAliasRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   SigningKeyType: "KMS" || "POPPYSEED", // required
 * };
 * const command = new ResignFunctionAliasCommand(input);
 * const response = await client.send(command);
 * // { // ResignFunctionAliasResponse
 * //   Resigned: true || false,
 * // };
 *
 * ```
 *
 * @param ResignFunctionAliasCommandInput - {@link ResignFunctionAliasCommandInput}
 * @returns {@link ResignFunctionAliasCommandOutput}
 * @see {@link ResignFunctionAliasCommandInput} for command's `input` shape.
 * @see {@link ResignFunctionAliasCommandOutput} for command's `response` shape.
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
export declare class ResignFunctionAliasCommand extends ResignFunctionAliasCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ResignFunctionAliasRequest;
            output: ResignFunctionAliasResponse;
        };
        sdk: {
            input: ResignFunctionAliasCommandInput;
            output: ResignFunctionAliasCommandOutput;
        };
    };
}
