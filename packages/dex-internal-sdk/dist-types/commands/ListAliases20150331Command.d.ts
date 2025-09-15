import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListAliasesRequest20150331, ListAliasesResponse20150331 } from "../models/models_1";
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
 * The input for {@link ListAliases20150331Command}.
 */
export interface ListAliases20150331CommandInput extends ListAliasesRequest20150331 {
}
/**
 * @public
 *
 * The output of {@link ListAliases20150331Command}.
 */
export interface ListAliases20150331CommandOutput extends ListAliasesResponse20150331, __MetadataBearer {
}
declare const ListAliases20150331Command_base: {
    new (input: ListAliases20150331CommandInput): import("@smithy/smithy-client").CommandImpl<ListAliases20150331CommandInput, ListAliases20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListAliases20150331CommandInput): import("@smithy/smithy-client").CommandImpl<ListAliases20150331CommandInput, ListAliases20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListAliases20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListAliases20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListAliasesRequest20150331
 *   FunctionName: "STRING_VALUE", // required
 *   FunctionVersion: "STRING_VALUE",
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListAliases20150331Command(input);
 * const response = await client.send(command);
 * // { // ListAliasesResponse20150331
 * //   NextMarker: "STRING_VALUE",
 * //   Aliases: [ // AliasList20150331
 * //     { // AliasConfiguration20150331
 * //       AliasArn: "STRING_VALUE",
 * //       Name: "STRING_VALUE",
 * //       FunctionVersion: "STRING_VALUE",
 * //       Description: "STRING_VALUE",
 * //       RoutingConfig: { // AliasRoutingConfiguration
 * //         AdditionalVersionWeights: { // AdditionalVersionWeights
 * //           "<keys>": Number("double"),
 * //         },
 * //       },
 * //       RevisionId: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListAliases20150331CommandInput - {@link ListAliases20150331CommandInput}
 * @returns {@link ListAliases20150331CommandOutput}
 * @see {@link ListAliases20150331CommandInput} for command's `input` shape.
 * @see {@link ListAliases20150331CommandOutput} for command's `response` shape.
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
export declare class ListAliases20150331Command extends ListAliases20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListAliasesRequest20150331;
            output: ListAliasesResponse20150331;
        };
        sdk: {
            input: ListAliases20150331CommandInput;
            output: ListAliases20150331CommandOutput;
        };
    };
}
