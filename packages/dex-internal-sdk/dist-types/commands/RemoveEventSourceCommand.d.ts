import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RemoveEventSourceRequest } from "../models/models_1";
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
 * The input for {@link RemoveEventSourceCommand}.
 */
export interface RemoveEventSourceCommandInput extends RemoveEventSourceRequest {
}
/**
 * @public
 *
 * The output of {@link RemoveEventSourceCommand}.
 */
export interface RemoveEventSourceCommandOutput extends __MetadataBearer {
}
declare const RemoveEventSourceCommand_base: {
    new (input: RemoveEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<RemoveEventSourceCommandInput, RemoveEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RemoveEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<RemoveEventSourceCommandInput, RemoveEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RemoveEventSourceCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RemoveEventSourceCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RemoveEventSourceRequest
 *   UUID: "STRING_VALUE", // required
 * };
 * const command = new RemoveEventSourceCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param RemoveEventSourceCommandInput - {@link RemoveEventSourceCommandInput}
 * @returns {@link RemoveEventSourceCommandOutput}
 * @see {@link RemoveEventSourceCommandInput} for command's `input` shape.
 * @see {@link RemoveEventSourceCommandOutput} for command's `response` shape.
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
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class RemoveEventSourceCommand extends RemoveEventSourceCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RemoveEventSourceRequest;
            output: {};
        };
        sdk: {
            input: RemoveEventSourceCommandInput;
            output: RemoveEventSourceCommandOutput;
        };
    };
}
