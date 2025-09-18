import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionConcurrencyRequest20171031 } from "../models/models_0";
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
 * The input for {@link DeleteFunctionConcurrency20171031Command}.
 */
export interface DeleteFunctionConcurrency20171031CommandInput extends DeleteFunctionConcurrencyRequest20171031 {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionConcurrency20171031Command}.
 */
export interface DeleteFunctionConcurrency20171031CommandOutput extends __MetadataBearer {
}
declare const DeleteFunctionConcurrency20171031Command_base: {
    new (input: DeleteFunctionConcurrency20171031CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionConcurrency20171031CommandInput, DeleteFunctionConcurrency20171031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionConcurrency20171031CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionConcurrency20171031CommandInput, DeleteFunctionConcurrency20171031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionConcurrency20171031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionConcurrency20171031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionConcurrencyRequest20171031
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new DeleteFunctionConcurrency20171031Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteFunctionConcurrency20171031CommandInput - {@link DeleteFunctionConcurrency20171031CommandInput}
 * @returns {@link DeleteFunctionConcurrency20171031CommandOutput}
 * @see {@link DeleteFunctionConcurrency20171031CommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionConcurrency20171031CommandOutput} for command's `response` shape.
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
export declare class DeleteFunctionConcurrency20171031Command extends DeleteFunctionConcurrency20171031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionConcurrencyRequest20171031;
            output: {};
        };
        sdk: {
            input: DeleteFunctionConcurrency20171031CommandInput;
            output: DeleteFunctionConcurrency20171031CommandOutput;
        };
    };
}
