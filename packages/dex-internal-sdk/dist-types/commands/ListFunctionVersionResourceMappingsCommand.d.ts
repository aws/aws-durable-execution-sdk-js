import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionVersionResourceMappingsRequest, ListFunctionVersionResourceMappingsResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionVersionResourceMappingsCommand}.
 */
export interface ListFunctionVersionResourceMappingsCommandInput extends ListFunctionVersionResourceMappingsRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionVersionResourceMappingsCommand}.
 */
export interface ListFunctionVersionResourceMappingsCommandOutput extends ListFunctionVersionResourceMappingsResponse, __MetadataBearer {
}
declare const ListFunctionVersionResourceMappingsCommand_base: {
    new (input: ListFunctionVersionResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionVersionResourceMappingsCommandInput, ListFunctionVersionResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionVersionResourceMappingsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionVersionResourceMappingsCommandInput, ListFunctionVersionResourceMappingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionVersionResourceMappingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionVersionResourceMappingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionVersionResourceMappingsRequest
 *   FunctionArn: "STRING_VALUE", // required
 *   Version: "STRING_VALUE", // required
 * };
 * const command = new ListFunctionVersionResourceMappingsCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionVersionResourceMappingsResponse
 * //   ResourceMappings: [ // ResourceMappingList
 * //     "PROVISIONED_CONCURRENCY" || "CODE_ARTIFACT",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionVersionResourceMappingsCommandInput - {@link ListFunctionVersionResourceMappingsCommandInput}
 * @returns {@link ListFunctionVersionResourceMappingsCommandOutput}
 * @see {@link ListFunctionVersionResourceMappingsCommandInput} for command's `input` shape.
 * @see {@link ListFunctionVersionResourceMappingsCommandOutput} for command's `response` shape.
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
export declare class ListFunctionVersionResourceMappingsCommand extends ListFunctionVersionResourceMappingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionVersionResourceMappingsRequest;
            output: ListFunctionVersionResourceMappingsResponse;
        };
        sdk: {
            input: ListFunctionVersionResourceMappingsCommandInput;
            output: ListFunctionVersionResourceMappingsCommandOutput;
        };
    };
}
