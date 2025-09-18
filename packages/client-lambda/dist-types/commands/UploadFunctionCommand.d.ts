import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { FunctionConfiguration } from "../models/models_0";
import { UploadFunctionRequest } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { BlobPayloadInputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 */
export type UploadFunctionCommandInputType = Omit<UploadFunctionRequest, "FunctionZip"> & {
    FunctionZip: BlobPayloadInputTypes;
};
/**
 * @public
 *
 * The input for {@link UploadFunctionCommand}.
 */
export interface UploadFunctionCommandInput extends UploadFunctionCommandInputType {
}
/**
 * @public
 *
 * The output of {@link UploadFunctionCommand}.
 */
export interface UploadFunctionCommandOutput extends FunctionConfiguration, __MetadataBearer {
}
declare const UploadFunctionCommand_base: {
    new (input: UploadFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<UploadFunctionCommandInput, UploadFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UploadFunctionCommandInput): import("@smithy/smithy-client").CommandImpl<UploadFunctionCommandInput, UploadFunctionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UploadFunctionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UploadFunctionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UploadFunctionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   FunctionZip: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")   // required
 *   Runtime: "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023", // required
 *   Role: "STRING_VALUE", // required
 *   Handler: "STRING_VALUE", // required
 *   Mode: "http" || "event", // required
 *   Description: "STRING_VALUE",
 *   Timeout: Number("int"),
 *   MemorySize: Number("int"),
 * };
 * const command = new UploadFunctionCommand(input);
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
 * @param UploadFunctionCommandInput - {@link UploadFunctionCommandInput}
 * @returns {@link UploadFunctionCommandOutput}
 * @see {@link UploadFunctionCommandInput} for command's `input` shape.
 * @see {@link UploadFunctionCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CodeStorageExceededException} (client fault)
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
export declare class UploadFunctionCommand extends UploadFunctionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UploadFunctionRequest;
            output: FunctionConfiguration;
        };
        sdk: {
            input: UploadFunctionCommandInput;
            output: UploadFunctionCommandOutput;
        };
    };
}
