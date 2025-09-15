import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionCodeSigningConfigRequest, GetFunctionCodeSigningConfigResponse } from "../models/models_0";
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
 * The input for {@link GetFunctionCodeSigningConfigCommand}.
 */
export interface GetFunctionCodeSigningConfigCommandInput extends GetFunctionCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionCodeSigningConfigCommand}.
 */
export interface GetFunctionCodeSigningConfigCommandOutput extends GetFunctionCodeSigningConfigResponse, __MetadataBearer {
}
declare const GetFunctionCodeSigningConfigCommand_base: {
    new (input: GetFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionCodeSigningConfigCommandInput, GetFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionCodeSigningConfigCommandInput, GetFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionCodeSigningConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new GetFunctionCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetFunctionCodeSigningConfigResponse
 * //   CodeSigningConfigArn: "STRING_VALUE", // required
 * //   FunctionName: "STRING_VALUE", // required
 * // };
 *
 * ```
 *
 * @param GetFunctionCodeSigningConfigCommandInput - {@link GetFunctionCodeSigningConfigCommandInput}
 * @returns {@link GetFunctionCodeSigningConfigCommandOutput}
 * @see {@link GetFunctionCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link GetFunctionCodeSigningConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CodeSigningConfigNotFoundException} (client fault)
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
export declare class GetFunctionCodeSigningConfigCommand extends GetFunctionCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionCodeSigningConfigRequest;
            output: GetFunctionCodeSigningConfigResponse;
        };
        sdk: {
            input: GetFunctionCodeSigningConfigCommandInput;
            output: GetFunctionCodeSigningConfigCommandOutput;
        };
    };
}
