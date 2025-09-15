import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ResetFunctionFeatureInternalRequest } from "../models/models_1";
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
 * The input for {@link ResetFunctionFeatureInternalCommand}.
 */
export interface ResetFunctionFeatureInternalCommandInput extends ResetFunctionFeatureInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ResetFunctionFeatureInternalCommand}.
 */
export interface ResetFunctionFeatureInternalCommandOutput extends __MetadataBearer {
}
declare const ResetFunctionFeatureInternalCommand_base: {
    new (input: ResetFunctionFeatureInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ResetFunctionFeatureInternalCommandInput, ResetFunctionFeatureInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ResetFunctionFeatureInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ResetFunctionFeatureInternalCommandInput, ResetFunctionFeatureInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ResetFunctionFeatureInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ResetFunctionFeatureInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ResetFunctionFeatureInternalRequest
 *   FeatureGate: "STRING_VALUE", // required
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new ResetFunctionFeatureInternalCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param ResetFunctionFeatureInternalCommandInput - {@link ResetFunctionFeatureInternalCommandInput}
 * @returns {@link ResetFunctionFeatureInternalCommandOutput}
 * @see {@link ResetFunctionFeatureInternalCommandInput} for command's `input` shape.
 * @see {@link ResetFunctionFeatureInternalCommandOutput} for command's `response` shape.
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
export declare class ResetFunctionFeatureInternalCommand extends ResetFunctionFeatureInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ResetFunctionFeatureInternalRequest;
            output: {};
        };
        sdk: {
            input: ResetFunctionFeatureInternalCommandInput;
            output: ResetFunctionFeatureInternalCommandOutput;
        };
    };
}
