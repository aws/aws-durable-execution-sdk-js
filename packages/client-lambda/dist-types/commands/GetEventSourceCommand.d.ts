import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { OldEventSourceConfiguration, OldGetEventSourceRequest } from "../models/models_0";
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
 * The input for {@link GetEventSourceCommand}.
 */
export interface GetEventSourceCommandInput extends OldGetEventSourceRequest {
}
/**
 * @public
 *
 * The output of {@link GetEventSourceCommand}.
 */
export interface GetEventSourceCommandOutput extends OldEventSourceConfiguration, __MetadataBearer {
}
declare const GetEventSourceCommand_base: {
    new (input: GetEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<GetEventSourceCommandInput, GetEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetEventSourceCommandInput): import("@smithy/smithy-client").CommandImpl<GetEventSourceCommandInput, GetEventSourceCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetEventSourceCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetEventSourceCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // OldGetEventSourceRequest
 *   UUID: "STRING_VALUE", // required
 * };
 * const command = new GetEventSourceCommand(input);
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
 * @param GetEventSourceCommandInput - {@link GetEventSourceCommandInput}
 * @returns {@link GetEventSourceCommandOutput}
 * @see {@link GetEventSourceCommandInput} for command's `input` shape.
 * @see {@link GetEventSourceCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class GetEventSourceCommand extends GetEventSourceCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: OldGetEventSourceRequest;
            output: OldEventSourceConfiguration;
        };
        sdk: {
            input: GetEventSourceCommandInput;
            output: GetEventSourceCommandOutput;
        };
    };
}
