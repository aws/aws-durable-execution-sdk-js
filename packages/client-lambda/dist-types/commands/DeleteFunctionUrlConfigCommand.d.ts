import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionUrlConfigRequest } from "../models/models_0";
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
 * The input for {@link DeleteFunctionUrlConfigCommand}.
 */
export interface DeleteFunctionUrlConfigCommandInput extends DeleteFunctionUrlConfigRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionUrlConfigCommand}.
 */
export interface DeleteFunctionUrlConfigCommandOutput extends __MetadataBearer {
}
declare const DeleteFunctionUrlConfigCommand_base: {
    new (input: DeleteFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionUrlConfigCommandInput, DeleteFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionUrlConfigCommandInput, DeleteFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionUrlConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionUrlConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionUrlConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new DeleteFunctionUrlConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteFunctionUrlConfigCommandInput - {@link DeleteFunctionUrlConfigCommandInput}
 * @returns {@link DeleteFunctionUrlConfigCommandOutput}
 * @see {@link DeleteFunctionUrlConfigCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionUrlConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class DeleteFunctionUrlConfigCommand extends DeleteFunctionUrlConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionUrlConfigRequest;
            output: {};
        };
        sdk: {
            input: DeleteFunctionUrlConfigCommandInput;
            output: DeleteFunctionUrlConfigCommandOutput;
        };
    };
}
