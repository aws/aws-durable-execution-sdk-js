import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateFunctionVersionResourceMappingRequest } from "../models/models_1";
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
 * The input for {@link UpdateFunctionVersionResourceMappingCommand}.
 */
export interface UpdateFunctionVersionResourceMappingCommandInput extends UpdateFunctionVersionResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateFunctionVersionResourceMappingCommand}.
 */
export interface UpdateFunctionVersionResourceMappingCommandOutput extends __MetadataBearer {
}
declare const UpdateFunctionVersionResourceMappingCommand_base: {
    new (input: UpdateFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionVersionResourceMappingCommandInput, UpdateFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionVersionResourceMappingCommandInput, UpdateFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateFunctionVersionResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateFunctionVersionResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateFunctionVersionResourceMappingRequest
 *   CurrentValue: "STRING_VALUE", // required
 *   FunctionArn: "STRING_VALUE", // required
 *   NewValue: "STRING_VALUE", // required
 *   ResourceType: "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT", // required
 *   Version: "STRING_VALUE", // required
 * };
 * const command = new UpdateFunctionVersionResourceMappingCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param UpdateFunctionVersionResourceMappingCommandInput - {@link UpdateFunctionVersionResourceMappingCommandInput}
 * @returns {@link UpdateFunctionVersionResourceMappingCommandOutput}
 * @see {@link UpdateFunctionVersionResourceMappingCommandInput} for command's `input` shape.
 * @see {@link UpdateFunctionVersionResourceMappingCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ResourceNotReadyException} (server fault)
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
export declare class UpdateFunctionVersionResourceMappingCommand extends UpdateFunctionVersionResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateFunctionVersionResourceMappingRequest;
            output: {};
        };
        sdk: {
            input: UpdateFunctionVersionResourceMappingCommandInput;
            output: UpdateFunctionVersionResourceMappingCommandOutput;
        };
    };
}
