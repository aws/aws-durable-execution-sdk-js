import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionCountersInternalRequest, ListFunctionCountersInternalResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionCountersInternalCommand}.
 */
export interface ListFunctionCountersInternalCommandInput extends ListFunctionCountersInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionCountersInternalCommand}.
 */
export interface ListFunctionCountersInternalCommandOutput extends ListFunctionCountersInternalResponse, __MetadataBearer {
}
declare const ListFunctionCountersInternalCommand_base: {
    new (input: ListFunctionCountersInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionCountersInternalCommandInput, ListFunctionCountersInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionCountersInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionCountersInternalCommandInput, ListFunctionCountersInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionCountersInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionCountersInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionCountersInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 * };
 * const command = new ListFunctionCountersInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionCountersInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   FunctionCounters: [ // FunctionCountersInternalList
 * //     { // FunctionCounterInternal
 * //       FunctionArn: "STRING_VALUE",
 * //       CurrentVersionNumber: Number("long"),
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionCountersInternalCommandInput - {@link ListFunctionCountersInternalCommandInput}
 * @returns {@link ListFunctionCountersInternalCommandOutput}
 * @see {@link ListFunctionCountersInternalCommandInput} for command's `input` shape.
 * @see {@link ListFunctionCountersInternalCommandOutput} for command's `response` shape.
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
export declare class ListFunctionCountersInternalCommand extends ListFunctionCountersInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionCountersInternalRequest;
            output: ListFunctionCountersInternalResponse;
        };
        sdk: {
            input: ListFunctionCountersInternalCommandInput;
            output: ListFunctionCountersInternalCommandOutput;
        };
    };
}
