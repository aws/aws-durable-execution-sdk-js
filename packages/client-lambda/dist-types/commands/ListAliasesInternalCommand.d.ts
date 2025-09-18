import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListAliasesInternalRequest, ListAliasesInternalResponse } from "../models/models_1";
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
 * The input for {@link ListAliasesInternalCommand}.
 */
export interface ListAliasesInternalCommandInput extends ListAliasesInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListAliasesInternalCommand}.
 */
export interface ListAliasesInternalCommandOutput extends ListAliasesInternalResponse, __MetadataBearer {
}
declare const ListAliasesInternalCommand_base: {
    new (input: ListAliasesInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListAliasesInternalCommandInput, ListAliasesInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListAliasesInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListAliasesInternalCommandInput, ListAliasesInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListAliasesInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListAliasesInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListAliasesInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 * };
 * const command = new ListAliasesInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListAliasesInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   Aliases: [ // AliasesInternalList
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListAliasesInternalCommandInput - {@link ListAliasesInternalCommandInput}
 * @returns {@link ListAliasesInternalCommandOutput}
 * @see {@link ListAliasesInternalCommandInput} for command's `input` shape.
 * @see {@link ListAliasesInternalCommandOutput} for command's `response` shape.
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
export declare class ListAliasesInternalCommand extends ListAliasesInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListAliasesInternalRequest;
            output: ListAliasesInternalResponse;
        };
        sdk: {
            input: ListAliasesInternalCommandInput;
            output: ListAliasesInternalCommandOutput;
        };
    };
}
