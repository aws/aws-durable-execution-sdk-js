import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionCodeSigningConfigRequest, PutFunctionCodeSigningConfigResponse } from "../models/models_1";
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
 * The input for {@link PutFunctionCodeSigningConfigCommand}.
 */
export interface PutFunctionCodeSigningConfigCommandInput extends PutFunctionCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionCodeSigningConfigCommand}.
 */
export interface PutFunctionCodeSigningConfigCommandOutput extends PutFunctionCodeSigningConfigResponse, __MetadataBearer {
}
declare const PutFunctionCodeSigningConfigCommand_base: {
    new (input: PutFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionCodeSigningConfigCommandInput, PutFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionCodeSigningConfigCommandInput, PutFunctionCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionCodeSigningConfigRequest
 *   CodeSigningConfigArn: "STRING_VALUE", // required
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new PutFunctionCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutFunctionCodeSigningConfigResponse
 * //   CodeSigningConfigArn: "STRING_VALUE", // required
 * //   FunctionName: "STRING_VALUE", // required
 * // };
 *
 * ```
 *
 * @param PutFunctionCodeSigningConfigCommandInput - {@link PutFunctionCodeSigningConfigCommandInput}
 * @returns {@link PutFunctionCodeSigningConfigCommandOutput}
 * @see {@link PutFunctionCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link PutFunctionCodeSigningConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CodeSigningConfigNotFoundException} (client fault)
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
export declare class PutFunctionCodeSigningConfigCommand extends PutFunctionCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionCodeSigningConfigRequest;
            output: PutFunctionCodeSigningConfigResponse;
        };
        sdk: {
            input: PutFunctionCodeSigningConfigCommandInput;
            output: PutFunctionCodeSigningConfigCommandOutput;
        };
    };
}
