import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionScalingConfigRequest, GetFunctionScalingConfigResponse } from "../models/models_0";
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
 * The input for {@link GetFunctionScalingConfigCommand}.
 */
export interface GetFunctionScalingConfigCommandInput extends GetFunctionScalingConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionScalingConfigCommand}.
 */
export interface GetFunctionScalingConfigCommandOutput extends GetFunctionScalingConfigResponse, __MetadataBearer {
}
declare const GetFunctionScalingConfigCommand_base: {
    new (input: GetFunctionScalingConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionScalingConfigCommandInput, GetFunctionScalingConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionScalingConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionScalingConfigCommandInput, GetFunctionScalingConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionScalingConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionScalingConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionScalingConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 * };
 * const command = new GetFunctionScalingConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetFunctionScalingConfigResponse
 * //   FunctionArn: "STRING_VALUE",
 * //   AppliedFunctionScalingConfig: { // FunctionScalingConfig
 * //     MinExecutionEnvironments: Number("int"),
 * //     MaxExecutionEnvironments: Number("int"),
 * //   },
 * //   RequestedFunctionScalingConfig: {
 * //     MinExecutionEnvironments: Number("int"),
 * //     MaxExecutionEnvironments: Number("int"),
 * //   },
 * // };
 *
 * ```
 *
 * @param GetFunctionScalingConfigCommandInput - {@link GetFunctionScalingConfigCommandInput}
 * @returns {@link GetFunctionScalingConfigCommandOutput}
 * @see {@link GetFunctionScalingConfigCommandInput} for command's `input` shape.
 * @see {@link GetFunctionScalingConfigCommandOutput} for command's `response` shape.
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
export declare class GetFunctionScalingConfigCommand extends GetFunctionScalingConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionScalingConfigRequest;
            output: GetFunctionScalingConfigResponse;
        };
        sdk: {
            input: GetFunctionScalingConfigCommandInput;
            output: GetFunctionScalingConfigCommandOutput;
        };
    };
}
