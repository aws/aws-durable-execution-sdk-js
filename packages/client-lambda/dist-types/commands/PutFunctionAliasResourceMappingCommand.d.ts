import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionAliasResourceMappingRequest } from "../models/models_1";
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
 * The input for {@link PutFunctionAliasResourceMappingCommand}.
 */
export interface PutFunctionAliasResourceMappingCommandInput extends PutFunctionAliasResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionAliasResourceMappingCommand}.
 */
export interface PutFunctionAliasResourceMappingCommandOutput extends __MetadataBearer {
}
declare const PutFunctionAliasResourceMappingCommand_base: {
    new (input: PutFunctionAliasResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionAliasResourceMappingCommandInput, PutFunctionAliasResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionAliasResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionAliasResourceMappingCommandInput, PutFunctionAliasResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionAliasResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionAliasResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionAliasResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Alias: "STRING_VALUE", // required
 *   ResourceType: "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT", // required
 * };
 * const command = new PutFunctionAliasResourceMappingCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param PutFunctionAliasResourceMappingCommandInput - {@link PutFunctionAliasResourceMappingCommandInput}
 * @returns {@link PutFunctionAliasResourceMappingCommandOutput}
 * @see {@link PutFunctionAliasResourceMappingCommandInput} for command's `input` shape.
 * @see {@link PutFunctionAliasResourceMappingCommandOutput} for command's `response` shape.
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
export declare class PutFunctionAliasResourceMappingCommand extends PutFunctionAliasResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionAliasResourceMappingRequest;
            output: {};
        };
        sdk: {
            input: PutFunctionAliasResourceMappingCommandInput;
            output: PutFunctionAliasResourceMappingCommandOutput;
        };
    };
}
