import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionConcurrencyRequest, GetFunctionConcurrencyResponse } from "../models/models_0";
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
 * The input for {@link GetFunctionConcurrencyCommand}.
 */
export interface GetFunctionConcurrencyCommandInput extends GetFunctionConcurrencyRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionConcurrencyCommand}.
 */
export interface GetFunctionConcurrencyCommandOutput extends GetFunctionConcurrencyResponse, __MetadataBearer {
}
declare const GetFunctionConcurrencyCommand_base: {
    new (input: GetFunctionConcurrencyCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionConcurrencyCommandInput, GetFunctionConcurrencyCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionConcurrencyCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionConcurrencyCommandInput, GetFunctionConcurrencyCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionConcurrencyCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionConcurrencyCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionConcurrencyRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new GetFunctionConcurrencyCommand(input);
 * const response = await client.send(command);
 * // { // GetFunctionConcurrencyResponse
 * //   ReservedConcurrentExecutions: Number("int"),
 * // };
 *
 * ```
 *
 * @param GetFunctionConcurrencyCommandInput - {@link GetFunctionConcurrencyCommandInput}
 * @returns {@link GetFunctionConcurrencyCommandOutput}
 * @see {@link GetFunctionConcurrencyCommandInput} for command's `input` shape.
 * @see {@link GetFunctionConcurrencyCommandOutput} for command's `response` shape.
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
export declare class GetFunctionConcurrencyCommand extends GetFunctionConcurrencyCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionConcurrencyRequest;
            output: GetFunctionConcurrencyResponse;
        };
        sdk: {
            input: GetFunctionConcurrencyCommandInput;
            output: GetFunctionConcurrencyCommandOutput;
        };
    };
}
