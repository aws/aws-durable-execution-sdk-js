import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionAliasResourceMappingsRequest, ListFunctionAliasResourceMappingsResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionAliasResourceMappingsCommand}.
 */
export interface ListFunctionAliasResourceMappingsCommandInput extends ListFunctionAliasResourceMappingsRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionAliasResourceMappingsCommand}.
 */
export interface ListFunctionAliasResourceMappingsCommandOutput extends ListFunctionAliasResourceMappingsResponse, __MetadataBearer {
}
declare const ListFunctionAliasResourceMappingsCommand_base: {
    new (input: ListFunctionAliasResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionAliasResourceMappingsCommandInput, ListFunctionAliasResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionAliasResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionAliasResourceMappingsCommandInput, ListFunctionAliasResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionAliasResourceMappingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionAliasResourceMappingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionAliasResourceMappingsRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Alias: "STRING_VALUE", // required
 * };
 * const command = new ListFunctionAliasResourceMappingsCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionAliasResourceMappingsResponse
 * //   ResourceMappings: [ // ResourceMappingList
 * //     "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionAliasResourceMappingsCommandInput - {@link ListFunctionAliasResourceMappingsCommandInput}
 * @returns {@link ListFunctionAliasResourceMappingsCommandOutput}
 * @see {@link ListFunctionAliasResourceMappingsCommandInput} for command's `input` shape.
 * @see {@link ListFunctionAliasResourceMappingsCommandOutput} for command's `response` shape.
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
export declare class ListFunctionAliasResourceMappingsCommand extends ListFunctionAliasResourceMappingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionAliasResourceMappingsRequest;
            output: ListFunctionAliasResourceMappingsResponse;
        };
        sdk: {
            input: ListFunctionAliasResourceMappingsCommandInput;
            output: ListFunctionAliasResourceMappingsCommandOutput;
        };
    };
}
