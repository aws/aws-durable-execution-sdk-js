import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { FunctionEventInvokeConfig, GetFunctionEventInvokeConfigRequest } from "../models/models_0";
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
 * The input for {@link GetFunctionEventInvokeConfigCommand}.
 */
export interface GetFunctionEventInvokeConfigCommandInput extends GetFunctionEventInvokeConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionEventInvokeConfigCommand}.
 */
export interface GetFunctionEventInvokeConfigCommandOutput extends FunctionEventInvokeConfig, __MetadataBearer {
}
declare const GetFunctionEventInvokeConfigCommand_base: {
    new (input: GetFunctionEventInvokeConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionEventInvokeConfigCommandInput, GetFunctionEventInvokeConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionEventInvokeConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionEventInvokeConfigCommandInput, GetFunctionEventInvokeConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionEventInvokeConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionEventInvokeConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionEventInvokeConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetFunctionEventInvokeConfigCommand(input);
 * const response = await client.send(command);
 * // { // FunctionEventInvokeConfig
 * //   LastModified: new Date("TIMESTAMP"),
 * //   FunctionArn: "STRING_VALUE",
 * //   MaximumRetryAttempts: Number("int"),
 * //   MaximumEventAgeInSeconds: Number("int"),
 * //   DestinationConfig: { // DestinationConfig
 * //     OnSuccess: { // OnSuccess
 * //       Destination: "STRING_VALUE",
 * //     },
 * //     OnFailure: { // OnFailure
 * //       Destination: "STRING_VALUE",
 * //     },
 * //   },
 * // };
 *
 * ```
 *
 * @param GetFunctionEventInvokeConfigCommandInput - {@link GetFunctionEventInvokeConfigCommandInput}
 * @returns {@link GetFunctionEventInvokeConfigCommandOutput}
 * @see {@link GetFunctionEventInvokeConfigCommandInput} for command's `input` shape.
 * @see {@link GetFunctionEventInvokeConfigCommandOutput} for command's `response` shape.
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
export declare class GetFunctionEventInvokeConfigCommand extends GetFunctionEventInvokeConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionEventInvokeConfigRequest;
            output: FunctionEventInvokeConfig;
        };
        sdk: {
            input: GetFunctionEventInvokeConfigCommandInput;
            output: GetFunctionEventInvokeConfigCommandOutput;
        };
    };
}
