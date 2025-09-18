import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionRequest, DeleteFunctionResponse } from "../models/models_0";
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
 * The input for {@link DeleteFunctionInternalCommand}.
 */
export interface DeleteFunctionInternalCommandInput extends DeleteFunctionRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionInternalCommand}.
 */
export interface DeleteFunctionInternalCommandOutput extends DeleteFunctionResponse, __MetadataBearer {
}
declare const DeleteFunctionInternalCommand_base: {
    new (input: DeleteFunctionInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionInternalCommandInput, DeleteFunctionInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionInternalCommandInput, DeleteFunctionInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   MasterArn: "STRING_VALUE",
 * };
 * const command = new DeleteFunctionInternalCommand(input);
 * const response = await client.send(command);
 * // { // DeleteFunctionResponse
 * //   StatusCode: Number("int"),
 * // };
 *
 * ```
 *
 * @param DeleteFunctionInternalCommandInput - {@link DeleteFunctionInternalCommandInput}
 * @returns {@link DeleteFunctionInternalCommandOutput}
 * @see {@link DeleteFunctionInternalCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionInternalCommandOutput} for command's `response` shape.
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
export declare class DeleteFunctionInternalCommand extends DeleteFunctionInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionRequest;
            output: DeleteFunctionResponse;
        };
        sdk: {
            input: DeleteFunctionInternalCommandInput;
            output: DeleteFunctionInternalCommandOutput;
        };
    };
}
