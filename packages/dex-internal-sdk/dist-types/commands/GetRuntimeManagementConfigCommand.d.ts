import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetRuntimeManagementConfigRequest, GetRuntimeManagementConfigResponse } from "../models/models_0";
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
 * The input for {@link GetRuntimeManagementConfigCommand}.
 */
export interface GetRuntimeManagementConfigCommandInput extends GetRuntimeManagementConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetRuntimeManagementConfigCommand}.
 */
export interface GetRuntimeManagementConfigCommandOutput extends GetRuntimeManagementConfigResponse, __MetadataBearer {
}
declare const GetRuntimeManagementConfigCommand_base: {
    new (input: GetRuntimeManagementConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetRuntimeManagementConfigCommandInput, GetRuntimeManagementConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetRuntimeManagementConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetRuntimeManagementConfigCommandInput, GetRuntimeManagementConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetRuntimeManagementConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetRuntimeManagementConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetRuntimeManagementConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetRuntimeManagementConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetRuntimeManagementConfigResponse
 * //   UpdateRuntimeOn: "Auto" || "Manual" || "FunctionUpdate",
 * //   FunctionArn: "STRING_VALUE",
 * //   RuntimeVersionArn: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetRuntimeManagementConfigCommandInput - {@link GetRuntimeManagementConfigCommandInput}
 * @returns {@link GetRuntimeManagementConfigCommandOutput}
 * @see {@link GetRuntimeManagementConfigCommandInput} for command's `input` shape.
 * @see {@link GetRuntimeManagementConfigCommandOutput} for command's `response` shape.
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
export declare class GetRuntimeManagementConfigCommand extends GetRuntimeManagementConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetRuntimeManagementConfigRequest;
            output: GetRuntimeManagementConfigResponse;
        };
        sdk: {
            input: GetRuntimeManagementConfigCommandInput;
            output: GetRuntimeManagementConfigCommandOutput;
        };
    };
}
