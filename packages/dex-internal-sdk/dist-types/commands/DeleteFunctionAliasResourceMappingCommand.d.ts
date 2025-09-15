import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionAliasResourceMappingRequest } from "../models/models_0";
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
 * The input for {@link DeleteFunctionAliasResourceMappingCommand}.
 */
export interface DeleteFunctionAliasResourceMappingCommandInput extends DeleteFunctionAliasResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionAliasResourceMappingCommand}.
 */
export interface DeleteFunctionAliasResourceMappingCommandOutput extends __MetadataBearer {
}
declare const DeleteFunctionAliasResourceMappingCommand_base: {
    new (input: DeleteFunctionAliasResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionAliasResourceMappingCommandInput, DeleteFunctionAliasResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionAliasResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionAliasResourceMappingCommandInput, DeleteFunctionAliasResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionAliasResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionAliasResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionAliasResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Alias: "STRING_VALUE", // required
 *   ResourceType: "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT", // required
 * };
 * const command = new DeleteFunctionAliasResourceMappingCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteFunctionAliasResourceMappingCommandInput - {@link DeleteFunctionAliasResourceMappingCommandInput}
 * @returns {@link DeleteFunctionAliasResourceMappingCommandOutput}
 * @see {@link DeleteFunctionAliasResourceMappingCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionAliasResourceMappingCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
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
export declare class DeleteFunctionAliasResourceMappingCommand extends DeleteFunctionAliasResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionAliasResourceMappingRequest;
            output: {};
        };
        sdk: {
            input: DeleteFunctionAliasResourceMappingCommandInput;
            output: DeleteFunctionAliasResourceMappingCommandOutput;
        };
    };
}
