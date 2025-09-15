import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateFunctionUrlConfigRequest, UpdateFunctionUrlConfigResponse } from "../models/models_1";
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
 * The input for {@link UpdateFunctionUrlConfigCommand}.
 */
export interface UpdateFunctionUrlConfigCommandInput extends UpdateFunctionUrlConfigRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateFunctionUrlConfigCommand}.
 */
export interface UpdateFunctionUrlConfigCommandOutput extends UpdateFunctionUrlConfigResponse, __MetadataBearer {
}
declare const UpdateFunctionUrlConfigCommand_base: {
    new (input: UpdateFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionUrlConfigCommandInput, UpdateFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateFunctionUrlConfigCommandInput, UpdateFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateFunctionUrlConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateFunctionUrlConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateFunctionUrlConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   AuthType: "NONE" || "AWS_IAM",
 *   Cors: { // Cors
 *     AllowCredentials: true || false,
 *     AllowHeaders: [ // HeadersList
 *       "STRING_VALUE",
 *     ],
 *     AllowMethods: [ // AllowMethodsList
 *       "STRING_VALUE",
 *     ],
 *     AllowOrigins: [ // AllowOriginsList
 *       "STRING_VALUE",
 *     ],
 *     ExposeHeaders: [
 *       "STRING_VALUE",
 *     ],
 *     MaxAge: Number("int"),
 *   },
 *   InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 * };
 * const command = new UpdateFunctionUrlConfigCommand(input);
 * const response = await client.send(command);
 * // { // UpdateFunctionUrlConfigResponse
 * //   FunctionUrl: "STRING_VALUE", // required
 * //   FunctionArn: "STRING_VALUE", // required
 * //   AuthType: "NONE" || "AWS_IAM", // required
 * //   Cors: { // Cors
 * //     AllowCredentials: true || false,
 * //     AllowHeaders: [ // HeadersList
 * //       "STRING_VALUE",
 * //     ],
 * //     AllowMethods: [ // AllowMethodsList
 * //       "STRING_VALUE",
 * //     ],
 * //     AllowOrigins: [ // AllowOriginsList
 * //       "STRING_VALUE",
 * //     ],
 * //     ExposeHeaders: [
 * //       "STRING_VALUE",
 * //     ],
 * //     MaxAge: Number("int"),
 * //   },
 * //   CreationTime: "STRING_VALUE", // required
 * //   LastModifiedTime: "STRING_VALUE", // required
 * //   InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 * // };
 *
 * ```
 *
 * @param UpdateFunctionUrlConfigCommandInput - {@link UpdateFunctionUrlConfigCommandInput}
 * @returns {@link UpdateFunctionUrlConfigCommandOutput}
 * @see {@link UpdateFunctionUrlConfigCommandInput} for command's `input` shape.
 * @see {@link UpdateFunctionUrlConfigCommandOutput} for command's `response` shape.
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
export declare class UpdateFunctionUrlConfigCommand extends UpdateFunctionUrlConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateFunctionUrlConfigRequest;
            output: UpdateFunctionUrlConfigResponse;
        };
        sdk: {
            input: UpdateFunctionUrlConfigCommandInput;
            output: UpdateFunctionUrlConfigCommandOutput;
        };
    };
}
