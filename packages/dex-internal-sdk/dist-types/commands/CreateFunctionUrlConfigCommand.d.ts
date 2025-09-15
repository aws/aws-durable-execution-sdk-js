import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { CreateFunctionUrlConfigRequest, CreateFunctionUrlConfigResponse } from "../models/models_0";
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
 * The input for {@link CreateFunctionUrlConfigCommand}.
 */
export interface CreateFunctionUrlConfigCommandInput extends CreateFunctionUrlConfigRequest {
}
/**
 * @public
 *
 * The output of {@link CreateFunctionUrlConfigCommand}.
 */
export interface CreateFunctionUrlConfigCommandOutput extends CreateFunctionUrlConfigResponse, __MetadataBearer {
}
declare const CreateFunctionUrlConfigCommand_base: {
    new (input: CreateFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<CreateFunctionUrlConfigCommandInput, CreateFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: CreateFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<CreateFunctionUrlConfigCommandInput, CreateFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, CreateFunctionUrlConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, CreateFunctionUrlConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // CreateFunctionUrlConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   AuthType: "NONE" || "AWS_IAM", // required
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
 * const command = new CreateFunctionUrlConfigCommand(input);
 * const response = await client.send(command);
 * // { // CreateFunctionUrlConfigResponse
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
 * //   InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 * // };
 *
 * ```
 *
 * @param CreateFunctionUrlConfigCommandInput - {@link CreateFunctionUrlConfigCommandInput}
 * @returns {@link CreateFunctionUrlConfigCommandOutput}
 * @see {@link CreateFunctionUrlConfigCommandInput} for command's `input` shape.
 * @see {@link CreateFunctionUrlConfigCommandOutput} for command's `response` shape.
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
export declare class CreateFunctionUrlConfigCommand extends CreateFunctionUrlConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: CreateFunctionUrlConfigRequest;
            output: CreateFunctionUrlConfigResponse;
        };
        sdk: {
            input: CreateFunctionUrlConfigCommandInput;
            output: CreateFunctionUrlConfigCommandOutput;
        };
    };
}
