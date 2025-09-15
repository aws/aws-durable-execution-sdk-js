import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { FunctionEventInvokeConfig } from "../models/models_0";
import { UpdateFunctionEventInvokeConfigRequest } from "../models/models_1";
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
 * The input for {@link UpdateFunctionEventInvokeConfigCommand}.
 */
export interface UpdateFunctionEventInvokeConfigCommandInput extends UpdateFunctionEventInvokeConfigRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateFunctionEventInvokeConfigCommand}.
 */
export interface UpdateFunctionEventInvokeConfigCommandOutput extends FunctionEventInvokeConfig, __MetadataBearer {
}
declare const UpdateFunctionEventInvokeConfigCommand_base: {
    new (input: UpdateFunctionEventInvokeConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionEventInvokeConfigCommandInput, UpdateFunctionEventInvokeConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateFunctionEventInvokeConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionEventInvokeConfigCommandInput, UpdateFunctionEventInvokeConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateFunctionEventInvokeConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateFunctionEventInvokeConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateFunctionEventInvokeConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   MaximumRetryAttempts: Number("int"),
 *   MaximumEventAgeInSeconds: Number("int"),
 *   DestinationConfig: { // DestinationConfig
 *     OnSuccess: { // OnSuccess
 *       Destination: "STRING_VALUE",
 *     },
 *     OnFailure: { // OnFailure
 *       Destination: "STRING_VALUE",
 *     },
 *   },
 * };
 * const command = new UpdateFunctionEventInvokeConfigCommand(input);
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
 * @param UpdateFunctionEventInvokeConfigCommandInput - {@link UpdateFunctionEventInvokeConfigCommandInput}
 * @returns {@link UpdateFunctionEventInvokeConfigCommandOutput}
 * @see {@link UpdateFunctionEventInvokeConfigCommandInput} for command's `input` shape.
 * @see {@link UpdateFunctionEventInvokeConfigCommandOutput} for command's `response` shape.
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
export declare class UpdateFunctionEventInvokeConfigCommand extends UpdateFunctionEventInvokeConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateFunctionEventInvokeConfigRequest;
            output: FunctionEventInvokeConfig;
        };
        sdk: {
            input: UpdateFunctionEventInvokeConfigCommandInput;
            output: UpdateFunctionEventInvokeConfigCommandOutput;
        };
    };
}
