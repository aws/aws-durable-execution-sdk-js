import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionRecursionConfigRequest, PutFunctionRecursionConfigResponse } from "../models/models_1";
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
 * The input for {@link PutFunctionRecursionConfigCommand}.
 */
export interface PutFunctionRecursionConfigCommandInput extends PutFunctionRecursionConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionRecursionConfigCommand}.
 */
export interface PutFunctionRecursionConfigCommandOutput extends PutFunctionRecursionConfigResponse, __MetadataBearer {
}
declare const PutFunctionRecursionConfigCommand_base: {
    new (input: PutFunctionRecursionConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionRecursionConfigCommandInput, PutFunctionRecursionConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionRecursionConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionRecursionConfigCommandInput, PutFunctionRecursionConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionRecursionConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionRecursionConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionRecursionConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   RecursiveLoop: "Allow" || "Terminate", // required
 * };
 * const command = new PutFunctionRecursionConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutFunctionRecursionConfigResponse
 * //   RecursiveLoop: "Allow" || "Terminate",
 * // };
 *
 * ```
 *
 * @param PutFunctionRecursionConfigCommandInput - {@link PutFunctionRecursionConfigCommandInput}
 * @returns {@link PutFunctionRecursionConfigCommandOutput}
 * @see {@link PutFunctionRecursionConfigCommandInput} for command's `input` shape.
 * @see {@link PutFunctionRecursionConfigCommandOutput} for command's `response` shape.
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
export declare class PutFunctionRecursionConfigCommand extends PutFunctionRecursionConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionRecursionConfigRequest;
            output: PutFunctionRecursionConfigResponse;
        };
        sdk: {
            input: PutFunctionRecursionConfigCommandInput;
            output: PutFunctionRecursionConfigCommandOutput;
        };
    };
}
