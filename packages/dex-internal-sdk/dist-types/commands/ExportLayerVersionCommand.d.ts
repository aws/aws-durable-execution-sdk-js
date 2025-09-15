import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ExportLayerVersionRequest, ExportLayerVersionResponse } from "../models/models_0";
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
 * The input for {@link ExportLayerVersionCommand}.
 */
export interface ExportLayerVersionCommandInput extends ExportLayerVersionRequest {
}
/**
 * @public
 *
 * The output of {@link ExportLayerVersionCommand}.
 */
export interface ExportLayerVersionCommandOutput extends ExportLayerVersionResponse, __MetadataBearer {
}
declare const ExportLayerVersionCommand_base: {
    new (input: ExportLayerVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ExportLayerVersionCommandInput, ExportLayerVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ExportLayerVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ExportLayerVersionCommandInput, ExportLayerVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ExportLayerVersionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ExportLayerVersionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ExportLayerVersionRequest
 *   LayerVersionArn: "STRING_VALUE", // required
 * };
 * const command = new ExportLayerVersionCommand(input);
 * const response = await client.send(command);
 * // { // ExportLayerVersionResponse
 * //   LayerVersion: { // MigrationLayerVersion
 * //     AccountId: "STRING_VALUE",
 * //     LayerId: "STRING_VALUE",
 * //     LayerArn: "STRING_VALUE",
 * //     LayerVersionArn: "STRING_VALUE",
 * //     CodeSize: Number("long"),
 * //     CodeSha256: "STRING_VALUE",
 * //     CompatibleArchitectures: [ // CompatibleArchitectures
 * //       "x86_64" || "arm64",
 * //     ],
 * //     CompatibleRuntimes: [ // CompatibleRuntimes
 * //       "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //     ],
 * //     CodeSigningProfileArn: "STRING_VALUE",
 * //     CodeSigningJobArn: "STRING_VALUE",
 * //     CodeSignatureExpirationTime: Number("long"),
 * //     CodeSignatureRevocationData: new Uint8Array(),
 * //     CreatedDate: "STRING_VALUE",
 * //     Description: "STRING_VALUE",
 * //     LicenseInfo: "STRING_VALUE",
 * //     UncompressedCodeSize: Number("long"),
 * //     CodeSignatureStatus: "CORRUPT" || "EXPIRED" || "MISMATCH" || "REVOKED" || "VALID",
 * //     RevisionId: "STRING_VALUE",
 * //     Policy: "STRING_VALUE",
 * //     CurrentVersionNumber: Number("long"),
 * //     LatestUsableVersionNumber: Number("long"),
 * //     LatestUsableCompatibleArchitectures: [
 * //       "x86_64" || "arm64",
 * //     ],
 * //     LatestUsableCompatibleRuntimes: [
 * //       "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //     ],
 * //     ZipFileSignedUrl: "STRING_VALUE",
 * //     SquashFSSignedUrl: "STRING_VALUE",
 * //     HashOfConsistentFields: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param ExportLayerVersionCommandInput - {@link ExportLayerVersionCommandInput}
 * @returns {@link ExportLayerVersionCommandOutput}
 * @see {@link ExportLayerVersionCommandInput} for command's `input` shape.
 * @see {@link ExportLayerVersionCommandOutput} for command's `response` shape.
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
export declare class ExportLayerVersionCommand extends ExportLayerVersionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ExportLayerVersionRequest;
            output: ExportLayerVersionResponse;
        };
        sdk: {
            input: ExportLayerVersionCommandInput;
            output: ExportLayerVersionCommandOutput;
        };
    };
}
