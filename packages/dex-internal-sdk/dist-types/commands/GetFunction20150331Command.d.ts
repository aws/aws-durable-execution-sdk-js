import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetFunctionRequest, GetFunctionResponse20150331 } from "../models/models_0";
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
 * The input for {@link GetFunction20150331Command}.
 */
export interface GetFunction20150331CommandInput extends GetFunctionRequest {
}
/**
 * @public
 *
 * The output of {@link GetFunction20150331Command}.
 */
export interface GetFunction20150331CommandOutput extends GetFunctionResponse20150331, __MetadataBearer {
}
declare const GetFunction20150331Command_base: {
    new (input: GetFunction20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetFunction20150331CommandInput, GetFunction20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetFunction20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetFunction20150331CommandInput, GetFunction20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetFunction20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetFunction20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetFunctionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetFunction20150331Command(input);
 * const response = await client.send(command);
 * // { // GetFunctionResponse20150331
 * //   Configuration: { // FunctionConfiguration20150331
 * //     FunctionName: "STRING_VALUE",
 * //     FunctionArn: "STRING_VALUE",
 * //     Runtime: "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //     Role: "STRING_VALUE",
 * //     PollerCustomerVpcRole: "STRING_VALUE",
 * //     FunctionVersionId: "STRING_VALUE",
 * //     Handler: "STRING_VALUE",
 * //     CodeSize: Number("long"),
 * //     Description: "STRING_VALUE",
 * //     Timeout: Number("int"),
 * //     MemorySize: Number("int"),
 * //     LastModified: "STRING_VALUE",
 * //     CodeSha256: "STRING_VALUE",
 * //     Version: "STRING_VALUE",
 * //     VpcConfig: { // VpcConfigResponse
 * //       SubnetIds: [ // SubnetIds
 * //         "STRING_VALUE",
 * //       ],
 * //       SecurityGroupIds: [ // SecurityGroupIds
 * //         "STRING_VALUE",
 * //       ],
 * //       VpcId: "STRING_VALUE",
 * //       Ipv6AllowedForDualStack: true || false,
 * //       VpcDelegationRole: "STRING_VALUE",
 * //       VpcOwnerRole: "STRING_VALUE",
 * //       TargetSourceArn: "STRING_VALUE",
 * //     },
 * //     DeadLetterConfig: { // DeadLetterConfig
 * //       TargetArn: "STRING_VALUE",
 * //     },
 * //     Environment: { // EnvironmentResponse
 * //       Variables: { // EnvironmentVariables
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //       Error: { // EnvironmentError
 * //         ErrorCode: "STRING_VALUE",
 * //         Message: "STRING_VALUE",
 * //       },
 * //     },
 * //     KMSKeyArn: "STRING_VALUE",
 * //     TracingConfig: { // TracingConfigResponse
 * //       Mode: "Active" || "PassThrough",
 * //     },
 * //     MasterArn: "STRING_VALUE",
 * //     RevisionId: "STRING_VALUE",
 * //     Layers: [ // LayersReferenceList
 * //       { // Layer
 * //         Arn: "STRING_VALUE",
 * //         CodeSize: Number("long"),
 * //         UncompressedCodeSize: Number("long"),
 * //         SigningProfileVersionArn: "STRING_VALUE",
 * //         SigningJobArn: "STRING_VALUE",
 * //       },
 * //     ],
 * //     State: "Pending" || "Active" || "Inactive" || "Failed" || "Deactivating" || "Deactivated" || "ActiveNonInvocable" || "Deleting",
 * //     StateReason: "STRING_VALUE",
 * //     StateReasonCode: "Idle" || "Creating" || "Restoring" || "EniLimitExceeded" || "InsufficientRolePermissions" || "InvalidConfiguration" || "InternalError" || "SubnetOutOfIPAddresses" || "InvalidSubnet" || "InvalidSecurityGroup" || "ImageDeleted" || "ImageAccessDenied" || "InvalidImage" || "KMSKeyAccessDenied" || "KMSKeyNotFound" || "InvalidStateKMSKey" || "DisabledKMSKey" || "EFSIOError" || "EFSMountConnectivityError" || "EFSMountFailure" || "EFSMountTimeout" || "InvalidRuntime" || "InvalidZipFileException" || "FunctionError",
 * //     LastUpdateStatus: "Successful" || "Failed" || "InProgress",
 * //     LastUpdateStatusReason: "STRING_VALUE",
 * //     LastUpdateStatusReasonCode: "EniLimitExceeded" || "InsufficientRolePermissions" || "InvalidConfiguration" || "InternalError" || "SubnetOutOfIPAddresses" || "InvalidSubnet" || "InvalidSecurityGroup" || "ImageDeleted" || "ImageAccessDenied" || "InvalidImage" || "KMSKeyAccessDenied" || "KMSKeyNotFound" || "InvalidStateKMSKey" || "DisabledKMSKey" || "EFSIOError" || "EFSMountConnectivityError" || "EFSMountFailure" || "EFSMountTimeout" || "InvalidRuntime" || "InvalidZipFileException" || "FunctionError",
 * //     FileSystemConfigs: [ // FileSystemConfigList
 * //       { // FileSystemConfig
 * //         Arn: "STRING_VALUE", // required
 * //         LocalMountPath: "STRING_VALUE", // required
 * //       },
 * //     ],
 * //     SigningProfileVersionArn: "STRING_VALUE",
 * //     SigningJobArn: "STRING_VALUE",
 * //     PackageType: "Zip" || "Image",
 * //     ImageConfigResponse: { // ImageConfigResponse
 * //       ImageConfig: { // ImageConfig
 * //         EntryPoint: [ // StringList
 * //           "STRING_VALUE",
 * //         ],
 * //         Command: [
 * //           "STRING_VALUE",
 * //         ],
 * //         WorkingDirectory: "STRING_VALUE",
 * //         User: "STRING_VALUE",
 * //         UserOverride: "Deny" || "AllowUnprivileged" || "AllowRoot",
 * //       },
 * //       Error: { // ImageConfigError
 * //         ErrorCode: "STRING_VALUE",
 * //         Message: "STRING_VALUE",
 * //       },
 * //     },
 * //     Architectures: [ // ArchitecturesList
 * //       "x86_64" || "arm64",
 * //     ],
 * //     EphemeralStorage: { // EphemeralStorage
 * //       Size: Number("int"), // required
 * //     },
 * //     SnapStart: { // SnapStartResponse
 * //       ApplyOn: "PublishedVersions" || "None",
 * //       OptimizationStatus: "On" || "Off",
 * //     },
 * //     RuntimeVersionConfig: { // RuntimeVersionConfig
 * //       RuntimeVersionArn: "STRING_VALUE",
 * //     },
 * //     LoggingConfig: { // LoggingConfig
 * //       LogFormat: "JSON" || "Text",
 * //       ApplicationLogLevel: "TRACE" || "DEBUG" || "INFO" || "WARN" || "ERROR" || "FATAL",
 * //       SystemLogLevel: "DEBUG" || "INFO" || "WARN",
 * //       LogGroup: "STRING_VALUE",
 * //     },
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
 * //     TenancyConfig: { // TenancyConfig
 * //       TenantIsolationMode: "PER_TENANT" || "PER_INVOKE", // required
 * //     },
 * //     ConfigSha256: "STRING_VALUE",
 * //     DurableConfig: { // DurableConfig
 * //       RetentionPeriodInDays: Number("int"),
 * //       ExecutionTimeout: Number("int"),
 * //     },
 * //   },
 * //   Code: { // FunctionCodeLocation
 * //     RepositoryType: "STRING_VALUE",
 * //     Location: "STRING_VALUE",
 * //     ImageUri: "STRING_VALUE",
 * //     ResolvedImageUri: "STRING_VALUE",
 * //     ResolvedS3Uri: "STRING_VALUE",
 * //     SourceKMSKeyArn: "STRING_VALUE",
 * //     Error: "STRING_VALUE",
 * //   },
 * //   Tags: { // Tags
 * //     "<keys>": "STRING_VALUE",
 * //   },
 * //   Concurrency: { // Concurrency
 * //     ReservedConcurrentExecutions: Number("int"),
 * //   },
 * // };
 *
 * ```
 *
 * @param GetFunction20150331CommandInput - {@link GetFunction20150331CommandInput}
 * @returns {@link GetFunction20150331CommandOutput}
 * @see {@link GetFunction20150331CommandInput} for command's `input` shape.
 * @see {@link GetFunction20150331CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class GetFunction20150331Command extends GetFunction20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetFunctionRequest;
            output: GetFunctionResponse20150331;
        };
        sdk: {
            input: GetFunction20150331CommandInput;
            output: GetFunction20150331CommandOutput;
        };
    };
}
