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
 * The input for {@link DeleteFunction20150331Command}.
 */
export interface DeleteFunction20150331CommandInput extends DeleteFunctionRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunction20150331Command}.
 */
export interface DeleteFunction20150331CommandOutput extends DeleteFunctionResponse, __MetadataBearer {
}
declare const DeleteFunction20150331Command_base: {
    new (input: DeleteFunction20150331CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunction20150331CommandInput, DeleteFunction20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunction20150331CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunction20150331CommandInput, DeleteFunction20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunction20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunction20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   MasterArn: "STRING_VALUE",
 * };
 * const command = new DeleteFunction20150331Command(input);
 * const response = await client.send(command);
 * // { // DeleteFunctionResponse
 * //   StatusCode: Number("int"),
 * // };
 *
 * ```
 *
 * @param DeleteFunction20150331CommandInput - {@link DeleteFunction20150331CommandInput}
 * @returns {@link DeleteFunction20150331CommandOutput}
 * @see {@link DeleteFunction20150331CommandInput} for command's `input` shape.
 * @see {@link DeleteFunction20150331CommandOutput} for command's `response` shape.
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
export declare class DeleteFunction20150331Command extends DeleteFunction20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionRequest;
            output: DeleteFunctionResponse;
        };
        sdk: {
            input: DeleteFunction20150331CommandInput;
            output: DeleteFunction20150331CommandOutput;
        };
    };
}
