import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { FunctionConfiguration, GetFunctionConfigurationRequest } from "../models/models_0";
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
 * The input for {@link GetFunctionConfigurationCommand}.
 */
export interface GetFunctionConfigurationCommandInput extends GetFunctionConfigurationRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunctionConfigurationCommand}.
 */
export interface GetFunctionConfigurationCommandOutput extends FunctionConfiguration, __MetadataBearer {
}
declare const GetFunctionConfigurationCommand_base: {
    new (input: GetFunctionConfigurationCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionConfigurationCommandInput, GetFunctionConfigurationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunctionConfigurationCommandInput): import("@smithy/smithy-client").CommandImpl<GetFunctionConfigurationCommandInput, GetFunctionConfigurationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunctionConfigurationCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunctionConfigurationCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionConfigurationRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetFunctionConfigurationCommand(input);
 * const response = await client.send(command);
 * // { // FunctionConfiguration
 * //   FunctionName: "STRING_VALUE",
 * //   FunctionARN: "STRING_VALUE",
 * //   ConfigurationId: "STRING_VALUE",
 * //   Runtime: "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //   Role: "STRING_VALUE",
 * //   Handler: "STRING_VALUE",
 * //   Mode: "http" || "event",
 * //   CodeSize: Number("long"),
 * //   Description: "STRING_VALUE",
 * //   Timeout: Number("int"),
 * //   MemorySize: Number("int"),
 * //   LastModified: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetFunctionConfigurationCommandInput - {@link GetFunctionConfigurationCommandInput}
 * @returns {@link GetFunctionConfigurationCommandOutput}
 * @see {@link GetFunctionConfigurationCommandInput} for command's `input` shape.
 * @see {@link GetFunctionConfigurationCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class GetFunctionConfigurationCommand extends GetFunctionConfigurationCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionConfigurationRequest;
            output: FunctionConfiguration;
        };
        sdk: {
            input: GetFunctionConfigurationCommandInput;
            output: GetFunctionConfigurationCommandOutput;
        };
    };
}
