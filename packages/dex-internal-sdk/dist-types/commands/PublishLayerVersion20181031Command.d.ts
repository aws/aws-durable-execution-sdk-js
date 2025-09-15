import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PublishLayerVersionRequest20181031, PublishLayerVersionResponse20181031 } from "../models/models_1";
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
 * The input for {@link PublishLayerVersion20181031Command}.
 */
export interface PublishLayerVersion20181031CommandInput extends PublishLayerVersionRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link PublishLayerVersion20181031Command}.
 */
export interface PublishLayerVersion20181031CommandOutput extends PublishLayerVersionResponse20181031, __MetadataBearer {
}
declare const PublishLayerVersion20181031Command_base: {
    new (input: PublishLayerVersion20181031CommandInput): import("@smithy/smithy-client").CommandImpl<PublishLayerVersion20181031CommandInput, PublishLayerVersion20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PublishLayerVersion20181031CommandInput): import("@smithy/smithy-client").CommandImpl<PublishLayerVersion20181031CommandInput, PublishLayerVersion20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PublishLayerVersion20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PublishLayerVersion20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PublishLayerVersionRequest20181031
 *   LayerName: "STRING_VALUE", // required
 *   Description: "STRING_VALUE",
 *   Content: { // LayerVersionContentInput20181031
 *     S3Bucket: "STRING_VALUE",
 *     S3Key: "STRING_VALUE",
 *     S3ObjectVersion: "STRING_VALUE",
 *     ZipFile: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 *     DirectUploadLayerCodeTempPath: { // DirectUploadLayerCodeTempPath
 *       bucketName: "STRING_VALUE",
 *       key: "STRING_VALUE",
 *     },
 *   },
 *   CompatibleArchitectures: [ // CompatibleArchitectures
 *     "x86_64" || "arm64",
 *   ],
 *   CompatibleRuntimes: [ // CompatibleRuntimes
 *     "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 *   ],
 *   LicenseInfo: "STRING_VALUE",
 *   FasCredentials: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 * };
 * const command = new PublishLayerVersion20181031Command(input);
 * const response = await client.send(command);
 * // { // PublishLayerVersionResponse20181031
 * //   Content: { // LayerVersionContentOutput20181031
 * //     Location: "STRING_VALUE",
 * //     CodeSha256: "STRING_VALUE",
 * //     CodeSize: Number("long"),
 * //     UncompressedCodeSize: Number("long"),
 * //     SigningProfileVersionArn: "STRING_VALUE",
 * //     SigningJobArn: "STRING_VALUE",
 * //   },
 * //   LayerArn: "STRING_VALUE",
 * //   LayerVersionArn: "STRING_VALUE",
 * //   Description: "STRING_VALUE",
 * //   CreatedDate: "STRING_VALUE",
 * //   Version: Number("long"),
 * //   CompatibleArchitectures: [ // CompatibleArchitectures
 * //     "x86_64" || "arm64",
 * //   ],
 * //   CompatibleRuntimes: [ // CompatibleRuntimes
 * //     "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //   ],
 * //   LicenseInfo: "STRING_VALUE",
 * //   LayerCodeSignatureCloudTrailData: { // LayerCodeSignatureCloudTrailData
 * //     signingProfileVersionArn: "STRING_VALUE",
 * //     signingJobArn: "STRING_VALUE",
 * //     signatureStatus: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param PublishLayerVersion20181031CommandInput - {@link PublishLayerVersion20181031CommandInput}
 * @returns {@link PublishLayerVersion20181031CommandOutput}
 * @see {@link PublishLayerVersion20181031CommandInput} for command's `input` shape.
 * @see {@link PublishLayerVersion20181031CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CodeStorageExceededException} (client fault)
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
export declare class PublishLayerVersion20181031Command extends PublishLayerVersion20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PublishLayerVersionRequest20181031;
            output: PublishLayerVersionResponse20181031;
        };
        sdk: {
            input: PublishLayerVersion20181031CommandInput;
            output: PublishLayerVersion20181031CommandOutput;
        };
    };
}
