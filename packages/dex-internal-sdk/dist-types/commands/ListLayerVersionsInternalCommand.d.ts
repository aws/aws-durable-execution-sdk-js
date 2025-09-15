import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListLayerVersionsInternalRequest, ListLayerVersionsInternalResponse } from "../models/models_1";
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
 * The input for {@link ListLayerVersionsInternalCommand}.
 */
export interface ListLayerVersionsInternalCommandInput extends ListLayerVersionsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListLayerVersionsInternalCommand}.
 */
export interface ListLayerVersionsInternalCommandOutput extends ListLayerVersionsInternalResponse, __MetadataBearer {
}
declare const ListLayerVersionsInternalCommand_base: {
    new (input: ListLayerVersionsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListLayerVersionsInternalCommandInput, ListLayerVersionsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListLayerVersionsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListLayerVersionsInternalCommandInput, ListLayerVersionsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListLayerVersionsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListLayerVersionsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListLayerVersionsInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListLayerVersionsInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListLayerVersionsInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   LayerVersionArns: [ // LayerVersionArns
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListLayerVersionsInternalCommandInput - {@link ListLayerVersionsInternalCommandInput}
 * @returns {@link ListLayerVersionsInternalCommandOutput}
 * @see {@link ListLayerVersionsInternalCommandInput} for command's `input` shape.
 * @see {@link ListLayerVersionsInternalCommandOutput} for command's `response` shape.
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
export declare class ListLayerVersionsInternalCommand extends ListLayerVersionsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListLayerVersionsInternalRequest;
            output: ListLayerVersionsInternalResponse;
        };
        sdk: {
            input: ListLayerVersionsInternalCommandInput;
            output: ListLayerVersionsInternalCommandOutput;
        };
    };
}
