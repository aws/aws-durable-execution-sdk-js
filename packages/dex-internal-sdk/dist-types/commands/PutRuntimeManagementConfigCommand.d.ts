import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutRuntimeManagementConfigRequest, PutRuntimeManagementConfigResponse } from "../models/models_1";
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
 * The input for {@link PutRuntimeManagementConfigCommand}.
 */
export interface PutRuntimeManagementConfigCommandInput extends PutRuntimeManagementConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutRuntimeManagementConfigCommand}.
 */
export interface PutRuntimeManagementConfigCommandOutput extends PutRuntimeManagementConfigResponse, __MetadataBearer {
}
declare const PutRuntimeManagementConfigCommand_base: {
    new (input: PutRuntimeManagementConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutRuntimeManagementConfigCommandInput, PutRuntimeManagementConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutRuntimeManagementConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutRuntimeManagementConfigCommandInput, PutRuntimeManagementConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutRuntimeManagementConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutRuntimeManagementConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutRuntimeManagementConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   UpdateRuntimeOn: "Auto" || "Manual" || "FunctionUpdate", // required
 *   RuntimeVersionArn: "STRING_VALUE",
 * };
 * const command = new PutRuntimeManagementConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutRuntimeManagementConfigResponse
 * //   UpdateRuntimeOn: "Auto" || "Manual" || "FunctionUpdate", // required
 * //   FunctionArn: "STRING_VALUE", // required
 * //   RuntimeVersionArn: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param PutRuntimeManagementConfigCommandInput - {@link PutRuntimeManagementConfigCommandInput}
 * @returns {@link PutRuntimeManagementConfigCommandOutput}
 * @see {@link PutRuntimeManagementConfigCommandInput} for command's `input` shape.
 * @see {@link PutRuntimeManagementConfigCommandOutput} for command's `response` shape.
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
export declare class PutRuntimeManagementConfigCommand extends PutRuntimeManagementConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutRuntimeManagementConfigRequest;
            output: PutRuntimeManagementConfigResponse;
        };
        sdk: {
            input: PutRuntimeManagementConfigCommandInput;
            output: PutRuntimeManagementConfigCommandOutput;
        };
    };
}
