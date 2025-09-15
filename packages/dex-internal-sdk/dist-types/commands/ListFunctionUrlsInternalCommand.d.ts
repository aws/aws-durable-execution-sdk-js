import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionUrlsInternalRequest, ListFunctionUrlsInternalResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionUrlsInternalCommand}.
 */
export interface ListFunctionUrlsInternalCommandInput extends ListFunctionUrlsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionUrlsInternalCommand}.
 */
export interface ListFunctionUrlsInternalCommandOutput extends ListFunctionUrlsInternalResponse, __MetadataBearer {
}
declare const ListFunctionUrlsInternalCommand_base: {
    new (input: ListFunctionUrlsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionUrlsInternalCommandInput, ListFunctionUrlsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionUrlsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionUrlsInternalCommandInput, ListFunctionUrlsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionUrlsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionUrlsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionUrlsInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListFunctionUrlsInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionUrlsInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   FunctionUrls: [ // FunctionUrlsInternalList
 * //     { // FunctionUrlInternal
 * //       FunctionUrl: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionUrlsInternalCommandInput - {@link ListFunctionUrlsInternalCommandInput}
 * @returns {@link ListFunctionUrlsInternalCommandOutput}
 * @see {@link ListFunctionUrlsInternalCommandInput} for command's `input` shape.
 * @see {@link ListFunctionUrlsInternalCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class ListFunctionUrlsInternalCommand extends ListFunctionUrlsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionUrlsInternalRequest;
            output: ListFunctionUrlsInternalResponse;
        };
        sdk: {
            input: ListFunctionUrlsInternalCommandInput;
            output: ListFunctionUrlsInternalCommandOutput;
        };
    };
}
