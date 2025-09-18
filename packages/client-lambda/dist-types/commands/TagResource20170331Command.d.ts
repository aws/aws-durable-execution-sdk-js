import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { TagResourceRequest20170331, TagResourceResponse20170331 } from "../models/models_1";
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
 * The input for {@link TagResource20170331Command}.
 */
export interface TagResource20170331CommandInput extends TagResourceRequest20170331 {
}
/**
 * @public
 *
 * The output of {@link TagResource20170331Command}.
 */
export interface TagResource20170331CommandOutput extends TagResourceResponse20170331, __MetadataBearer {
}
declare const TagResource20170331Command_base: {
    new (input: TagResource20170331CommandInput): import("@smithy/smithy-client").CommandImpl<TagResource20170331CommandInput, TagResource20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: TagResource20170331CommandInput): import("@smithy/smithy-client").CommandImpl<TagResource20170331CommandInput, TagResource20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, TagResource20170331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, TagResource20170331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // TagResourceRequest20170331
 *   Resource: "STRING_VALUE", // required
 *   Tags: { // TagsInternal
 *     Items: [ // TagList
 *       { // Tag
 *         Key: "STRING_VALUE", // required
 *         Value: "STRING_VALUE",
 *       },
 *     ],
 *   },
 * };
 * const command = new TagResource20170331Command(input);
 * const response = await client.send(command);
 * // { // TagResourceResponse20170331
 * //   Tags: { // TagsInternal
 * //     Items: [ // TagList
 * //       { // Tag
 * //         Key: "STRING_VALUE", // required
 * //         Value: "STRING_VALUE",
 * //       },
 * //     ],
 * //   },
 * // };
 *
 * ```
 *
 * @param TagResource20170331CommandInput - {@link TagResource20170331CommandInput}
 * @returns {@link TagResource20170331CommandOutput}
 * @see {@link TagResource20170331CommandInput} for command's `input` shape.
 * @see {@link TagResource20170331CommandOutput} for command's `response` shape.
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
export declare class TagResource20170331Command extends TagResource20170331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: TagResourceRequest20170331;
            output: TagResourceResponse20170331;
        };
        sdk: {
            input: TagResource20170331CommandInput;
            output: TagResource20170331CommandOutput;
        };
    };
}
