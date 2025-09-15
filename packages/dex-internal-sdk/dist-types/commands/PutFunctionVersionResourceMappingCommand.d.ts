import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionVersionResourceMappingRequest } from "../models/models_1";
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
 * The input for {@link PutFunctionVersionResourceMappingCommand}.
 */
export interface PutFunctionVersionResourceMappingCommandInput extends PutFunctionVersionResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionVersionResourceMappingCommand}.
 */
export interface PutFunctionVersionResourceMappingCommandOutput extends __MetadataBearer {
}
declare const PutFunctionVersionResourceMappingCommand_base: {
    new (input: PutFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionVersionResourceMappingCommandInput, PutFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionVersionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionVersionResourceMappingCommandInput, PutFunctionVersionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionVersionResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionVersionResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionVersionResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Version: "STRING_VALUE", // required
 *   ResourceType: "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT", // required
 * };
 * const command = new PutFunctionVersionResourceMappingCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param PutFunctionVersionResourceMappingCommandInput - {@link PutFunctionVersionResourceMappingCommandInput}
 * @returns {@link PutFunctionVersionResourceMappingCommandOutput}
 * @see {@link PutFunctionVersionResourceMappingCommandInput} for command's `input` shape.
 * @see {@link PutFunctionVersionResourceMappingCommandOutput} for command's `response` shape.
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
export declare class PutFunctionVersionResourceMappingCommand extends PutFunctionVersionResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionVersionResourceMappingRequest;
            output: {};
        };
        sdk: {
            input: PutFunctionVersionResourceMappingCommandInput;
            output: PutFunctionVersionResourceMappingCommandOutput;
        };
    };
}
