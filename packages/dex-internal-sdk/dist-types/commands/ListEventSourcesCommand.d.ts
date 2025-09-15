import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { OldListEventSourcesRequest, OldListEventSourcesResponse } from "../models/models_1";
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
 * The input for {@link ListEventSourcesCommand}.
 */
export interface ListEventSourcesCommandInput extends OldListEventSourcesRequest {
}
/**
 * @public
 *
 * The output of {@link ListEventSourcesCommand}.
 */
export interface ListEventSourcesCommandOutput extends OldListEventSourcesResponse, __MetadataBearer {
}
declare const ListEventSourcesCommand_base: {
    new (input: ListEventSourcesCommandInput): import("@smithy/smithy-client").CommandImpl<ListEventSourcesCommandInput, ListEventSourcesCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [ListEventSourcesCommandInput]): import("@smithy/smithy-client").CommandImpl<ListEventSourcesCommandInput, ListEventSourcesCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListEventSourcesCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListEventSourcesCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // OldListEventSourcesRequest
 *   EventSourceArn: "STRING_VALUE",
 *   FunctionName: "STRING_VALUE",
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListEventSourcesCommand(input);
 * const response = await client.send(command);
 * // { // OldListEventSourcesResponse
 * //   NextMarker: "STRING_VALUE",
 * //   EventSources: [ // OldEventSourceList
 * //     { // OldEventSourceConfiguration
 * //       UUID: "STRING_VALUE",
 * //       BatchSize: Number("int"),
 * //       EventSource: "STRING_VALUE",
 * //       FunctionName: "STRING_VALUE",
 * //       Parameters: { // Map
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //       Role: "STRING_VALUE",
 * //       LastModified: "STRING_VALUE",
 * //       IsActive: "STRING_VALUE",
 * //       Status: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListEventSourcesCommandInput - {@link ListEventSourcesCommandInput}
 * @returns {@link ListEventSourcesCommandOutput}
 * @see {@link ListEventSourcesCommandInput} for command's `input` shape.
 * @see {@link ListEventSourcesCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class ListEventSourcesCommand extends ListEventSourcesCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: OldListEventSourcesRequest;
            output: OldListEventSourcesResponse;
        };
        sdk: {
            input: ListEventSourcesCommandInput;
            output: ListEventSourcesCommandOutput;
        };
    };
}
