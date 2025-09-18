import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListEventSourceMappingsInternalRequest, ListEventSourceMappingsInternalResponse } from "../models/models_1";
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
 * The input for {@link ListEventSourceMappingsInternalCommand}.
 */
export interface ListEventSourceMappingsInternalCommandInput extends ListEventSourceMappingsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListEventSourceMappingsInternalCommand}.
 */
export interface ListEventSourceMappingsInternalCommandOutput extends ListEventSourceMappingsInternalResponse, __MetadataBearer {
}
declare const ListEventSourceMappingsInternalCommand_base: {
    new (input: ListEventSourceMappingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListEventSourceMappingsInternalCommandInput, ListEventSourceMappingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListEventSourceMappingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListEventSourceMappingsInternalCommandInput, ListEventSourceMappingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListEventSourceMappingsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListEventSourceMappingsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListEventSourceMappingsInternalRequest
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 *   AccountId: "STRING_VALUE", // required
 * };
 * const command = new ListEventSourceMappingsInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListEventSourceMappingsInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   EventSourceMappings: [ // EventSourceMappingsInternalList
 * //     { // EventSourceMappingInternalConfiguration
 * //       EventSourceMappingArn: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListEventSourceMappingsInternalCommandInput - {@link ListEventSourceMappingsInternalCommandInput}
 * @returns {@link ListEventSourceMappingsInternalCommandOutput}
 * @see {@link ListEventSourceMappingsInternalCommandInput} for command's `input` shape.
 * @see {@link ListEventSourceMappingsInternalCommandOutput} for command's `response` shape.
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
export declare class ListEventSourceMappingsInternalCommand extends ListEventSourceMappingsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListEventSourceMappingsInternalRequest;
            output: ListEventSourceMappingsInternalResponse;
        };
        sdk: {
            input: ListEventSourceMappingsInternalCommandInput;
            output: ListEventSourceMappingsInternalCommandOutput;
        };
    };
}
