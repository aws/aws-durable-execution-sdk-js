import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ResignFunctionVersionRequest, ResignFunctionVersionResponse } from "../models/models_1";
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
 * The input for {@link ResignFunctionVersionCommand}.
 */
export interface ResignFunctionVersionCommandInput extends ResignFunctionVersionRequest {
}
/**
 * @public
 *
 * The output of {@link ResignFunctionVersionCommand}.
 */
export interface ResignFunctionVersionCommandOutput extends ResignFunctionVersionResponse, __MetadataBearer {
}
declare const ResignFunctionVersionCommand_base: {
    new (input: ResignFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ResignFunctionVersionCommandInput, ResignFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ResignFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ResignFunctionVersionCommandInput, ResignFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ResignFunctionVersionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ResignFunctionVersionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ResignFunctionVersionRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   SigningKeyType: "KMS" || "POPPYSEED", // required
 * };
 * const command = new ResignFunctionVersionCommand(input);
 * const response = await client.send(command);
 * // { // ResignFunctionVersionResponse
 * //   Resigned: true || false,
 * // };
 *
 * ```
 *
 * @param ResignFunctionVersionCommandInput - {@link ResignFunctionVersionCommandInput}
 * @returns {@link ResignFunctionVersionCommandOutput}
 * @see {@link ResignFunctionVersionCommandInput} for command's `input` shape.
 * @see {@link ResignFunctionVersionCommandOutput} for command's `response` shape.
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
export declare class ResignFunctionVersionCommand extends ResignFunctionVersionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ResignFunctionVersionRequest;
            output: ResignFunctionVersionResponse;
        };
        sdk: {
            input: ResignFunctionVersionCommandInput;
            output: ResignFunctionVersionCommandOutput;
        };
    };
}
