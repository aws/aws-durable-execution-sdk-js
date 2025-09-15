import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UntagResourceRequest20170331 } from "../models/models_1";
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
 * The input for {@link UntagResource20170331Command}.
 */
export interface UntagResource20170331CommandInput extends UntagResourceRequest20170331 {
}
/**
 * @public
 *
 * The output of {@link UntagResource20170331Command}.
 */
export interface UntagResource20170331CommandOutput extends __MetadataBearer {
}
declare const UntagResource20170331Command_base: {
    new (input: UntagResource20170331CommandInput): import("@smithy/smithy-client").CommandImpl<UntagResource20170331CommandInput, UntagResource20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UntagResource20170331CommandInput): import("@smithy/smithy-client").CommandImpl<UntagResource20170331CommandInput, UntagResource20170331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UntagResource20170331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UntagResource20170331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UntagResourceRequest20170331
 *   Resource: "STRING_VALUE", // required
 *   TagKeys: { // TagKeys
 *     Items: [ // TagKeyList
 *       "STRING_VALUE",
 *     ],
 *   },
 * };
 * const command = new UntagResource20170331Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param UntagResource20170331CommandInput - {@link UntagResource20170331CommandInput}
 * @returns {@link UntagResource20170331CommandOutput}
 * @see {@link UntagResource20170331CommandInput} for command's `input` shape.
 * @see {@link UntagResource20170331CommandOutput} for command's `response` shape.
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
export declare class UntagResource20170331Command extends UntagResource20170331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UntagResourceRequest20170331;
            output: {};
        };
        sdk: {
            input: UntagResource20170331CommandInput;
            output: UntagResource20170331CommandOutput;
        };
    };
}
