import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutFunctionResourceMappingRequest, PutFunctionResourceMappingResponse } from "../models/models_1";
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
 * The input for {@link PutFunctionResourceMappingCommand}.
 */
export interface PutFunctionResourceMappingCommandInput extends PutFunctionResourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link PutFunctionResourceMappingCommand}.
 */
export interface PutFunctionResourceMappingCommandOutput extends PutFunctionResourceMappingResponse, __MetadataBearer {
}
declare const PutFunctionResourceMappingCommand_base: {
    new (input: PutFunctionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionResourceMappingCommandInput, PutFunctionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionResourceMappingCommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionResourceMappingCommandInput, PutFunctionResourceMappingCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionResourceMappingCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionResourceMappingCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionResourceMappingRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   ResourceType: "PER_FUNCTION_CONCURRENCY", // required
 * };
 * const command = new PutFunctionResourceMappingCommand(input);
 * const response = await client.send(command);
 * // { // PutFunctionResourceMappingResponse
 * //   FunctionId: "STRING_VALUE", // required
 * //   FunctionSequenceNumber: Number("long"),
 * // };
 *
 * ```
 *
 * @param PutFunctionResourceMappingCommandInput - {@link PutFunctionResourceMappingCommandInput}
 * @returns {@link PutFunctionResourceMappingCommandOutput}
 * @see {@link PutFunctionResourceMappingCommandInput} for command's `input` shape.
 * @see {@link PutFunctionResourceMappingCommandOutput} for command's `response` shape.
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
export declare class PutFunctionResourceMappingCommand extends PutFunctionResourceMappingCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionResourceMappingRequest;
            output: PutFunctionResourceMappingResponse;
        };
        sdk: {
            input: PutFunctionResourceMappingCommandInput;
            output: PutFunctionResourceMappingCommandOutput;
        };
    };
}
