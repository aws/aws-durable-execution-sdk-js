import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { TagResourceBeforeResourceCreationRequest, TagResourceBeforeResourceCreationResponse } from "../models/models_1";
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
 * The input for {@link TagResourceBeforeResourceCreationCommand}.
 */
export interface TagResourceBeforeResourceCreationCommandInput extends TagResourceBeforeResourceCreationRequest {
}
/**
 * @public
 *
 * The output of {@link TagResourceBeforeResourceCreationCommand}.
 */
export interface TagResourceBeforeResourceCreationCommandOutput extends TagResourceBeforeResourceCreationResponse, __MetadataBearer {
}
declare const TagResourceBeforeResourceCreationCommand_base: {
    new (input: TagResourceBeforeResourceCreationCommandInput): import("@smithy/smithy-client").CommandImpl<TagResourceBeforeResourceCreationCommandInput, TagResourceBeforeResourceCreationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: TagResourceBeforeResourceCreationCommandInput): import("@smithy/smithy-client").CommandImpl<TagResourceBeforeResourceCreationCommandInput, TagResourceBeforeResourceCreationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, TagResourceBeforeResourceCreationCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, TagResourceBeforeResourceCreationCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // TagResourceBeforeResourceCreationRequest
 *   Resource: "STRING_VALUE", // required
 *   Tags: { // Tags // required
 *     "<keys>": "STRING_VALUE",
 *   },
 * };
 * const command = new TagResourceBeforeResourceCreationCommand(input);
 * const response = await client.send(command);
 * // { // TagResourceBeforeResourceCreationResponse
 * //   TagrisExpectedVersion: Number("long"), // required
 * // };
 *
 * ```
 *
 * @param TagResourceBeforeResourceCreationCommandInput - {@link TagResourceBeforeResourceCreationCommandInput}
 * @returns {@link TagResourceBeforeResourceCreationCommandOutput}
 * @see {@link TagResourceBeforeResourceCreationCommandInput} for command's `input` shape.
 * @see {@link TagResourceBeforeResourceCreationCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class TagResourceBeforeResourceCreationCommand extends TagResourceBeforeResourceCreationCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: TagResourceBeforeResourceCreationRequest;
            output: TagResourceBeforeResourceCreationResponse;
        };
        sdk: {
            input: TagResourceBeforeResourceCreationCommandInput;
            output: TagResourceBeforeResourceCreationCommandOutput;
        };
    };
}
