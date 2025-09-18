import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListProvisionedConcurrencyConfigsRequest, ListProvisionedConcurrencyConfigsResponse } from "../models/models_1";
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
 * The input for {@link ListProvisionedConcurrencyConfigsCommand}.
 */
export interface ListProvisionedConcurrencyConfigsCommandInput extends ListProvisionedConcurrencyConfigsRequest {
}
/**
 * @public
 *
 * The output of {@link ListProvisionedConcurrencyConfigsCommand}.
 */
export interface ListProvisionedConcurrencyConfigsCommandOutput extends ListProvisionedConcurrencyConfigsResponse, __MetadataBearer {
}
declare const ListProvisionedConcurrencyConfigsCommand_base: {
    new (input: ListProvisionedConcurrencyConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListProvisionedConcurrencyConfigsCommandInput, ListProvisionedConcurrencyConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListProvisionedConcurrencyConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListProvisionedConcurrencyConfigsCommandInput, ListProvisionedConcurrencyConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListProvisionedConcurrencyConfigsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListProvisionedConcurrencyConfigsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListProvisionedConcurrencyConfigsRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListProvisionedConcurrencyConfigsCommand(input);
 * const response = await client.send(command);
 * // { // ListProvisionedConcurrencyConfigsResponse
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
 * @param ListProvisionedConcurrencyConfigsCommandInput - {@link ListProvisionedConcurrencyConfigsCommandInput}
 * @returns {@link ListProvisionedConcurrencyConfigsCommandOutput}
 * @see {@link ListProvisionedConcurrencyConfigsCommandInput} for command's `input` shape.
 * @see {@link ListProvisionedConcurrencyConfigsCommandOutput} for command's `response` shape.
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
export declare class ListProvisionedConcurrencyConfigsCommand extends ListProvisionedConcurrencyConfigsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListProvisionedConcurrencyConfigsRequest;
            output: ListProvisionedConcurrencyConfigsResponse;
        };
        sdk: {
            input: ListProvisionedConcurrencyConfigsCommandInput;
            output: ListProvisionedConcurrencyConfigsCommandOutput;
        };
    };
}
