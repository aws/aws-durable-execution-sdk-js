import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteAliasRequest20150331 } from "../models/models_0";
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
 * The input for {@link DeleteAlias20150331Command}.
 */
export interface DeleteAlias20150331CommandInput extends DeleteAliasRequest20150331 {
}
/**
 * @public
 *
 * The output of {@link DeleteAlias20150331Command}.
 */
export interface DeleteAlias20150331CommandOutput extends __MetadataBearer {
}
declare const DeleteAlias20150331Command_base: {
    new (input: DeleteAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteAlias20150331CommandInput, DeleteAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteAlias20150331CommandInput, DeleteAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteAlias20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteAlias20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteAliasRequest20150331
 *   FunctionName: "STRING_VALUE", // required
 *   Name: "STRING_VALUE", // required
 * };
 * const command = new DeleteAlias20150331Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteAlias20150331CommandInput - {@link DeleteAlias20150331CommandInput}
 * @returns {@link DeleteAlias20150331CommandOutput}
 * @see {@link DeleteAlias20150331CommandInput} for command's `input` shape.
 * @see {@link DeleteAlias20150331CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class DeleteAlias20150331Command extends DeleteAlias20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteAliasRequest20150331;
            output: {};
        };
        sdk: {
            input: DeleteAlias20150331CommandInput;
            output: DeleteAlias20150331CommandOutput;
        };
    };
}
