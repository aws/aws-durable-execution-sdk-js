import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RollbackFunctionRequest, RollbackFunctionResponse } from "../models/models_1";
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
 * The input for {@link RollbackFunctionCommand}.
 */
export interface RollbackFunctionCommandInput extends RollbackFunctionRequest {
}
/**
 * @public
 *
 * The output of {@link RollbackFunctionCommand}.
 */
export interface RollbackFunctionCommandOutput extends RollbackFunctionResponse, __MetadataBearer {
}
declare const RollbackFunctionCommand_base: {
    new (input: RollbackFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<RollbackFunctionCommandInput, RollbackFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RollbackFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<RollbackFunctionCommandInput, RollbackFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RollbackFunctionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RollbackFunctionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RollbackFunctionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   RuntimeUpdate: { // RuntimeUpdate
 *     UpdateRuntimeOn: "Auto" || "Manual" || "FunctionUpdate",
 *   },
 * };
 * const command = new RollbackFunctionCommand(input);
 * const response = await client.send(command);
 * // { // RollbackFunctionResponse
 * //   RuntimeResult: { // RuntimeResult
 * //     UpdateRuntimeOn: "Auto" || "Manual" || "FunctionUpdate",
 * //     RuntimeVersionArn: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param RollbackFunctionCommandInput - {@link RollbackFunctionCommandInput}
 * @returns {@link RollbackFunctionCommandOutput}
 * @see {@link RollbackFunctionCommandInput} for command's `input` shape.
 * @see {@link RollbackFunctionCommandOutput} for command's `response` shape.
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
export declare class RollbackFunctionCommand extends RollbackFunctionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RollbackFunctionRequest;
            output: RollbackFunctionResponse;
        };
        sdk: {
            input: RollbackFunctionCommandInput;
            output: RollbackFunctionCommandOutput;
        };
    };
}
