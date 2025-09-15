import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { OldAddEventSourceRequest, OldEventSourceConfiguration } from "../models/models_0";
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
 * The input for {@link AddEventSourceCommand}.
 */
export interface AddEventSourceCommandInput extends OldAddEventSourceRequest {
}
/**
 * @public
 *
 * The output of {@link AddEventSourceCommand}.
 */
export interface AddEventSourceCommandOutput extends OldEventSourceConfiguration, __MetadataBearer {
}
declare const AddEventSourceCommand_base: {
    new (input: AddEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<AddEventSourceCommandInput, AddEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: AddEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<AddEventSourceCommandInput, AddEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, AddEventSourceCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, AddEventSourceCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // OldAddEventSourceRequest
 *   EventSource: "STRING_VALUE", // required
 *   FunctionName: "STRING_VALUE", // required
 *   Role: "STRING_VALUE", // required
 *   BatchSize: Number("int"),
 *   Parameters: { // Map
 *     "<keys>": "STRING_VALUE",
 *   },
 * };
 * const command = new AddEventSourceCommand(input);
 * const response = await client.send(command);
 * // { // OldEventSourceConfiguration
 * //   UUID: "STRING_VALUE",
 * //   BatchSize: Number("int"),
 * //   EventSource: "STRING_VALUE",
 * //   FunctionName: "STRING_VALUE",
 * //   Parameters: { // Map
 * //     "<keys>": "STRING_VALUE",
 * //   },
 * //   Role: "STRING_VALUE",
 * //   LastModified: "STRING_VALUE",
 * //   IsActive: "STRING_VALUE",
 * //   Status: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param AddEventSourceCommandInput - {@link AddEventSourceCommandInput}
 * @returns {@link AddEventSourceCommandOutput}
 * @see {@link AddEventSourceCommandInput} for command's `input` shape.
 * @see {@link AddEventSourceCommandOutput} for command's `response` shape.
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
export declare class AddEventSourceCommand extends AddEventSourceCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: OldAddEventSourceRequest;
            output: OldEventSourceConfiguration;
        };
        sdk: {
            input: AddEventSourceCommandInput;
            output: AddEventSourceCommandOutput;
        };
    };
}
