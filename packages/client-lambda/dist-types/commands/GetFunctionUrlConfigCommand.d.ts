import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionUrlConfigRequest, GetFunctionUrlConfigResponse } from "../models/models_0";
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
 * The input for {@link GetFunctionUrlConfigCommand}.
 */
export interface GetFunctionUrlConfigCommandInput extends GetFunctionUrlConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionUrlConfigCommand}.
 */
export interface GetFunctionUrlConfigCommandOutput extends GetFunctionUrlConfigResponse, __MetadataBearer {
}
declare const GetFunctionUrlConfigCommand_base: {
    new (input: GetFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionUrlConfigCommandInput, GetFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionUrlConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionUrlConfigCommandInput, GetFunctionUrlConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionUrlConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionUrlConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionUrlConfigRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetFunctionUrlConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetFunctionUrlConfigResponse
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
 * @param GetFunctionUrlConfigCommandInput - {@link GetFunctionUrlConfigCommandInput}
 * @returns {@link GetFunctionUrlConfigCommandOutput}
 * @see {@link GetFunctionUrlConfigCommandInput} for command's `input` shape.
 * @see {@link GetFunctionUrlConfigCommandOutput} for command's `response` shape.
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
export declare class GetFunctionUrlConfigCommand extends GetFunctionUrlConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionUrlConfigRequest;
            output: GetFunctionUrlConfigResponse;
        };
        sdk: {
            input: GetFunctionUrlConfigCommandInput;
            output: GetFunctionUrlConfigCommandOutput;
        };
    };
}
