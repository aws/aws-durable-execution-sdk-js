import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListTagsRequest20170331, ListTagsResponse20170331 } from "../models/models_1";
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
 * The input for {@link ListTags20170331Command}.
 */
export interface ListTags20170331CommandInput extends ListTagsRequest20170331 {
}
/**
 * @public
 *
 * The output of {@link ListTags20170331Command}.
 */
export interface ListTags20170331CommandOutput extends ListTagsResponse20170331, __MetadataBearer {
}
declare const ListTags20170331Command_base: {
    new (input: ListTags20170331CommandInput): import("@smithy/smithy-client").CommandImpl<ListTags20170331CommandInput, ListTags20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListTags20170331CommandInput): import("@smithy/smithy-client").CommandImpl<ListTags20170331CommandInput, ListTags20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListTags20170331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListTags20170331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListTagsRequest20170331
 *   Resource: "STRING_VALUE", // required
 * };
 * const command = new ListTags20170331Command(input);
 * const response = await client.send(command);
 * // { // ListTagsResponse20170331
 * //   Tags: { // Tags
 * //     "<keys>": "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param ListTags20170331CommandInput - {@link ListTags20170331CommandInput}
 * @returns {@link ListTags20170331CommandOutput}
 * @see {@link ListTags20170331CommandInput} for command's `input` shape.
 * @see {@link ListTags20170331CommandOutput} for command's `response` shape.
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
export declare class ListTags20170331Command extends ListTags20170331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListTagsRequest20170331;
            output: ListTagsResponse20170331;
        };
        sdk: {
            input: ListTags20170331CommandInput;
            output: ListTags20170331CommandOutput;
        };
    };
}
