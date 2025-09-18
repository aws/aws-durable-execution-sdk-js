import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionVersionResourceMappingRequest } from "../models/models_0";
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
 * The input for {@link DeleteFunctionVersionResourceMappingCommand}.
 */
export interface DeleteFunctionVersionResourceMappingCommandInput extends DeleteFunctionVersionResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionVersionResourceMappingCommand}.
 */
export interface DeleteFunctionVersionResourceMappingCommandOutput extends __MetadataBearer {
}
declare const DeleteFunctionVersionResourceMappingCommand_base: {
    new (input: DeleteFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionVersionResourceMappingCommandInput, DeleteFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionVersionResourceMappingCommandInput, DeleteFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionVersionResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionVersionResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionVersionResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Version: "STRING_VALUE", // required
 *   ResourceType: "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT", // required
 * };
 * const command = new DeleteFunctionVersionResourceMappingCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteFunctionVersionResourceMappingCommandInput - {@link DeleteFunctionVersionResourceMappingCommandInput}
 * @returns {@link DeleteFunctionVersionResourceMappingCommandOutput}
 * @see {@link DeleteFunctionVersionResourceMappingCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionVersionResourceMappingCommandOutput} for command's `response` shape.
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
export declare class DeleteFunctionVersionResourceMappingCommand extends DeleteFunctionVersionResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionVersionResourceMappingRequest;
            output: {};
        };
        sdk: {
            input: DeleteFunctionVersionResourceMappingCommandInput;
            output: DeleteFunctionVersionResourceMappingCommandOutput;
        };
    };
}
