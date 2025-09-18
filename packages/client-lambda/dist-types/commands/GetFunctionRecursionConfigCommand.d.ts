import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionRecursionConfigRequest, GetFunctionRecursionConfigResponse } from "../models/models_0";
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
 * The input for {@link GetFunctionRecursionConfigCommand}.
 */
export interface GetFunctionRecursionConfigCommandInput extends GetFunctionRecursionConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionRecursionConfigCommand}.
 */
export interface GetFunctionRecursionConfigCommandOutput extends GetFunctionRecursionConfigResponse, __MetadataBearer {
}
declare const GetFunctionRecursionConfigCommand_base: {
    new (input: GetFunctionRecursionConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionRecursionConfigCommandInput, GetFunctionRecursionConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionRecursionConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionRecursionConfigCommandInput, GetFunctionRecursionConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionRecursionConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionRecursionConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionRecursionConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new GetFunctionRecursionConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetFunctionRecursionConfigResponse
 * //   RecursiveLoop: "Allow" || "Terminate",
 * // };
 *
 * ```
 *
 * @param GetFunctionRecursionConfigCommandInput - {@link GetFunctionRecursionConfigCommandInput}
 * @returns {@link GetFunctionRecursionConfigCommandOutput}
 * @see {@link GetFunctionRecursionConfigCommandInput} for command's `input` shape.
 * @see {@link GetFunctionRecursionConfigCommandOutput} for command's `response` shape.
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
export declare class GetFunctionRecursionConfigCommand extends GetFunctionRecursionConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionRecursionConfigRequest;
            output: GetFunctionRecursionConfigResponse;
        };
        sdk: {
            input: GetFunctionRecursionConfigCommandInput;
            output: GetFunctionRecursionConfigCommandOutput;
        };
    };
}
