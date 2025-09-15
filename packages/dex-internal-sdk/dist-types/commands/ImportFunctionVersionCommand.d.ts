import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportFunctionVersionRequest, ImportFunctionVersionResponse } from "../models/models_1";
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
 * The input for {@link ImportFunctionVersionCommand}.
 */
export interface ImportFunctionVersionCommandInput extends ImportFunctionVersionRequest {
}
/**
 * @public
 *
 * The output of {@link ImportFunctionVersionCommand}.
 */
export interface ImportFunctionVersionCommandOutput extends ImportFunctionVersionResponse, __MetadataBearer {
}
declare const ImportFunctionVersionCommand_base: {
    new (input: ImportFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionVersionCommandInput, ImportFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportFunctionVersionCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionVersionCommandInput, ImportFunctionVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportFunctionVersionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportFunctionVersionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportFunctionVersionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   MigrationFunctionVersion: { // MigrationFunctionVersion
 *     Name: "STRING_VALUE",
 *     FunctionArn: "STRING_VALUE",
 *     Runtime: "STRING_VALUE",
 *     Role: "STRING_VALUE",
 *     Handler: "STRING_VALUE",
 *     CodeSize: Number("long"),
 *     Description: "STRING_VALUE",
 *     Timeout: Number("int"),
 *     MemoryLimitMb: Number("int"),
 *     ModifiedDateAsEpochMilli: Number("long"),
 *     CodeSha256: "STRING_VALUE",
 *     FunctionVersion: "STRING_VALUE",
 *     KmsKeyArn: "STRING_VALUE",
 *     AccountId: "STRING_VALUE",
 *     State: "Pending" || "Active" || "Inactive" || "Failed" || "Deactivating" || "Deactivated" || "ActiveNonInvocable" || "Deleting",
 *     StateReasonCode: "Idle" || "Creating" || "Restoring" || "EniLimitExceeded" || "InsufficientRolePermissions" || "InvalidConfiguration" || "InternalError" || "SubnetOutOfIPAddresses" || "InvalidSubnet" || "InvalidSecurityGroup" || "ImageDeleted" || "ImageAccessDenied" || "InvalidImage" || "KMSKeyAccessDenied" || "KMSKeyNotFound" || "InvalidStateKMSKey" || "DisabledKMSKey" || "EFSIOError" || "EFSMountConnectivityError" || "EFSMountFailure" || "EFSMountTimeout" || "InvalidRuntime" || "InvalidZipFileException" || "FunctionError",
 *     PendingTaskConfig: "STRING_VALUE",
 *     EncryptedEnvironmentVars: "STRING_VALUE",
 *     IsLarge: Number("int"),
 *     Policy: "STRING_VALUE",
 *     PublishedVersion: Number("long"),
 *     ReservedConcurrentExecutions: Number("int"),
 *     SquashfsRollbackVersionId: "STRING_VALUE",
 *     Tagged: true || false,
 *     TracingMode: "Active" || "PassThrough",
 *     VersionId: "STRING_VALUE",
 *     KmsGrantId: "STRING_VALUE",
 *     KmsGrantToken: "STRING_VALUE",
 *     RuntimeVariant: "STRING_VALUE",
 *     TransactionId: "STRING_VALUE",
 *     FunctionId: "STRING_VALUE",
 *     Mode: "http" || "event",
 *     EnableTracer: true || false,
 *     Code: "STRING_VALUE",
 *     UncompresedCodeSize: Number("long"),
 *     SandboxGeneration: Number("long"),
 *     CodeSigningProfileArn: "STRING_VALUE",
 *     CodeSigningJobArn: "STRING_VALUE",
 *     CodeSigningConfigArn: "STRING_VALUE",
 *     CodeSignatureExpirationTime: Number("long"),
 *     DeadLetterArn: "STRING_VALUE",
 *     SqsQueueName: "STRING_VALUE",
 *     ConcurrencySequenceNumber: Number("long"),
 *     FunctionSequenceNumber: Number("long"),
 *     HashOfConsistentFields: "STRING_VALUE",
 *     ProvisionedConcurrencyState: "Active" || "Inactive",
 *     RuntimeVersion: "STRING_VALUE",
 *     PreviousRuntimeVersion: "STRING_VALUE",
 *     RuntimeArtifactArn: "STRING_VALUE",
 *     PreviousRuntimeArtifactArn: "STRING_VALUE",
 *     RuntimeUpdateReason: "PINNED" || "ROLLOUT" || "RELEASE" || "PRERELEASE",
 *     Architectures: [ // ArchitecturesList
 *       "x86_64" || "arm64",
 *     ],
 *     EphemeralStorage: { // EphemeralStorage
 *       Size: Number("int"), // required
 *     },
 *     TagsInfo: { // TagsInfo
 *       OwnershipStatus: "STRING_VALUE", // required
 *       ValidationToken: "STRING_VALUE",
 *       Tags: { // Tags
 *         "<keys>": "STRING_VALUE",
 *       },
 *     },
 *     SnapStart: { // SnapStart
 *       ApplyOn: "PublishedVersions" || "None",
 *     },
 *     LoggingConfig: { // LoggingConfig
 *       LogFormat: "JSON" || "Text",
 *       ApplicationLogLevel: "TRACE" || "DEBUG" || "INFO" || "WARN" || "ERROR" || "FATAL",
 *       SystemLogLevel: "DEBUG" || "INFO" || "WARN",
 *       LogGroup: "STRING_VALUE",
 *     },
 *     GenerateDataKeyKmsGrantId: "STRING_VALUE",
 *     GenerateDataKeyKmsGrantToken: "STRING_VALUE",
 *     CustomerSubnetsByLambdaAz: { // CustomerSubnetsByLambdaAz
 *       "<keys>": [ // SubnetIds
 *         "STRING_VALUE",
 *       ],
 *     },
 *     SecurityGroupIds: [ // SecurityGroupIds
 *       "STRING_VALUE",
 *     ],
 *     VpcId: "STRING_VALUE",
 *     PollerCustomerVpcRole: "STRING_VALUE",
 *     VpcDelegationRole: "STRING_VALUE",
 *     VpcOwnerRole: "STRING_VALUE",
 *     TargetSourceArn: "STRING_VALUE",
 *     Ipv6AllowedForDualStack: true || false,
 *     VmSelectorPreference: "k5preview" || "k5brave" || "sbxv2preview" || "sbxv2brave",
 *     ProgrammingModel: "HANDLER" || "WEB",
 *     WebProgrammingModelConfig: { // WebProgrammingModelConfig
 *       Port: Number("int"),
 *       ReadinessCheckConfig: { // ReadinessCheckConfig
 *         HttpGet: { // HttpGet
 *           Port: Number("int"),
 *           Path: "STRING_VALUE",
 *         },
 *         TCPSocket: { // TCPSocket
 *           Port: Number("int"),
 *         },
 *       },
 *     },
 *     ExecutionEnvironmentConcurrencyConfig: { // ExecutionEnvironmentConcurrencyConfig
 *       ConcurrencyMode: "SINGLE" || "MULTI", // required
 *       MultiConcurrencyConfig: { // MultiConcurrencyConfig
 *         MaxConcurrency: Number("int"), // required
 *       },
 *     },
 *     LayerConfigs: [ // LayerConfigList
 *       { // LayerConfig
 *         LayerArn: "STRING_VALUE",
 *         S3CodeUri: "STRING_VALUE",
 *         S3VersionId: "STRING_VALUE",
 *         CodeSize: Number("long"),
 *         UncompressedCodeSize: Number("long"),
 *         CodeSigningProfileArn: "STRING_VALUE",
 *         CodeSigningJobArn: "STRING_VALUE",
 *         CodeSignatureExpirationTime: Number("long"),
 *         CodeSignatureStatus: "CORRUPT" || "EXPIRED" || "MISMATCH" || "REVOKED" || "VALID",
 *         CodeSignatureRevocationData: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 *       },
 *     ],
 *     AllLayerConfigs: [
 *       {
 *         LayerArn: "STRING_VALUE",
 *         S3CodeUri: "STRING_VALUE",
 *         S3VersionId: "STRING_VALUE",
 *         CodeSize: Number("long"),
 *         UncompressedCodeSize: Number("long"),
 *         CodeSigningProfileArn: "STRING_VALUE",
 *         CodeSigningJobArn: "STRING_VALUE",
 *         CodeSignatureExpirationTime: Number("long"),
 *         CodeSignatureStatus: "CORRUPT" || "EXPIRED" || "MISMATCH" || "REVOKED" || "VALID",
 *         CodeSignatureRevocationData: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 *       },
 *     ],
 *     MergedLayersUri: "STRING_VALUE",
 *     CodeMergedWithLayersUri: "STRING_VALUE",
 *     TotalProvisionedConcurrentExecutions: Number("int"),
 *     PackageType: "STRING_VALUE",
 *     UnderlyingPackageType: "STRING_VALUE",
 *     PublicAccessBlockConfig: { // PublicAccessBlockConfig
 *       BlockPublicPolicy: true || false,
 *       RestrictPublicResource: true || false,
 *     },
 *     PublicPolicyAttached: true || false,
 *     TenancyConfig: { // TenancyConfig
 *       TenantIsolationMode: "PER_TENANT" || "PER_INVOKE", // required
 *     },
 *     ConfigSha256: "STRING_VALUE",
 *     DurableConfig: { // DurableConfig
 *       RetentionPeriodInDays: Number("int"),
 *       ExecutionTimeout: Number("int"),
 *     },
 *   },
 * };
 * const command = new ImportFunctionVersionCommand(input);
 * const response = await client.send(command);
 * // { // ImportFunctionVersionResponse
 * //   MigrationFunctionVersion: { // MigrationFunctionVersion
 * //     Name: "STRING_VALUE",
 * //     FunctionArn: "STRING_VALUE",
 * //     Runtime: "STRING_VALUE",
 * //     Role: "STRING_VALUE",
 * //     Handler: "STRING_VALUE",
 * //     CodeSize: Number("long"),
 * //     Description: "STRING_VALUE",
 * //     Timeout: Number("int"),
 * //     MemoryLimitMb: Number("int"),
 * //     ModifiedDateAsEpochMilli: Number("long"),
 * //     CodeSha256: "STRING_VALUE",
 * //     FunctionVersion: "STRING_VALUE",
 * //     KmsKeyArn: "STRING_VALUE",
 * //     AccountId: "STRING_VALUE",
 * //     State: "Pending" || "Active" || "Inactive" || "Failed" || "Deactivating" || "Deactivated" || "ActiveNonInvocable" || "Deleting",
 * //     StateReasonCode: "Idle" || "Creating" || "Restoring" || "EniLimitExceeded" || "InsufficientRolePermissions" || "InvalidConfiguration" || "InternalError" || "SubnetOutOfIPAddresses" || "InvalidSubnet" || "InvalidSecurityGroup" || "ImageDeleted" || "ImageAccessDenied" || "InvalidImage" || "KMSKeyAccessDenied" || "KMSKeyNotFound" || "InvalidStateKMSKey" || "DisabledKMSKey" || "EFSIOError" || "EFSMountConnectivityError" || "EFSMountFailure" || "EFSMountTimeout" || "InvalidRuntime" || "InvalidZipFileException" || "FunctionError",
 * //     PendingTaskConfig: "STRING_VALUE",
 * //     EncryptedEnvironmentVars: "STRING_VALUE",
 * //     IsLarge: Number("int"),
 * //     Policy: "STRING_VALUE",
 * //     PublishedVersion: Number("long"),
 * //     ReservedConcurrentExecutions: Number("int"),
 * //     SquashfsRollbackVersionId: "STRING_VALUE",
 * //     Tagged: true || false,
 * //     TracingMode: "Active" || "PassThrough",
 * //     VersionId: "STRING_VALUE",
 * //     KmsGrantId: "STRING_VALUE",
 * //     KmsGrantToken: "STRING_VALUE",
 * //     RuntimeVariant: "STRING_VALUE",
 * //     TransactionId: "STRING_VALUE",
 * //     FunctionId: "STRING_VALUE",
 * //     Mode: "http" || "event",
 * //     EnableTracer: true || false,
 * //     Code: "STRING_VALUE",
 * //     UncompresedCodeSize: Number("long"),
 * //     SandboxGeneration: Number("long"),
 * //     CodeSigningProfileArn: "STRING_VALUE",
 * //     CodeSigningJobArn: "STRING_VALUE",
 * //     CodeSigningConfigArn: "STRING_VALUE",
 * //     CodeSignatureExpirationTime: Number("long"),
 * //     DeadLetterArn: "STRING_VALUE",
 * //     SqsQueueName: "STRING_VALUE",
 * //     ConcurrencySequenceNumber: Number("long"),
 * //     FunctionSequenceNumber: Number("long"),
 * //     HashOfConsistentFields: "STRING_VALUE",
 * //     ProvisionedConcurrencyState: "Active" || "Inactive",
 * //     RuntimeVersion: "STRING_VALUE",
 * //     PreviousRuntimeVersion: "STRING_VALUE",
 * //     RuntimeArtifactArn: "STRING_VALUE",
 * //     PreviousRuntimeArtifactArn: "STRING_VALUE",
 * //     RuntimeUpdateReason: "PINNED" || "ROLLOUT" || "RELEASE" || "PRERELEASE",
 * //     Architectures: [ // ArchitecturesList
 * //       "x86_64" || "arm64",
 * //     ],
 * //     EphemeralStorage: { // EphemeralStorage
 * //       Size: Number("int"), // required
 * //     },
 * //     TagsInfo: { // TagsInfo
 * //       OwnershipStatus: "STRING_VALUE", // required
 * //       ValidationToken: "STRING_VALUE",
 * //       Tags: { // Tags
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //     },
 * //     SnapStart: { // SnapStart
 * //       ApplyOn: "PublishedVersions" || "None",
 * //     },
 * //     LoggingConfig: { // LoggingConfig
 * //       LogFormat: "JSON" || "Text",
 * //       ApplicationLogLevel: "TRACE" || "DEBUG" || "INFO" || "WARN" || "ERROR" || "FATAL",
 * //       SystemLogLevel: "DEBUG" || "INFO" || "WARN",
 * //       LogGroup: "STRING_VALUE",
 * //     },
 * //     GenerateDataKeyKmsGrantId: "STRING_VALUE",
 * //     GenerateDataKeyKmsGrantToken: "STRING_VALUE",
 * //     CustomerSubnetsByLambdaAz: { // CustomerSubnetsByLambdaAz
 * //       "<keys>": [ // SubnetIds
 * //         "STRING_VALUE",
 * //       ],
 * //     },
 * //     SecurityGroupIds: [ // SecurityGroupIds
 * //       "STRING_VALUE",
 * //     ],
 * //     VpcId: "STRING_VALUE",
 * //     PollerCustomerVpcRole: "STRING_VALUE",
 * //     VpcDelegationRole: "STRING_VALUE",
 * //     VpcOwnerRole: "STRING_VALUE",
 * //     TargetSourceArn: "STRING_VALUE",
 * //     Ipv6AllowedForDualStack: true || false,
 * //     VmSelectorPreference: "k5preview" || "k5brave" || "sbxv2preview" || "sbxv2brave",
 * //     ProgrammingModel: "HANDLER" || "WEB",
 * //     WebProgrammingModelConfig: { // WebProgrammingModelConfig
 * //       Port: Number("int"),
 * //       ReadinessCheckConfig: { // ReadinessCheckConfig
 * //         HttpGet: { // HttpGet
 * //           Port: Number("int"),
 * //           Path: "STRING_VALUE",
 * //         },
 * //         TCPSocket: { // TCPSocket
 * //           Port: Number("int"),
 * //         },
 * //       },
 * //     },
 * //     ExecutionEnvironmentConcurrencyConfig: { // ExecutionEnvironmentConcurrencyConfig
 * //       ConcurrencyMode: "SINGLE" || "MULTI", // required
 * //       MultiConcurrencyConfig: { // MultiConcurrencyConfig
 * //         MaxConcurrency: Number("int"), // required
 * //       },
 * //     },
 * //     LayerConfigs: [ // LayerConfigList
 * //       { // LayerConfig
 * //         LayerArn: "STRING_VALUE",
 * //         S3CodeUri: "STRING_VALUE",
 * //         S3VersionId: "STRING_VALUE",
 * //         CodeSize: Number("long"),
 * //         UncompressedCodeSize: Number("long"),
 * //         CodeSigningProfileArn: "STRING_VALUE",
 * //         CodeSigningJobArn: "STRING_VALUE",
 * //         CodeSignatureExpirationTime: Number("long"),
 * //         CodeSignatureStatus: "CORRUPT" || "EXPIRED" || "MISMATCH" || "REVOKED" || "VALID",
 * //         CodeSignatureRevocationData: new Uint8Array(),
 * //       },
 * //     ],
 * //     AllLayerConfigs: [
 * //       {
 * //         LayerArn: "STRING_VALUE",
 * //         S3CodeUri: "STRING_VALUE",
 * //         S3VersionId: "STRING_VALUE",
 * //         CodeSize: Number("long"),
 * //         UncompressedCodeSize: Number("long"),
 * //         CodeSigningProfileArn: "STRING_VALUE",
 * //         CodeSigningJobArn: "STRING_VALUE",
 * //         CodeSignatureExpirationTime: Number("long"),
 * //         CodeSignatureStatus: "CORRUPT" || "EXPIRED" || "MISMATCH" || "REVOKED" || "VALID",
 * //         CodeSignatureRevocationData: new Uint8Array(),
 * //       },
 * //     ],
 * //     MergedLayersUri: "STRING_VALUE",
 * //     CodeMergedWithLayersUri: "STRING_VALUE",
 * //     TotalProvisionedConcurrentExecutions: Number("int"),
 * //     PackageType: "STRING_VALUE",
 * //     UnderlyingPackageType: "STRING_VALUE",
 * //     PublicAccessBlockConfig: { // PublicAccessBlockConfig
 * //       BlockPublicPolicy: true || false,
 * //       RestrictPublicResource: true || false,
 * //     },
 * //     PublicPolicyAttached: true || false,
 * //     TenancyConfig: { // TenancyConfig
 * //       TenantIsolationMode: "PER_TENANT" || "PER_INVOKE", // required
 * //     },
 * //     ConfigSha256: "STRING_VALUE",
 * //     DurableConfig: { // DurableConfig
 * //       RetentionPeriodInDays: Number("int"),
 * //       ExecutionTimeout: Number("int"),
 * //     },
 * //   },
 * // };
 *
 * ```
 *
 * @param ImportFunctionVersionCommandInput - {@link ImportFunctionVersionCommandInput}
 * @returns {@link ImportFunctionVersionCommandOutput}
 * @see {@link ImportFunctionVersionCommandInput} for command's `input` shape.
 * @see {@link ImportFunctionVersionCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class ImportFunctionVersionCommand extends ImportFunctionVersionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportFunctionVersionRequest;
            output: ImportFunctionVersionResponse;
        };
        sdk: {
            input: ImportFunctionVersionCommandInput;
            output: ImportFunctionVersionCommandOutput;
        };
    };
}
