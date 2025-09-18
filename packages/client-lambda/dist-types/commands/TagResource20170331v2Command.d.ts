import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { TagResourceRequest20170331v2 } from "../models/models_1";
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
 * The input for {@link TagResource20170331v2Command}.
 */
export interface TagResource20170331v2CommandInput extends TagResourceRequest20170331v2 {
}
/**
 * @public
 *
 * The output of {@link TagResource20170331v2Command}.
 */
export interface TagResource20170331v2CommandOutput extends __MetadataBearer {
}
declare const TagResource20170331v2Command_base: {
    new (input: TagResource20170331v2CommandInput): import("@smithy/smithy-client").CommandImpl<TagResource20170331v2CommandInput, TagResource20170331v2CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: TagResource20170331v2CommandInput): import("@smithy/smithy-client").CommandImpl<TagResource20170331v2CommandInput, TagResource20170331v2CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, TagResource20170331v2Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, TagResource20170331v2Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // TagResourceRequest20170331v2
 *   Resource: "STRING_VALUE", // required
 *   Tags: { // Tags // required
 *     "<keys>": "STRING_VALUE",
 *   },
 * };
 * const command = new TagResource20170331v2Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param TagResource20170331v2CommandInput - {@link TagResource20170331v2CommandInput}
 * @returns {@link TagResource20170331v2CommandOutput}
 * @see {@link TagResource20170331v2CommandInput} for command's `input` shape.
 * @see {@link TagResource20170331v2CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class TagResource20170331v2Command extends TagResource20170331v2Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: TagResourceRequest20170331v2;
            output: {};
        };
        sdk: {
            input: TagResource20170331v2CommandInput;
            output: TagResource20170331v2CommandOutput;
        };
    };
}
