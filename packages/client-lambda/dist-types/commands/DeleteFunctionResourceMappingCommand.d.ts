import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionResourceMappingRequest, DeleteFunctionResourceMappingResponse } from "../models/models_0";
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
 * The input for {@link DeleteFunctionResourceMappingCommand}.
 */
export interface DeleteFunctionResourceMappingCommandInput extends DeleteFunctionResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionResourceMappingCommand}.
 */
export interface DeleteFunctionResourceMappingCommandOutput extends DeleteFunctionResourceMappingResponse, __MetadataBearer {
}
declare const DeleteFunctionResourceMappingCommand_base: {
    new (input: DeleteFunctionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionResourceMappingCommandInput, DeleteFunctionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionResourceMappingCommandInput, DeleteFunctionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   ResourceType: "PER_FUNCTION_CONCURRENCY", // required
 * };
 * const command = new DeleteFunctionResourceMappingCommand(input);
 * const response = await client.send(command);
 * // { // DeleteFunctionResourceMappingResponse
 * //   FunctionId: "STRING_VALUE", // required
 * //   FunctionSequenceNumber: Number("long"),
 * // };
 *
 * ```
 *
 * @param DeleteFunctionResourceMappingCommandInput - {@link DeleteFunctionResourceMappingCommandInput}
 * @returns {@link DeleteFunctionResourceMappingCommandOutput}
 * @see {@link DeleteFunctionResourceMappingCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionResourceMappingCommandOutput} for command's `response` shape.
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
export declare class DeleteFunctionResourceMappingCommand extends DeleteFunctionResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionResourceMappingRequest;
            output: DeleteFunctionResourceMappingResponse;
        };
        sdk: {
            input: DeleteFunctionResourceMappingCommandInput;
            output: DeleteFunctionResourceMappingCommandOutput;
        };
    };
}
