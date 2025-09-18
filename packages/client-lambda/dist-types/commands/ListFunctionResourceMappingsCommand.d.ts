import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionResourceMappingsRequest, ListFunctionResourceMappingsResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionResourceMappingsCommand}.
 */
export interface ListFunctionResourceMappingsCommandInput extends ListFunctionResourceMappingsRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionResourceMappingsCommand}.
 */
export interface ListFunctionResourceMappingsCommandOutput extends ListFunctionResourceMappingsResponse, __MetadataBearer {
}
declare const ListFunctionResourceMappingsCommand_base: {
    new (input: ListFunctionResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionResourceMappingsCommandInput, ListFunctionResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionResourceMappingsCommandInput, ListFunctionResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionResourceMappingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionResourceMappingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionResourceMappingsRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new ListFunctionResourceMappingsCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionResourceMappingsResponse
 * //   ResourceMappings: [ // FunctionResourceMappingList
 * //     "PER_FUNCTION_CONCURRENCY",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionResourceMappingsCommandInput - {@link ListFunctionResourceMappingsCommandInput}
 * @returns {@link ListFunctionResourceMappingsCommandOutput}
 * @see {@link ListFunctionResourceMappingsCommandInput} for command's `input` shape.
 * @see {@link ListFunctionResourceMappingsCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class ListFunctionResourceMappingsCommand extends ListFunctionResourceMappingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionResourceMappingsRequest;
            output: ListFunctionResourceMappingsResponse;
        };
        sdk: {
            input: ListFunctionResourceMappingsCommandInput;
            output: ListFunctionResourceMappingsCommandOutput;
        };
    };
}
