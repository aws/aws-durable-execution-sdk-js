import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RedriveFunctionResourceTagsRequest, RedriveFunctionResourceTagsResponse } from "../models/models_1";
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
 * The input for {@link RedriveFunctionResourceTagsCommand}.
 */
export interface RedriveFunctionResourceTagsCommandInput extends RedriveFunctionResourceTagsRequest {
}
/**
 * @public
 *
 * The output of {@link RedriveFunctionResourceTagsCommand}.
 */
export interface RedriveFunctionResourceTagsCommandOutput extends RedriveFunctionResourceTagsResponse, __MetadataBearer {
}
declare const RedriveFunctionResourceTagsCommand_base: {
    new (input: RedriveFunctionResourceTagsCommandInput): import("@smithy/smithy-client").CommandImpl<RedriveFunctionResourceTagsCommandInput, RedriveFunctionResourceTagsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RedriveFunctionResourceTagsCommandInput): import("@smithy/smithy-client").CommandImpl<RedriveFunctionResourceTagsCommandInput, RedriveFunctionResourceTagsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RedriveFunctionResourceTagsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RedriveFunctionResourceTagsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RedriveFunctionResourceTagsRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new RedriveFunctionResourceTagsCommand(input);
 * const response = await client.send(command);
 * // { // RedriveFunctionResourceTagsResponse
 * //   Terminated: true || false,
 * //   ValidationToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param RedriveFunctionResourceTagsCommandInput - {@link RedriveFunctionResourceTagsCommandInput}
 * @returns {@link RedriveFunctionResourceTagsCommandOutput}
 * @see {@link RedriveFunctionResourceTagsCommandInput} for command's `input` shape.
 * @see {@link RedriveFunctionResourceTagsCommandOutput} for command's `response` shape.
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
export declare class RedriveFunctionResourceTagsCommand extends RedriveFunctionResourceTagsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RedriveFunctionResourceTagsRequest;
            output: RedriveFunctionResourceTagsResponse;
        };
        sdk: {
            input: RedriveFunctionResourceTagsCommandInput;
            output: RedriveFunctionResourceTagsCommandOutput;
        };
    };
}
