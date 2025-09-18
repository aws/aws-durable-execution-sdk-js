import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListProvisionedConcurrencyConfigsByAccountIdRequest, ListProvisionedConcurrencyConfigsByAccountIdResponse } from "../models/models_1";
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
 * The input for {@link ListProvisionedConcurrencyConfigsByAccountIdCommand}.
 */
export interface ListProvisionedConcurrencyConfigsByAccountIdCommandInput extends ListProvisionedConcurrencyConfigsByAccountIdRequest {
}
/**
 * @public
 *
 * The output of {@link ListProvisionedConcurrencyConfigsByAccountIdCommand}.
 */
export interface ListProvisionedConcurrencyConfigsByAccountIdCommandOutput extends ListProvisionedConcurrencyConfigsByAccountIdResponse, __MetadataBearer {
}
declare const ListProvisionedConcurrencyConfigsByAccountIdCommand_base: {
    new (input: ListProvisionedConcurrencyConfigsByAccountIdCommandInput): import("@smithy/smithy-client").CommandImpl<ListProvisionedConcurrencyConfigsByAccountIdCommandInput, ListProvisionedConcurrencyConfigsByAccountIdCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListProvisionedConcurrencyConfigsByAccountIdCommandInput): import("@smithy/smithy-client").CommandImpl<ListProvisionedConcurrencyConfigsByAccountIdCommandInput, ListProvisionedConcurrencyConfigsByAccountIdCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListProvisionedConcurrencyConfigsByAccountIdCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListProvisionedConcurrencyConfigsByAccountIdCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListProvisionedConcurrencyConfigsByAccountIdRequest
 *   AccountId: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListProvisionedConcurrencyConfigsByAccountIdCommand(input);
 * const response = await client.send(command);
 * // { // ListProvisionedConcurrencyConfigsByAccountIdResponse
 * //   ProvisionedConcurrencyConfigs: [ // ProvisionedConcurrencyConfigList
 * //     { // ProvisionedConcurrencyConfigListItem
 * //       FunctionArn: "STRING_VALUE",
 * //       RequestedProvisionedConcurrentExecutions: Number("int"),
 * //       AllocatedProvisionedConcurrentExecutions: Number("int"),
 * //       Status: "IN_PROGRESS" || "READY" || "FAILED",
 * //       StatusReason: "STRING_VALUE",
 * //       LastModified: "STRING_VALUE",
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListProvisionedConcurrencyConfigsByAccountIdCommandInput - {@link ListProvisionedConcurrencyConfigsByAccountIdCommandInput}
 * @returns {@link ListProvisionedConcurrencyConfigsByAccountIdCommandOutput}
 * @see {@link ListProvisionedConcurrencyConfigsByAccountIdCommandInput} for command's `input` shape.
 * @see {@link ListProvisionedConcurrencyConfigsByAccountIdCommandOutput} for command's `response` shape.
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
export declare class ListProvisionedConcurrencyConfigsByAccountIdCommand extends ListProvisionedConcurrencyConfigsByAccountIdCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListProvisionedConcurrencyConfigsByAccountIdRequest;
            output: ListProvisionedConcurrencyConfigsByAccountIdResponse;
        };
        sdk: {
            input: ListProvisionedConcurrencyConfigsByAccountIdCommandInput;
            output: ListProvisionedConcurrencyConfigsByAccountIdCommandOutput;
        };
    };
}
