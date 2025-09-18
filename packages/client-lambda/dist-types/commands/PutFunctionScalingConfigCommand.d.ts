import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionScalingConfigRequest, PutFunctionScalingConfigResponse } from "../models/models_1";
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
 * The input for {@link PutFunctionScalingConfigCommand}.
 */
export interface PutFunctionScalingConfigCommandInput extends PutFunctionScalingConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionScalingConfigCommand}.
 */
export interface PutFunctionScalingConfigCommandOutput extends PutFunctionScalingConfigResponse, __MetadataBearer {
}
declare const PutFunctionScalingConfigCommand_base: {
    new (input: PutFunctionScalingConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionScalingConfigCommandInput, PutFunctionScalingConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionScalingConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionScalingConfigCommandInput, PutFunctionScalingConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionScalingConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionScalingConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionScalingConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 *   FunctionScalingConfig: { // FunctionScalingConfig
 *     MinExecutionEnvironments: Number("int"),
 *     MaxExecutionEnvironments: Number("int"),
 *   },
 * };
 * const command = new PutFunctionScalingConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutFunctionScalingConfigResponse
 * //   FunctionState: "Pending" || "Active" || "Inactive" || "Failed" || "Deactivating" || "Deactivated" || "ActiveNonInvocable" || "Deleting",
 * // };
 *
 * ```
 *
 * @param PutFunctionScalingConfigCommandInput - {@link PutFunctionScalingConfigCommandInput}
 * @returns {@link PutFunctionScalingConfigCommandOutput}
 * @see {@link PutFunctionScalingConfigCommandInput} for command's `input` shape.
 * @see {@link PutFunctionScalingConfigCommandOutput} for command's `response` shape.
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
export declare class PutFunctionScalingConfigCommand extends PutFunctionScalingConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionScalingConfigRequest;
            output: PutFunctionScalingConfigResponse;
        };
        sdk: {
            input: PutFunctionScalingConfigCommandInput;
            output: PutFunctionScalingConfigCommandOutput;
        };
    };
}
