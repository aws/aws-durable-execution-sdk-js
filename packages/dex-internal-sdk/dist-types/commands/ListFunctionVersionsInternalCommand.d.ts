import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionVersionsInternalRequest, ListFunctionVersionsInternalResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionVersionsInternalCommand}.
 */
export interface ListFunctionVersionsInternalCommandInput extends ListFunctionVersionsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionVersionsInternalCommand}.
 */
export interface ListFunctionVersionsInternalCommandOutput extends ListFunctionVersionsInternalResponse, __MetadataBearer {
}
declare const ListFunctionVersionsInternalCommand_base: {
    new (input: ListFunctionVersionsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionVersionsInternalCommandInput, ListFunctionVersionsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionVersionsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionVersionsInternalCommandInput, ListFunctionVersionsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionVersionsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionVersionsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionVersionsInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 * };
 * const command = new ListFunctionVersionsInternalCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionVersionsInternalResponse
 * //   NextMarker: "STRING_VALUE",
 * //   FunctionVersions: [ // FunctionVersionsInternalList
 * //     { // FunctionVersionInternal
 * //       FunctionArn: "STRING_VALUE",
 * //       State: "Pending" || "Active" || "Inactive" || "Failed" || "Deactivating" || "Deactivated" || "ActiveNonInvocable" || "Deleting",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionVersionsInternalCommandInput - {@link ListFunctionVersionsInternalCommandInput}
 * @returns {@link ListFunctionVersionsInternalCommandOutput}
 * @see {@link ListFunctionVersionsInternalCommandInput} for command's `input` shape.
 * @see {@link ListFunctionVersionsInternalCommandOutput} for command's `response` shape.
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
export declare class ListFunctionVersionsInternalCommand extends ListFunctionVersionsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionVersionsInternalRequest;
            output: ListFunctionVersionsInternalResponse;
        };
        sdk: {
            input: ListFunctionVersionsInternalCommandInput;
            output: ListFunctionVersionsInternalCommandOutput;
        };
    };
}
