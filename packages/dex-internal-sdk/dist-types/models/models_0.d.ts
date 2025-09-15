import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { ExceptionOptionType as __ExceptionOptionType } from "@smithy/smithy-client";
/**
 * @public
 */
export interface AccountLimit {
    TotalCodeSize?: number | undefined;
    CodeSizeUnzipped?: number | undefined;
    CodeSizeZipped?: number | undefined;
    ConcurrentExecutions?: number | undefined;
    UnreservedConcurrentExecutions?: number | undefined;
    UnreservedConcurrentExecutionsMinimum?: number | undefined;
}
/**
 * @public
 */
export interface AccountRiskSettings {
    RiskStatus: number | undefined;
    RiskDetectedTime: Date | undefined;
    RiskSource?: string | undefined;
    ContainmentScore: number | undefined;
}
/**
 * @public
 */
export interface AccountUsage {
    TotalCodeSize?: number | undefined;
    FunctionCount?: number | undefined;
}
/**
 * @public
 */
export declare class InvalidParameterValueException extends __BaseException {
    readonly name: "InvalidParameterValueException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidParameterValueException, __BaseException>);
}
/**
 * @public
 */
export interface OldAddEventSourceRequest {
    EventSource: string | undefined;
    FunctionName: string | undefined;
    Role: string | undefined;
    BatchSize?: number | undefined;
    Parameters?: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface OldEventSourceConfiguration {
    UUID?: string | undefined;
    BatchSize?: number | undefined;
    EventSource?: string | undefined;
    FunctionName?: string | undefined;
    Parameters?: Record<string, string> | undefined;
    Role?: string | undefined;
    LastModified?: string | undefined;
    IsActive?: string | undefined;
    Status?: string | undefined;
}
/**
 * @public
 */
export declare class ResourceConflictException extends __BaseException {
    readonly name: "ResourceConflictException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ResourceConflictException, __BaseException>);
}
/**
 * @public
 */
export declare class ResourceNotFoundException extends __BaseException {
    readonly name: "ResourceNotFoundException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ResourceNotFoundException, __BaseException>);
}
/**
 * @public
 */
export declare class ServiceException extends __BaseException {
    readonly name: "ServiceException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ServiceException, __BaseException>);
}
/**
 * @public
 */
export interface AddLayerVersionPermissionRequest20181031 {
    LayerName: string | undefined;
    VersionNumber: number | undefined;
    StatementId: string | undefined;
    Action: string | undefined;
    Principal: string | undefined;
    OrganizationId?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface AddLayerVersionPermissionResponse20181031 {
    Statement?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export declare class PolicyLengthExceededException extends __BaseException {
    readonly name: "PolicyLengthExceededException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<PolicyLengthExceededException, __BaseException>);
}
/**
 * @public
 */
export declare class PreconditionFailedException extends __BaseException {
    readonly name: "PreconditionFailedException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<PreconditionFailedException, __BaseException>);
}
/**
 * @public
 * @enum
 */
export declare const ThrottleReason: {
    readonly CallerRateLimitExceeded: "CallerRateLimitExceeded";
    readonly ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded";
    readonly ConcurrentSnapshotCreateLimitExceeded: "ConcurrentSnapshotCreateLimitExceeded";
    readonly FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded";
    readonly ReservedFunctionConcurrentInvocationLimitExceeded: "ReservedFunctionConcurrentInvocationLimitExceeded";
    readonly ReservedFunctionInvocationRateLimitExceeded: "ReservedFunctionInvocationRateLimitExceeded";
};
/**
 * @public
 */
export type ThrottleReason = typeof ThrottleReason[keyof typeof ThrottleReason];
/**
 * @public
 */
export declare class TooManyRequestsException extends __BaseException {
    readonly name: "TooManyRequestsException";
    readonly $fault: "client";
    retryAfterSeconds?: string | undefined;
    Type?: string | undefined;
    Reason?: ThrottleReason | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<TooManyRequestsException, __BaseException>);
}
/**
 * @public
 * @enum
 */
export declare const FunctionUrlAuthType: {
    readonly AWS_IAM: "AWS_IAM";
    readonly NONE: "NONE";
};
/**
 * @public
 */
export type FunctionUrlAuthType = typeof FunctionUrlAuthType[keyof typeof FunctionUrlAuthType];
/**
 * @public
 */
export interface AddPermissionRequest {
    FunctionName: string | undefined;
    StatementId: string | undefined;
    Action: string | undefined;
    Principal: string | undefined;
    SourceArn?: string | undefined;
    FunctionUrlAuthType?: FunctionUrlAuthType | undefined;
    InvokedViaFunctionUrl?: boolean | undefined;
    SourceAccount?: string | undefined;
    EventSourceToken?: string | undefined;
    Qualifier?: string | undefined;
    RevisionId?: string | undefined;
    PrincipalOrgID?: string | undefined;
}
/**
 * @public
 */
export interface AddPermissionResponse {
    Statement?: string | undefined;
}
/**
 * @public
 */
export declare class PublicPolicyException extends __BaseException {
    readonly name: "PublicPolicyException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<PublicPolicyException, __BaseException>);
}
/**
 * @public
 */
export interface AliasRoutingConfiguration {
    AdditionalVersionWeights?: Record<string, number> | undefined;
}
/**
 * @public
 */
export interface AliasConfiguration20150331 {
    AliasArn?: string | undefined;
    Name?: string | undefined;
    FunctionVersion?: string | undefined;
    Description?: string | undefined;
    RoutingConfig?: AliasRoutingConfiguration | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export declare class AliasLimitExceededException extends __BaseException {
    readonly name: "AliasLimitExceededException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<AliasLimitExceededException, __BaseException>);
}
/**
 * @public
 */
export interface AllowedPublishers {
    SigningProfileVersionArns: (string)[] | undefined;
}
/**
 * @public
 * @enum
 */
export declare const KafkaSchemaRegistryAuthType: {
    readonly BASIC_AUTH: "BASIC_AUTH";
    readonly CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH";
    readonly SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE";
};
/**
 * @public
 */
export type KafkaSchemaRegistryAuthType = typeof KafkaSchemaRegistryAuthType[keyof typeof KafkaSchemaRegistryAuthType];
/**
 * @public
 */
export interface KafkaSchemaRegistryAccessConfig {
    Type?: KafkaSchemaRegistryAuthType | undefined;
    URI?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const SchemaRegistryEventRecordFormat: {
    readonly JSON: "JSON";
    readonly SOURCE: "SOURCE";
};
/**
 * @public
 */
export type SchemaRegistryEventRecordFormat = typeof SchemaRegistryEventRecordFormat[keyof typeof SchemaRegistryEventRecordFormat];
/**
 * @public
 * @enum
 */
export declare const KafkaSchemaValidationAttribute: {
    readonly KEY: "KEY";
    readonly VALUE: "VALUE";
};
/**
 * @public
 */
export type KafkaSchemaValidationAttribute = typeof KafkaSchemaValidationAttribute[keyof typeof KafkaSchemaValidationAttribute];
/**
 * @public
 */
export interface KafkaSchemaValidationConfig {
    Attribute?: KafkaSchemaValidationAttribute | undefined;
}
/**
 * @public
 */
export interface KafkaSchemaRegistryConfig {
    SchemaRegistryURI?: string | undefined;
    EventRecordFormat?: SchemaRegistryEventRecordFormat | undefined;
    AccessConfigs?: (KafkaSchemaRegistryAccessConfig)[] | undefined;
    SchemaValidationConfigs?: (KafkaSchemaValidationConfig)[] | undefined;
}
/**
 * @public
 */
export interface AmazonManagedKafkaEventSourceConfig {
    ConsumerGroupId?: string | undefined;
    SchemaRegistryConfig?: KafkaSchemaRegistryConfig | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ApplicationLogLevel: {
    readonly Debug: "DEBUG";
    readonly Error: "ERROR";
    readonly Fatal: "FATAL";
    readonly Info: "INFO";
    readonly Trace: "TRACE";
    readonly Warn: "WARN";
};
/**
 * @public
 */
export type ApplicationLogLevel = typeof ApplicationLogLevel[keyof typeof ApplicationLogLevel];
/**
 * @public
 * @enum
 */
export declare const Architecture: {
    readonly arm64: "arm64";
    readonly x86_64: "x86_64";
};
/**
 * @public
 */
export type Architecture = typeof Architecture[keyof typeof Architecture];
/**
 * @public
 * @enum
 */
export declare const OperationAction: {
    readonly CANCEL: "CANCEL";
    readonly FAIL: "FAIL";
    readonly RETRY: "RETRY";
    readonly START: "START";
    readonly SUCCEED: "SUCCEED";
};
/**
 * @public
 */
export type OperationAction = typeof OperationAction[keyof typeof OperationAction];
/**
 * @public
 */
export interface CallbackOptions {
    TimeoutSeconds?: number | undefined;
    HeartbeatTimeoutSeconds?: number | undefined;
}
/**
 * @public
 */
export interface ContextOptions {
    ReplayChildren?: boolean | undefined;
}
/**
 * @public
 */
export interface ErrorObject {
    ErrorMessage?: string | undefined;
    ErrorType?: string | undefined;
    ErrorData?: string | undefined;
    StackTrace?: (string)[] | undefined;
}
/**
 * @internal
 */
export declare const ErrorObjectFilterSensitiveLog: (obj: ErrorObject) => any;
/**
 * @public
 */
export interface InvokeOptions {
    FunctionName?: string | undefined;
    FunctionQualifier?: string | undefined;
    DurableExecutionName?: string | undefined;
}
/**
 * @public
 */
export interface StepOptions {
    NextAttemptDelaySeconds?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const OperationType: {
    readonly CALLBACK: "CALLBACK";
    readonly CONTEXT: "CONTEXT";
    readonly EXECUTION: "EXECUTION";
    readonly INVOKE: "INVOKE";
    readonly STEP: "STEP";
    readonly WAIT: "WAIT";
};
/**
 * @public
 */
export type OperationType = typeof OperationType[keyof typeof OperationType];
/**
 * @public
 */
export interface WaitOptions {
    WaitSeconds?: number | undefined;
}
/**
 * @public
 */
export interface OperationUpdate {
    Id?: string | undefined;
    ParentId?: string | undefined;
    Name?: string | undefined;
    Type?: OperationType | undefined;
    SubType?: string | undefined;
    Action?: OperationAction | undefined;
    Payload?: string | undefined;
    Error?: ErrorObject | undefined;
    ContextOptions?: ContextOptions | undefined;
    StepOptions?: StepOptions | undefined;
    WaitOptions?: WaitOptions | undefined;
    CallbackOptions?: CallbackOptions | undefined;
    InvokeOptions?: InvokeOptions | undefined;
}
/**
 * @internal
 */
export declare const OperationUpdateFilterSensitiveLog: (obj: OperationUpdate) => any;
/**
 * @public
 */
export interface CheckpointDurableExecutionRequest {
    CheckpointToken: string | undefined;
    Updates?: (OperationUpdate)[] | undefined;
    ClientToken?: string | undefined;
}
/**
 * @internal
 */
export declare const CheckpointDurableExecutionRequestFilterSensitiveLog: (obj: CheckpointDurableExecutionRequest) => any;
/**
 * @public
 */
export interface CallbackDetails {
    CallbackId?: string | undefined;
    Result?: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const CallbackDetailsFilterSensitiveLog: (obj: CallbackDetails) => any;
/**
 * @public
 */
export interface ContextDetails {
    ReplayChildren?: boolean | undefined;
    Result?: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const ContextDetailsFilterSensitiveLog: (obj: ContextDetails) => any;
/**
 * @public
 */
export interface ExecutionDetails {
    InputPayload?: string | undefined;
}
/**
 * @internal
 */
export declare const ExecutionDetailsFilterSensitiveLog: (obj: ExecutionDetails) => any;
/**
 * @public
 */
export interface InvokeDetails {
    DurableExecutionArn?: string | undefined;
    Result?: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const InvokeDetailsFilterSensitiveLog: (obj: InvokeDetails) => any;
/**
 * @public
 * @enum
 */
export declare const OperationStatus: {
    readonly CANCELLED: "CANCELLED";
    readonly FAILED: "FAILED";
    readonly PENDING: "PENDING";
    readonly READY: "READY";
    readonly STARTED: "STARTED";
    readonly STOPPED: "STOPPED";
    readonly SUCCEEDED: "SUCCEEDED";
    readonly TIMED_OUT: "TIMED_OUT";
};
/**
 * @public
 */
export type OperationStatus = typeof OperationStatus[keyof typeof OperationStatus];
/**
 * @public
 */
export interface StepDetails {
    Attempt?: number | undefined;
    NextAttemptTimestamp?: Date | undefined;
    Result?: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const StepDetailsFilterSensitiveLog: (obj: StepDetails) => any;
/**
 * @public
 */
export interface WaitDetails {
    ScheduledTimestamp?: Date | undefined;
}
/**
 * @public
 */
export interface Operation {
    Id?: string | undefined;
    ParentId?: string | undefined;
    Name?: string | undefined;
    Type?: OperationType | undefined;
    SubType?: string | undefined;
    StartTimestamp?: Date | undefined;
    EndTimestamp?: Date | undefined;
    Status?: OperationStatus | undefined;
    ExecutionDetails?: ExecutionDetails | undefined;
    ContextDetails?: ContextDetails | undefined;
    StepDetails?: StepDetails | undefined;
    WaitDetails?: WaitDetails | undefined;
    CallbackDetails?: CallbackDetails | undefined;
    InvokeDetails?: InvokeDetails | undefined;
}
/**
 * @internal
 */
export declare const OperationFilterSensitiveLog: (obj: Operation) => any;
/**
 * @public
 */
export interface CheckpointUpdatedExecutionState {
    Operations?: (Operation)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const CheckpointUpdatedExecutionStateFilterSensitiveLog: (obj: CheckpointUpdatedExecutionState) => any;
/**
 * @public
 */
export interface CheckpointDurableExecutionResponse {
    CheckpointToken?: string | undefined;
    NewExecutionState?: CheckpointUpdatedExecutionState | undefined;
}
/**
 * @internal
 */
export declare const CheckpointDurableExecutionResponseFilterSensitiveLog: (obj: CheckpointDurableExecutionResponse) => any;
/**
 * @public
 */
export interface CreateAliasRequest20150331 {
    FunctionName: string | undefined;
    Name: string | undefined;
    FunctionVersion: string | undefined;
    Description?: string | undefined;
    RoutingConfig?: AliasRoutingConfiguration | undefined;
}
/**
 * @public
 * @enum
 */
export declare const CodeSigningPolicy: {
    readonly Enforce: "Enforce";
    readonly Warn: "Warn";
};
/**
 * @public
 */
export type CodeSigningPolicy = typeof CodeSigningPolicy[keyof typeof CodeSigningPolicy];
/**
 * @public
 */
export interface CodeSigningPolicies {
    UntrustedArtifactOnDeployment: CodeSigningPolicy | undefined;
}
/**
 * @public
 */
export interface CreateCodeSigningConfigRequest {
    Description?: string | undefined;
    AllowedPublishers: AllowedPublishers | undefined;
    CodeSigningPolicies: CodeSigningPolicies | undefined;
    Tags?: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface CodeSigningConfig {
    CodeSigningConfigId: string | undefined;
    CodeSigningConfigArn: string | undefined;
    Description?: string | undefined;
    AllowedPublishers: AllowedPublishers | undefined;
    CodeSigningPolicies: CodeSigningPolicies | undefined;
    LastModified: string | undefined;
}
/**
 * @public
 */
export interface CreateCodeSigningConfigResponse {
    CodeSigningConfig: CodeSigningConfig | undefined;
}
/**
 * @public
 */
export interface OnFailure {
    Destination?: string | undefined;
}
/**
 * @public
 */
export interface OnSuccess {
    Destination?: string | undefined;
}
/**
 * @public
 */
export interface DestinationConfig {
    OnSuccess?: OnSuccess | undefined;
    OnFailure?: OnFailure | undefined;
}
/**
 * @public
 * @enum
 */
export declare const FullDocument: {
    readonly Default: "Default";
    readonly UpdateLookup: "UpdateLookup";
};
/**
 * @public
 */
export type FullDocument = typeof FullDocument[keyof typeof FullDocument];
/**
 * @public
 */
export interface DocumentDBEventSourceConfig {
    DatabaseName?: string | undefined;
    CollectionName?: string | undefined;
    FullDocument?: FullDocument | undefined;
}
/**
 * @public
 */
export interface Filter {
    Pattern?: string | undefined;
}
/**
 * @public
 */
export interface FilterCriteria {
    Filters?: (Filter)[] | undefined;
}
/**
 * @public
 * @enum
 */
export declare const FunctionResponseType: {
    readonly ReportBatchItemFailures: "ReportBatchItemFailures";
};
/**
 * @public
 */
export type FunctionResponseType = typeof FunctionResponseType[keyof typeof FunctionResponseType];
/**
 * @public
 * @enum
 */
export declare const EventSourceMappingMetric: {
    readonly EventCount: "EventCount";
};
/**
 * @public
 */
export type EventSourceMappingMetric = typeof EventSourceMappingMetric[keyof typeof EventSourceMappingMetric];
/**
 * @public
 */
export interface EventSourceMappingMetricsConfig {
    Metrics?: (EventSourceMappingMetric)[] | undefined;
}
/**
 * @public
 */
export interface ProvisionedPollerConfig {
    MinimumPollers?: number | undefined;
    MaximumPollers?: number | undefined;
}
/**
 * @public
 */
export interface ScalingConfig {
    MaximumConcurrency?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const EndPointType: {
    readonly KAFKA_BOOTSTRAP_SERVERS: "KAFKA_BOOTSTRAP_SERVERS";
};
/**
 * @public
 */
export type EndPointType = typeof EndPointType[keyof typeof EndPointType];
/**
 * @public
 */
export interface SelfManagedEventSource {
    Endpoints?: Partial<Record<EndPointType, (string)[]>> | undefined;
}
/**
 * @public
 */
export interface SelfManagedKafkaEventSourceConfig {
    ConsumerGroupId?: string | undefined;
    SchemaRegistryConfig?: KafkaSchemaRegistryConfig | undefined;
}
/**
 * @public
 * @enum
 */
export declare const SourceAccessType: {
    readonly BASIC_AUTH: "BASIC_AUTH";
    readonly CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH";
    readonly SASL_SCRAM_256_AUTH: "SASL_SCRAM_256_AUTH";
    readonly SASL_SCRAM_512_AUTH: "SASL_SCRAM_512_AUTH";
    readonly SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE";
    readonly VIRTUAL_HOST: "VIRTUAL_HOST";
    readonly VPC_SECURITY_GROUP: "VPC_SECURITY_GROUP";
    readonly VPC_SUBNET: "VPC_SUBNET";
};
/**
 * @public
 */
export type SourceAccessType = typeof SourceAccessType[keyof typeof SourceAccessType];
/**
 * @public
 */
export interface SourceAccessConfiguration {
    Type?: SourceAccessType | undefined;
    URI?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const EventSourcePosition: {
    readonly AT_TIMESTAMP: "AT_TIMESTAMP";
    readonly LATEST: "LATEST";
    readonly TRIM_HORIZON: "TRIM_HORIZON";
};
/**
 * @public
 */
export type EventSourcePosition = typeof EventSourcePosition[keyof typeof EventSourcePosition];
/**
 * @public
 */
export interface CreateEventSourceMappingRequest {
    EventSourceArn?: string | undefined;
    FunctionName: string | undefined;
    Enabled?: boolean | undefined;
    BatchSize?: number | undefined;
    FilterCriteria?: FilterCriteria | undefined;
    KMSKeyArn?: string | undefined;
    MetricsConfig?: EventSourceMappingMetricsConfig | undefined;
    ScalingConfig?: ScalingConfig | undefined;
    MaximumBatchingWindowInSeconds?: number | undefined;
    ParallelizationFactor?: number | undefined;
    StartingPosition?: EventSourcePosition | undefined;
    StartingPositionTimestamp?: Date | undefined;
    DestinationConfig?: DestinationConfig | undefined;
    MaximumRecordAgeInSeconds?: number | undefined;
    BisectBatchOnFunctionError?: boolean | undefined;
    MaximumRetryAttempts?: number | undefined;
    PartialBatchResponse?: boolean | undefined;
    Tags?: Record<string, string> | undefined;
    TumblingWindowInSeconds?: number | undefined;
    Topics?: (string)[] | undefined;
    Queues?: (string)[] | undefined;
    SourceAccessConfigurations?: (SourceAccessConfiguration)[] | undefined;
    SelfManagedEventSource?: SelfManagedEventSource | undefined;
    FunctionResponseTypes?: (FunctionResponseType)[] | undefined;
    AmazonManagedKafkaEventSourceConfig?: AmazonManagedKafkaEventSourceConfig | undefined;
    SelfManagedKafkaEventSourceConfig?: SelfManagedKafkaEventSourceConfig | undefined;
    DocumentDBEventSourceConfig?: DocumentDBEventSourceConfig | undefined;
    ProvisionedPollerConfig?: ProvisionedPollerConfig | undefined;
}
/**
 * @public
 */
export interface FilterCriteriaError {
    ErrorCode?: string | undefined;
    Message?: string | undefined;
}
/**
 * @public
 */
export interface EventSourceMappingConfiguration {
    UUID?: string | undefined;
    StartingPosition?: EventSourcePosition | undefined;
    StartingPositionTimestamp?: Date | undefined;
    BatchSize?: number | undefined;
    MaximumBatchingWindowInSeconds?: number | undefined;
    ParallelizationFactor?: number | undefined;
    EventSourceArn?: string | undefined;
    FilterCriteria?: FilterCriteria | undefined;
    FilterCriteriaError?: FilterCriteriaError | undefined;
    KMSKeyArn?: string | undefined;
    MetricsConfig?: EventSourceMappingMetricsConfig | undefined;
    ScalingConfig?: ScalingConfig | undefined;
    FunctionArn?: string | undefined;
    LastModified?: Date | undefined;
    LastProcessingResult?: string | undefined;
    State?: string | undefined;
    StateTransitionReason?: string | undefined;
    DestinationConfig?: DestinationConfig | undefined;
    Topics?: (string)[] | undefined;
    Queues?: (string)[] | undefined;
    SourceAccessConfigurations?: (SourceAccessConfiguration)[] | undefined;
    SelfManagedEventSource?: SelfManagedEventSource | undefined;
    MaximumRecordAgeInSeconds?: number | undefined;
    BisectBatchOnFunctionError?: boolean | undefined;
    MaximumRetryAttempts?: number | undefined;
    PartialBatchResponse?: boolean | undefined;
    TumblingWindowInSeconds?: number | undefined;
    FunctionResponseTypes?: (FunctionResponseType)[] | undefined;
    AmazonManagedKafkaEventSourceConfig?: AmazonManagedKafkaEventSourceConfig | undefined;
    SelfManagedKafkaEventSourceConfig?: SelfManagedKafkaEventSourceConfig | undefined;
    DocumentDBEventSourceConfig?: DocumentDBEventSourceConfig | undefined;
    EventSourceMappingArn?: string | undefined;
    ProvisionedPollerConfig?: ProvisionedPollerConfig | undefined;
}
/**
 * @public
 */
export declare class CodeSigningConfigNotFoundException extends __BaseException {
    readonly name: "CodeSigningConfigNotFoundException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<CodeSigningConfigNotFoundException, __BaseException>);
}
/**
 * @public
 */
export declare class CodeStorageExceededException extends __BaseException {
    readonly name: "CodeStorageExceededException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<CodeStorageExceededException, __BaseException>);
}
/**
 * @public
 */
export declare class CodeVerificationFailedException extends __BaseException {
    readonly name: "CodeVerificationFailedException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<CodeVerificationFailedException, __BaseException>);
}
/**
 * @public
 * @enum
 */
export declare const S3ObjectStorageMode: {
    readonly Copy: "COPY";
    readonly Reference: "REFERENCE";
};
/**
 * @public
 */
export type S3ObjectStorageMode = typeof S3ObjectStorageMode[keyof typeof S3ObjectStorageMode];
/**
 * @public
 */
export interface FunctionCode {
    ZipFile?: Uint8Array | undefined;
    S3Bucket?: string | undefined;
    S3Key?: string | undefined;
    S3ObjectVersion?: string | undefined;
    S3ObjectStorageMode?: S3ObjectStorageMode | undefined;
    ImageUri?: string | undefined;
    SourceKMSKeyArn?: string | undefined;
}
/**
 * @internal
 */
export declare const FunctionCodeFilterSensitiveLog: (obj: FunctionCode) => any;
/**
 * @public
 */
export interface DeadLetterConfig {
    TargetArn?: string | undefined;
}
/**
 * @public
 */
export interface DurableConfig {
    RetentionPeriodInDays?: number | undefined;
    ExecutionTimeout?: number | undefined;
}
/**
 * @public
 */
export interface Environment {
    Variables?: Record<string, string> | undefined;
}
/**
 * @internal
 */
export declare const EnvironmentFilterSensitiveLog: (obj: Environment) => any;
/**
 * @public
 */
export interface EphemeralStorage {
    Size: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ConcurrencyMode: {
    readonly MULTI: "MULTI";
    readonly SINGLE: "SINGLE";
};
/**
 * @public
 */
export type ConcurrencyMode = typeof ConcurrencyMode[keyof typeof ConcurrencyMode];
/**
 * @public
 */
export interface MultiConcurrencyConfig {
    MaxConcurrency: number | undefined;
}
/**
 * @public
 */
export interface ExecutionEnvironmentConcurrencyConfig {
    ConcurrencyMode: ConcurrencyMode | undefined;
    MultiConcurrencyConfig?: MultiConcurrencyConfig | undefined;
}
/**
 * @public
 */
export interface FileSystemConfig {
    Arn: string | undefined;
    LocalMountPath: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const UserOverride: {
    readonly AllowRoot: "AllowRoot";
    readonly AllowUnprivileged: "AllowUnprivileged";
    readonly Deny: "Deny";
};
/**
 * @public
 */
export type UserOverride = typeof UserOverride[keyof typeof UserOverride];
/**
 * @public
 */
export interface ImageConfig {
    EntryPoint?: (string)[] | undefined;
    Command?: (string)[] | undefined;
    WorkingDirectory?: string | undefined;
    User?: string | undefined;
    UserOverride?: UserOverride | undefined;
}
/**
 * @public
 * @enum
 */
export declare const LogFormat: {
    readonly Json: "JSON";
    readonly Text: "Text";
};
/**
 * @public
 */
export type LogFormat = typeof LogFormat[keyof typeof LogFormat];
/**
 * @public
 * @enum
 */
export declare const SystemLogLevel: {
    readonly Debug: "DEBUG";
    readonly Info: "INFO";
    readonly Warn: "WARN";
};
/**
 * @public
 */
export type SystemLogLevel = typeof SystemLogLevel[keyof typeof SystemLogLevel];
/**
 * @public
 */
export interface LoggingConfig {
    LogFormat?: LogFormat | undefined;
    ApplicationLogLevel?: ApplicationLogLevel | undefined;
    SystemLogLevel?: SystemLogLevel | undefined;
    LogGroup?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const PackageType: {
    readonly Image: "Image";
    readonly Zip: "Zip";
};
/**
 * @public
 */
export type PackageType = typeof PackageType[keyof typeof PackageType];
/**
 * @public
 * @enum
 */
export declare const ProgrammingModel: {
    readonly HANDLER: "HANDLER";
    readonly WEB: "WEB";
};
/**
 * @public
 */
export type ProgrammingModel = typeof ProgrammingModel[keyof typeof ProgrammingModel];
/**
 * @public
 * @enum
 */
export declare const FunctionVersionLatestPublished: {
    readonly LATEST_PUBLISHED: "LATEST_PUBLISHED";
};
/**
 * @public
 */
export type FunctionVersionLatestPublished = typeof FunctionVersionLatestPublished[keyof typeof FunctionVersionLatestPublished];
/**
 * @public
 * @enum
 */
export declare const Runtime: {
    readonly byol: "byol";
    readonly dotnet10: "dotnet10";
    readonly dotnet6: "dotnet6";
    readonly dotnet8: "dotnet8";
    readonly dotnetcore10: "dotnetcore1.0";
    readonly dotnetcore20: "dotnetcore2.0";
    readonly dotnetcore21: "dotnetcore2.1";
    readonly dotnetcore31: "dotnetcore3.1";
    readonly go19: "go1.9";
    readonly go1x: "go1.x";
    readonly java11: "java11";
    readonly java17: "java17";
    readonly java21: "java21";
    readonly java25: "java25";
    readonly java8: "java8";
    readonly java8al2: "java8.al2";
    readonly nodejs: "nodejs";
    readonly nodejs10x: "nodejs10.x";
    readonly nodejs12x: "nodejs12.x";
    readonly nodejs14x: "nodejs14.x";
    readonly nodejs16x: "nodejs16.x";
    readonly nodejs18x: "nodejs18.x";
    readonly nodejs20x: "nodejs20.x";
    readonly nodejs22x: "nodejs22.x";
    readonly nodejs24x: "nodejs24.x";
    readonly nodejs43: "nodejs4.3";
    readonly nodejs43edge: "nodejs4.3-edge";
    readonly nodejs610: "nodejs6.10";
    readonly nodejs810: "nodejs8.10";
    readonly provided: "provided";
    readonly providedal2: "provided.al2";
    readonly providedal2023: "provided.al2023";
    readonly python27: "python2.7";
    readonly python27greengrass: "python2.7-greengrass";
    readonly python310: "python3.10";
    readonly python311: "python3.11";
    readonly python312: "python3.12";
    readonly python313: "python3.13";
    readonly python314: "python3.14";
    readonly python36: "python3.6";
    readonly python37: "python3.7";
    readonly python38: "python3.8";
    readonly python39: "python3.9";
    readonly ruby25: "ruby2.5";
    readonly ruby27: "ruby2.7";
    readonly ruby32: "ruby3.2";
    readonly ruby33: "ruby3.3";
    readonly ruby34: "ruby3.4";
};
/**
 * @public
 */
export type Runtime = typeof Runtime[keyof typeof Runtime];
/**
 * @public
 * @enum
 */
export declare const SnapStartApplyOn: {
    readonly None: "None";
    readonly PublishedVersions: "PublishedVersions";
};
/**
 * @public
 */
export type SnapStartApplyOn = typeof SnapStartApplyOn[keyof typeof SnapStartApplyOn];
/**
 * @public
 */
export interface SnapStart {
    ApplyOn?: SnapStartApplyOn | undefined;
}
/**
 * @public
 * @enum
 */
export declare const TenantIsolationMode: {
    readonly PER_INVOKE: "PER_INVOKE";
    readonly PER_TENANT: "PER_TENANT";
};
/**
 * @public
 */
export type TenantIsolationMode = typeof TenantIsolationMode[keyof typeof TenantIsolationMode];
/**
 * @public
 */
export interface TenancyConfig {
    TenantIsolationMode: TenantIsolationMode | undefined;
}
/**
 * @public
 * @enum
 */
export declare const TracingMode: {
    readonly Active: "Active";
    readonly PassThrough: "PassThrough";
};
/**
 * @public
 */
export type TracingMode = typeof TracingMode[keyof typeof TracingMode];
/**
 * @public
 */
export interface TracingConfig {
    Mode?: TracingMode | undefined;
}
/**
 * @public
 */
export interface VpcConfig {
    SubnetIds?: (string)[] | undefined;
    SecurityGroupIds?: (string)[] | undefined;
    Ipv6AllowedForDualStack?: boolean | undefined;
    VpcDelegationRole?: string | undefined;
    VpcOwnerRole?: string | undefined;
    TargetSourceArn?: string | undefined;
}
/**
 * @public
 */
export interface HttpGet {
    Port?: number | undefined;
    Path?: string | undefined;
}
/**
 * @public
 */
export interface TCPSocket {
    Port?: number | undefined;
}
/**
 * @public
 */
export interface ReadinessCheckConfig {
    HttpGet?: HttpGet | undefined;
    TCPSocket?: TCPSocket | undefined;
}
/**
 * @public
 */
export interface WebProgrammingModelConfig {
    Port?: number | undefined;
    ReadinessCheckConfig?: ReadinessCheckConfig | undefined;
}
/**
 * @public
 */
export interface CreateFunctionRequest {
    FunctionName: string | undefined;
    Runtime?: Runtime | undefined;
    Role: string | undefined;
    PollerCustomerVpcRole?: string | undefined;
    Handler?: string | undefined;
    Code: FunctionCode | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
    Publish?: boolean | undefined;
    VpcConfig?: VpcConfig | undefined;
    DeadLetterConfig?: DeadLetterConfig | undefined;
    Environment?: Environment | undefined;
    KMSKeyArn?: string | undefined;
    TracingConfig?: TracingConfig | undefined;
    Tags?: Record<string, string> | undefined;
    MasterArn?: string | undefined;
    Layers?: (string)[] | undefined;
    FileSystemConfigs?: (FileSystemConfig)[] | undefined;
    CodeSigningConfigArn?: string | undefined;
    PackageType?: PackageType | undefined;
    ImageConfig?: ImageConfig | undefined;
    Architectures?: (Architecture)[] | undefined;
    EphemeralStorage?: EphemeralStorage | undefined;
    SnapStart?: SnapStart | undefined;
    LoggingConfig?: LoggingConfig | undefined;
    ProgrammingModel?: ProgrammingModel | undefined;
    WebProgrammingModelConfig?: WebProgrammingModelConfig | undefined;
    ExecutionEnvironmentConcurrencyConfig?: ExecutionEnvironmentConcurrencyConfig | undefined;
    TenancyConfig?: TenancyConfig | undefined;
    PublishTo?: FunctionVersionLatestPublished | undefined;
    DurableConfig?: DurableConfig | undefined;
}
/**
 * @internal
 */
export declare const CreateFunctionRequestFilterSensitiveLog: (obj: CreateFunctionRequest) => any;
/**
 * @public
 */
export interface EnvironmentError {
    ErrorCode?: string | undefined;
    Message?: string | undefined;
}
/**
 * @internal
 */
export declare const EnvironmentErrorFilterSensitiveLog: (obj: EnvironmentError) => any;
/**
 * @public
 */
export interface EnvironmentResponse {
    Variables?: Record<string, string> | undefined;
    Error?: EnvironmentError | undefined;
}
/**
 * @internal
 */
export declare const EnvironmentResponseFilterSensitiveLog: (obj: EnvironmentResponse) => any;
/**
 * @public
 */
export interface ImageConfigError {
    ErrorCode?: string | undefined;
    Message?: string | undefined;
}
/**
 * @internal
 */
export declare const ImageConfigErrorFilterSensitiveLog: (obj: ImageConfigError) => any;
/**
 * @public
 */
export interface ImageConfigResponse {
    ImageConfig?: ImageConfig | undefined;
    Error?: ImageConfigError | undefined;
}
/**
 * @internal
 */
export declare const ImageConfigResponseFilterSensitiveLog: (obj: ImageConfigResponse) => any;
/**
 * @public
 * @enum
 */
export declare const LastUpdateStatus: {
    readonly Failed: "Failed";
    readonly InProgress: "InProgress";
    readonly Successful: "Successful";
};
/**
 * @public
 */
export type LastUpdateStatus = typeof LastUpdateStatus[keyof typeof LastUpdateStatus];
/**
 * @public
 * @enum
 */
export declare const LastUpdateStatusReasonCode: {
    readonly DisabledKMSKey: "DisabledKMSKey";
    readonly EFSIOError: "EFSIOError";
    readonly EFSMountConnectivityError: "EFSMountConnectivityError";
    readonly EFSMountFailure: "EFSMountFailure";
    readonly EFSMountTimeout: "EFSMountTimeout";
    readonly EniLimitExceeded: "EniLimitExceeded";
    readonly FunctionError: "FunctionError";
    readonly ImageAccessDenied: "ImageAccessDenied";
    readonly ImageDeleted: "ImageDeleted";
    readonly InsufficientRolePermissions: "InsufficientRolePermissions";
    readonly InternalError: "InternalError";
    readonly InvalidConfiguration: "InvalidConfiguration";
    readonly InvalidImage: "InvalidImage";
    readonly InvalidRuntime: "InvalidRuntime";
    readonly InvalidSecurityGroup: "InvalidSecurityGroup";
    readonly InvalidStateKMSKey: "InvalidStateKMSKey";
    readonly InvalidSubnet: "InvalidSubnet";
    readonly InvalidZipFileException: "InvalidZipFileException";
    readonly KMSKeyAccessDenied: "KMSKeyAccessDenied";
    readonly KMSKeyNotFound: "KMSKeyNotFound";
    readonly SubnetOutOfIPAddresses: "SubnetOutOfIPAddresses";
};
/**
 * @public
 */
export type LastUpdateStatusReasonCode = typeof LastUpdateStatusReasonCode[keyof typeof LastUpdateStatusReasonCode];
/**
 * @public
 */
export interface Layer {
    Arn?: string | undefined;
    CodeSize?: number | undefined;
    UncompressedCodeSize?: number | undefined;
    SigningProfileVersionArn?: string | undefined;
    SigningJobArn?: string | undefined;
}
/**
 * @public
 */
export interface RuntimeVersionConfig {
    RuntimeVersionArn?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const SnapStartOptimizationStatus: {
    readonly Off: "Off";
    readonly On: "On";
};
/**
 * @public
 */
export type SnapStartOptimizationStatus = typeof SnapStartOptimizationStatus[keyof typeof SnapStartOptimizationStatus];
/**
 * @public
 */
export interface SnapStartResponse {
    ApplyOn?: SnapStartApplyOn | undefined;
    OptimizationStatus?: SnapStartOptimizationStatus | undefined;
}
/**
 * @public
 * @enum
 */
export declare const State: {
    readonly Active: "Active";
    readonly ActiveNonInvocable: "ActiveNonInvocable";
    readonly Deactivated: "Deactivated";
    readonly Deactivating: "Deactivating";
    readonly Deleting: "Deleting";
    readonly Failed: "Failed";
    readonly Inactive: "Inactive";
    readonly Pending: "Pending";
};
/**
 * @public
 */
export type State = typeof State[keyof typeof State];
/**
 * @public
 * @enum
 */
export declare const StateReasonCode: {
    readonly Creating: "Creating";
    readonly DisabledKMSKey: "DisabledKMSKey";
    readonly EFSIOError: "EFSIOError";
    readonly EFSMountConnectivityError: "EFSMountConnectivityError";
    readonly EFSMountFailure: "EFSMountFailure";
    readonly EFSMountTimeout: "EFSMountTimeout";
    readonly EniLimitExceeded: "EniLimitExceeded";
    readonly FunctionError: "FunctionError";
    readonly Idle: "Idle";
    readonly ImageAccessDenied: "ImageAccessDenied";
    readonly ImageDeleted: "ImageDeleted";
    readonly InsufficientRolePermissions: "InsufficientRolePermissions";
    readonly InternalError: "InternalError";
    readonly InvalidConfiguration: "InvalidConfiguration";
    readonly InvalidImage: "InvalidImage";
    readonly InvalidRuntime: "InvalidRuntime";
    readonly InvalidSecurityGroup: "InvalidSecurityGroup";
    readonly InvalidStateKMSKey: "InvalidStateKMSKey";
    readonly InvalidSubnet: "InvalidSubnet";
    readonly InvalidZipFileException: "InvalidZipFileException";
    readonly KMSKeyAccessDenied: "KMSKeyAccessDenied";
    readonly KMSKeyNotFound: "KMSKeyNotFound";
    readonly Restoring: "Restoring";
    readonly SubnetOutOfIPAddresses: "SubnetOutOfIPAddresses";
};
/**
 * @public
 */
export type StateReasonCode = typeof StateReasonCode[keyof typeof StateReasonCode];
/**
 * @public
 */
export interface TracingConfigResponse {
    Mode?: TracingMode | undefined;
}
/**
 * @public
 */
export interface VpcConfigResponse {
    SubnetIds?: (string)[] | undefined;
    SecurityGroupIds?: (string)[] | undefined;
    VpcId?: string | undefined;
    Ipv6AllowedForDualStack?: boolean | undefined;
    VpcDelegationRole?: string | undefined;
    VpcOwnerRole?: string | undefined;
    TargetSourceArn?: string | undefined;
}
/**
 * @public
 */
export interface FunctionConfiguration20150331 {
    FunctionName?: string | undefined;
    FunctionArn?: string | undefined;
    Runtime?: Runtime | undefined;
    Role?: string | undefined;
    PollerCustomerVpcRole?: string | undefined;
    FunctionVersionId?: string | undefined;
    Handler?: string | undefined;
    CodeSize?: number | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
    LastModified?: string | undefined;
    CodeSha256?: string | undefined;
    Version?: string | undefined;
    VpcConfig?: VpcConfigResponse | undefined;
    DeadLetterConfig?: DeadLetterConfig | undefined;
    Environment?: EnvironmentResponse | undefined;
    KMSKeyArn?: string | undefined;
    TracingConfig?: TracingConfigResponse | undefined;
    MasterArn?: string | undefined;
    RevisionId?: string | undefined;
    Layers?: (Layer)[] | undefined;
    State?: State | undefined;
    StateReason?: string | undefined;
    StateReasonCode?: StateReasonCode | undefined;
    LastUpdateStatus?: LastUpdateStatus | undefined;
    LastUpdateStatusReason?: string | undefined;
    LastUpdateStatusReasonCode?: LastUpdateStatusReasonCode | undefined;
    FileSystemConfigs?: (FileSystemConfig)[] | undefined;
    SigningProfileVersionArn?: string | undefined;
    SigningJobArn?: string | undefined;
    PackageType?: PackageType | undefined;
    ImageConfigResponse?: ImageConfigResponse | undefined;
    Architectures?: (Architecture)[] | undefined;
    EphemeralStorage?: EphemeralStorage | undefined;
    SnapStart?: SnapStartResponse | undefined;
    RuntimeVersionConfig?: RuntimeVersionConfig | undefined;
    LoggingConfig?: LoggingConfig | undefined;
    ProgrammingModel?: ProgrammingModel | undefined;
    WebProgrammingModelConfig?: WebProgrammingModelConfig | undefined;
    ExecutionEnvironmentConcurrencyConfig?: ExecutionEnvironmentConcurrencyConfig | undefined;
    TenancyConfig?: TenancyConfig | undefined;
    ConfigSha256?: string | undefined;
    DurableConfig?: DurableConfig | undefined;
}
/**
 * @internal
 */
export declare const FunctionConfiguration20150331FilterSensitiveLog: (obj: FunctionConfiguration20150331) => any;
/**
 * @public
 */
export declare class InvalidCodeSignatureException extends __BaseException {
    readonly name: "InvalidCodeSignatureException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidCodeSignatureException, __BaseException>);
}
/**
 * @public
 */
export interface Cors {
    AllowCredentials?: boolean | undefined;
    AllowHeaders?: (string)[] | undefined;
    AllowMethods?: (string)[] | undefined;
    AllowOrigins?: (string)[] | undefined;
    ExposeHeaders?: (string)[] | undefined;
    MaxAge?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const InvokeMode: {
    readonly BUFFERED: "BUFFERED";
    readonly RESPONSE_STREAM: "RESPONSE_STREAM";
};
/**
 * @public
 */
export type InvokeMode = typeof InvokeMode[keyof typeof InvokeMode];
/**
 * @public
 */
export interface CreateFunctionUrlConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    AuthType: FunctionUrlAuthType | undefined;
    Cors?: Cors | undefined;
    InvokeMode?: InvokeMode | undefined;
}
/**
 * @public
 */
export interface CreateFunctionUrlConfigResponse {
    FunctionUrl: string | undefined;
    FunctionArn: string | undefined;
    AuthType: FunctionUrlAuthType | undefined;
    Cors?: Cors | undefined;
    CreationTime: string | undefined;
    InvokeMode?: InvokeMode | undefined;
}
/**
 * @public
 */
export interface DeleteAccountSettingsInternalRequest {
    AccountId: string | undefined;
}
/**
 * @public
 */
export interface DeleteAliasRequest20150331 {
    FunctionName: string | undefined;
    Name: string | undefined;
}
/**
 * @public
 */
export interface DeleteCodeSigningConfigRequest {
    CodeSigningConfigArn: string | undefined;
}
/**
 * @public
 */
export interface DeleteCodeSigningConfigResponse {
}
/**
 * @public
 */
export interface DeleteEventSourceMappingRequest {
    UUID: string | undefined;
}
/**
 * @public
 */
export declare class ResourceInUseException extends __BaseException {
    readonly name: "ResourceInUseException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ResourceInUseException, __BaseException>);
}
/**
 * @public
 */
export interface DeleteFunctionRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    MasterArn?: string | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionResponse {
    StatusCode?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ResourceType: {
    readonly CODE_ARTIFACT: "CODE_ARTIFACT";
    readonly PROVISIONED_CONCURRENCY: "PROVISIONED_CONCURRENCY";
};
/**
 * @public
 */
export type ResourceType = typeof ResourceType[keyof typeof ResourceType];
/**
 * @public
 */
export interface DeleteFunctionAliasResourceMappingRequest {
    FunctionArn: string | undefined;
    Alias: string | undefined;
    ResourceType: ResourceType | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionCodeSigningConfigRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionConcurrencyRequest20171031 {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionEventInvokeConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const FunctionResourceType: {
    readonly PER_FUNCTION_CONCURRENCY: "PER_FUNCTION_CONCURRENCY";
};
/**
 * @public
 */
export type FunctionResourceType = typeof FunctionResourceType[keyof typeof FunctionResourceType];
/**
 * @public
 */
export interface DeleteFunctionResourceMappingRequest {
    FunctionArn: string | undefined;
    ResourceType: FunctionResourceType | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionResourceMappingResponse {
    FunctionId: string | undefined;
    FunctionSequenceNumber?: number | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionUrlConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionVersionResourceMappingRequest {
    FunctionArn: string | undefined;
    Version: string | undefined;
    ResourceType: ResourceType | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionVersionResourcesInternalRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface DeleteFunctionVersionResourcesInternalResponse {
    VpcConfigResponse?: VpcConfigResponse | undefined;
}
/**
 * @public
 */
export interface DeleteLayerVersionRequest20181031 {
    LayerName: string | undefined;
    VersionNumber: number | undefined;
}
/**
 * @public
 */
export interface DeleteMigratedLayerVersionRequest {
    LayerVersionArn: string | undefined;
}
/**
 * @public
 */
export interface DeleteProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
}
/**
 * @public
 */
export interface DeleteProvisionedConcurrencyConfigInternalRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
}
/**
 * @public
 */
export interface DeleteResourcePolicyRequest {
    ResourceArn: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface DisableFunctionRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface DisablePublicAccessBlockConfigRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface DisablePublicAccessBlockConfigResponse {
    Disabled?: boolean | undefined;
}
/**
 * @public
 */
export interface DisableReplicationRequest20170630 {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface EnableReplicationRequest20170630 {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface EnableReplicationResponse {
    Statement?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface ExportAccountSettingsRequest {
    AccountId: string | undefined;
}
/**
 * @public
 */
export interface CodeStorageTableEntry {
    AliasCount?: number | undefined;
    FunctionCount?: number | undefined;
    CodeSizeBytes?: number | undefined;
}
/**
 * @public
 * @enum
 */
export declare const FeatureStatus: {
    readonly Accessible: "Accessible";
    readonly Inaccessible: "Inaccessible";
};
/**
 * @public
 */
export type FeatureStatus = typeof FeatureStatus[keyof typeof FeatureStatus];
/**
 * @public
 */
export interface FeaturesListItem {
    FeatureName?: string | undefined;
    FeatureStatus?: FeatureStatus | undefined;
}
/**
 * @public
 */
export interface CustomerConfigInternal {
    AccountId?: string | undefined;
    CellId?: string | undefined;
    ControlAPIThrottleLimit?: number | undefined;
    DeprecatedFeaturesControlAccess?: (string)[] | undefined;
    DeprecatedFeaturesInvokeAccess?: (string)[] | undefined;
    Enabled?: boolean | undefined;
    EniLimit?: number | undefined;
    EniVpcLimits?: Record<string, number> | undefined;
    EventSourceMappingRestrictions?: (string)[] | undefined;
    GetFunctionAPIThrottleLimit?: number | undefined;
    GetPolicyAPIThrottleLimit?: number | undefined;
    InvokeAsyncThrottleLimit?: number | undefined;
    LargeCloudFunctionConcurrencyLimit?: number | undefined;
    MaxQueueDepth?: number | undefined;
    PreviewFeatures?: (string)[] | undefined;
    DenyListFeatures?: (string)[] | undefined;
    RequestSignerInvokeTpsLimitOverride?: number | undefined;
    RuntimesPinnedToAL1703ByDefaultOnCreate?: (string)[] | undefined;
    RuntimesPinnedToAL1703ByDefaultOnUpdate?: (string)[] | undefined;
    SmallCloudFunctionConcurrencyLimit?: number | undefined;
    SqsQueueName?: string | undefined;
    UnreservedConcurrentExecutions?: number | undefined;
    UnreservedConcurrentExecutionsMinimum?: number | undefined;
    VersionString: string | undefined;
    MigrationStatus?: string | undefined;
    AliasLimit?: number | undefined;
    ArcScalingParameters?: Record<string, string> | undefined;
    TotalCodeSizeLimit?: number | undefined;
    AccountStatus?: string | undefined;
    AccountStatusTimestampAsEpochMilli?: number | undefined;
    AccountStatusEvent?: string | undefined;
    ConcurrencySequenceNumber?: number | undefined;
    CountingServiceBatchDivisor?: number | undefined;
    CountingServiceBatchParameters?: Record<string, number> | undefined;
    SplitCountParameters?: Record<string, number> | undefined;
    ProvisionedConcurrencyPreWarmingRate?: number | undefined;
    FunctionMemorySizeLimit?: number | undefined;
    AccountRiskMetadata?: Record<string, number> | undefined;
    AccountRiskStatusTimestamp?: Date | undefined;
    AccountRiskSource?: string | undefined;
    ShardPoolParameters?: Record<string, number> | undefined;
    Features?: (FeaturesListItem)[] | undefined;
}
/**
 * @public
 */
export interface MigrationAccountRiskSettings {
    RiskDetectedTime?: Date | undefined;
    RiskSource?: string | undefined;
    AccountRiskMetadata?: Record<string, number> | undefined;
}
/**
 * @public
 */
export interface ExportAccountSettingsResponse {
    CodeStorageTableEntry?: CodeStorageTableEntry | undefined;
    RiskSettings?: MigrationAccountRiskSettings | undefined;
    CustomerConfig?: CustomerConfigInternal | undefined;
}
/**
 * @public
 */
export interface ExportAliasRequest {
    AliasArn: string | undefined;
}
/**
 * @public
 */
export interface MigrationAlias {
    AliasArn?: string | undefined;
    AliasName?: string | undefined;
    FunctionVersion?: string | undefined;
    ModifiedDateInEpochMillis?: number | undefined;
    Policy?: string | undefined;
    Description?: string | undefined;
    AdditionalVersionWeights?: Record<string, number> | undefined;
    TargetAdditionalVersionWeights?: Record<string, number> | undefined;
    HashOfConsistentFields?: string | undefined;
    PublicPolicyAttached?: boolean | undefined;
}
/**
 * @public
 */
export interface ExportAliasResponse {
    MigrationAlias?: MigrationAlias | undefined;
}
/**
 * @public
 */
export interface ExportFunctionUrlConfigsRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface MigrationFunctionUrlConfig {
    FunctionUrl?: string | undefined;
    FunctionArn?: string | undefined;
    AuthType?: FunctionUrlAuthType | undefined;
    InvokeMode?: InvokeMode | undefined;
    LastModifiedTime?: string | undefined;
    CreationTime?: string | undefined;
    AccountId?: string | undefined;
    Qualifier?: string | undefined;
    UnqualifiedFunctionArn?: string | undefined;
    FunctionName?: string | undefined;
    UrlId?: string | undefined;
    RevisionId?: number | undefined;
    Cors?: Cors | undefined;
    Enabled?: boolean | undefined;
    HashOfConsistentFields?: string | undefined;
}
/**
 * @public
 */
export interface ExportFunctionUrlConfigsResponse {
    MigrationFunctionUrlConfig?: MigrationFunctionUrlConfig | undefined;
}
/**
 * @public
 */
export interface ExportFunctionVersionRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const CodeSignatureStatus: {
    readonly CORRUPT: "CORRUPT";
    readonly EXPIRED: "EXPIRED";
    readonly MISMATCH: "MISMATCH";
    readonly REVOKED: "REVOKED";
    readonly VALID: "VALID";
};
/**
 * @public
 */
export type CodeSignatureStatus = typeof CodeSignatureStatus[keyof typeof CodeSignatureStatus];
/**
 * @public
 */
export interface LayerConfig {
    LayerArn?: string | undefined;
    S3CodeUri?: string | undefined;
    S3VersionId?: string | undefined;
    CodeSize?: number | undefined;
    UncompressedCodeSize?: number | undefined;
    CodeSigningProfileArn?: string | undefined;
    CodeSigningJobArn?: string | undefined;
    CodeSignatureExpirationTime?: number | undefined;
    CodeSignatureStatus?: CodeSignatureStatus | undefined;
    CodeSignatureRevocationData?: Uint8Array | undefined;
}
/**
 * @public
 * @enum
 */
export declare const Mode: {
    readonly event: "event";
    readonly http: "http";
};
/**
 * @public
 */
export type Mode = typeof Mode[keyof typeof Mode];
/**
 * @public
 * @enum
 */
export declare const ProvisionedConcurrencyState: {
    readonly Active: "Active";
    readonly Inactive: "Inactive";
};
/**
 * @public
 */
export type ProvisionedConcurrencyState = typeof ProvisionedConcurrencyState[keyof typeof ProvisionedConcurrencyState];
/**
 * @public
 */
export interface PublicAccessBlockConfig {
    BlockPublicPolicy?: boolean | undefined;
    RestrictPublicResource?: boolean | undefined;
}
/**
 * @public
 * @enum
 */
export declare const RuntimeUpdateReason: {
    readonly PINNED: "PINNED";
    readonly PRERELEASE: "PRERELEASE";
    readonly RELEASE: "RELEASE";
    readonly ROLLOUT: "ROLLOUT";
};
/**
 * @public
 */
export type RuntimeUpdateReason = typeof RuntimeUpdateReason[keyof typeof RuntimeUpdateReason];
/**
 * @public
 */
export interface TagsInfo {
    OwnershipStatus: string | undefined;
    ValidationToken?: string | undefined;
    Tags?: Record<string, string> | undefined;
}
/**
 * @public
 * @enum
 */
export declare const VmSelectorPreference: {
    readonly k5brave: "k5brave";
    readonly k5preview: "k5preview";
    readonly sbxv2brave: "sbxv2brave";
    readonly sbxv2preview: "sbxv2preview";
};
/**
 * @public
 */
export type VmSelectorPreference = typeof VmSelectorPreference[keyof typeof VmSelectorPreference];
/**
 * @public
 */
export interface MigrationFunctionVersion {
    Name?: string | undefined;
    FunctionArn?: string | undefined;
    Runtime?: string | undefined;
    Role?: string | undefined;
    Handler?: string | undefined;
    CodeSize?: number | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemoryLimitMb?: number | undefined;
    ModifiedDateAsEpochMilli?: number | undefined;
    CodeSha256?: string | undefined;
    FunctionVersion?: string | undefined;
    KmsKeyArn?: string | undefined;
    AccountId?: string | undefined;
    State?: State | undefined;
    StateReasonCode?: StateReasonCode | undefined;
    PendingTaskConfig?: string | undefined;
    EncryptedEnvironmentVars?: string | undefined;
    IsLarge?: number | undefined;
    Policy?: string | undefined;
    PublishedVersion?: number | undefined;
    ReservedConcurrentExecutions?: number | undefined;
    SquashfsRollbackVersionId?: string | undefined;
    Tagged?: boolean | undefined;
    TracingMode?: TracingMode | undefined;
    VersionId?: string | undefined;
    KmsGrantId?: string | undefined;
    KmsGrantToken?: string | undefined;
    RuntimeVariant?: string | undefined;
    TransactionId?: string | undefined;
    FunctionId?: string | undefined;
    Mode?: Mode | undefined;
    EnableTracer?: boolean | undefined;
    Code?: string | undefined;
    UncompresedCodeSize?: number | undefined;
    SandboxGeneration?: number | undefined;
    CodeSigningProfileArn?: string | undefined;
    CodeSigningJobArn?: string | undefined;
    CodeSigningConfigArn?: string | undefined;
    CodeSignatureExpirationTime?: number | undefined;
    DeadLetterArn?: string | undefined;
    SqsQueueName?: string | undefined;
    ConcurrencySequenceNumber?: number | undefined;
    FunctionSequenceNumber?: number | undefined;
    HashOfConsistentFields?: string | undefined;
    ProvisionedConcurrencyState?: ProvisionedConcurrencyState | undefined;
    RuntimeVersion?: string | undefined;
    PreviousRuntimeVersion?: string | undefined;
    RuntimeArtifactArn?: string | undefined;
    PreviousRuntimeArtifactArn?: string | undefined;
    RuntimeUpdateReason?: RuntimeUpdateReason | undefined;
    Architectures?: (Architecture)[] | undefined;
    EphemeralStorage?: EphemeralStorage | undefined;
    TagsInfo?: TagsInfo | undefined;
    SnapStart?: SnapStart | undefined;
    LoggingConfig?: LoggingConfig | undefined;
    GenerateDataKeyKmsGrantId?: string | undefined;
    GenerateDataKeyKmsGrantToken?: string | undefined;
    CustomerSubnetsByLambdaAz?: Record<string, (string)[]> | undefined;
    SecurityGroupIds?: (string)[] | undefined;
    VpcId?: string | undefined;
    PollerCustomerVpcRole?: string | undefined;
    VpcDelegationRole?: string | undefined;
    VpcOwnerRole?: string | undefined;
    TargetSourceArn?: string | undefined;
    Ipv6AllowedForDualStack?: boolean | undefined;
    VmSelectorPreference?: VmSelectorPreference | undefined;
    ProgrammingModel?: ProgrammingModel | undefined;
    WebProgrammingModelConfig?: WebProgrammingModelConfig | undefined;
    ExecutionEnvironmentConcurrencyConfig?: ExecutionEnvironmentConcurrencyConfig | undefined;
    LayerConfigs?: (LayerConfig)[] | undefined;
    AllLayerConfigs?: (LayerConfig)[] | undefined;
    MergedLayersUri?: string | undefined;
    CodeMergedWithLayersUri?: string | undefined;
    TotalProvisionedConcurrentExecutions?: number | undefined;
    PackageType?: string | undefined;
    UnderlyingPackageType?: string | undefined;
    PublicAccessBlockConfig?: PublicAccessBlockConfig | undefined;
    PublicPolicyAttached?: boolean | undefined;
    TenancyConfig?: TenancyConfig | undefined;
    ConfigSha256?: string | undefined;
    DurableConfig?: DurableConfig | undefined;
}
/**
 * @internal
 */
export declare const MigrationFunctionVersionFilterSensitiveLog: (obj: MigrationFunctionVersion) => any;
/**
 * @public
 */
export interface ExportFunctionVersionResponse {
    MigrationFunctionVersion?: MigrationFunctionVersion | undefined;
}
/**
 * @internal
 */
export declare const ExportFunctionVersionResponseFilterSensitiveLog: (obj: ExportFunctionVersionResponse) => any;
/**
 * @public
 */
export declare class ResourceNotReadyException extends __BaseException {
    readonly name: "ResourceNotReadyException";
    readonly $fault: "server";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ResourceNotReadyException, __BaseException>);
}
/**
 * @public
 */
export interface ExportLayerVersionRequest {
    LayerVersionArn: string | undefined;
}
/**
 * @public
 */
export interface MigrationLayerVersion {
    AccountId?: string | undefined;
    LayerId?: string | undefined;
    LayerArn?: string | undefined;
    LayerVersionArn?: string | undefined;
    CodeSize?: number | undefined;
    CodeSha256?: string | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
    CodeSigningProfileArn?: string | undefined;
    CodeSigningJobArn?: string | undefined;
    CodeSignatureExpirationTime?: number | undefined;
    CodeSignatureRevocationData?: Uint8Array | undefined;
    CreatedDate?: string | undefined;
    Description?: string | undefined;
    LicenseInfo?: string | undefined;
    UncompressedCodeSize?: number | undefined;
    CodeSignatureStatus?: CodeSignatureStatus | undefined;
    RevisionId?: string | undefined;
    Policy?: string | undefined;
    CurrentVersionNumber?: number | undefined;
    LatestUsableVersionNumber?: number | undefined;
    LatestUsableCompatibleArchitectures?: (Architecture)[] | undefined;
    LatestUsableCompatibleRuntimes?: (Runtime)[] | undefined;
    ZipFileSignedUrl?: string | undefined;
    SquashFSSignedUrl?: string | undefined;
    HashOfConsistentFields?: string | undefined;
}
/**
 * @public
 */
export interface ExportLayerVersionResponse {
    LayerVersion?: MigrationLayerVersion | undefined;
}
/**
 * @public
 */
export interface ExportProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ProvisionedConcurrencyStatusEnum: {
    readonly FAILED: "FAILED";
    readonly IN_PROGRESS: "IN_PROGRESS";
    readonly READY: "READY";
};
/**
 * @public
 */
export type ProvisionedConcurrencyStatusEnum = typeof ProvisionedConcurrencyStatusEnum[keyof typeof ProvisionedConcurrencyStatusEnum];
/**
 * @public
 */
export interface MigrationProvisionedConcurrencyConfig {
    FunctionArn?: string | undefined;
    RequestedProvisionedConcurrentExecutions?: number | undefined;
    AvailableProvisionedConcurrentExecutions?: number | undefined;
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
    HashOfConsistentFields?: string | undefined;
}
/**
 * @public
 */
export interface ExportProvisionedConcurrencyConfigResponse {
    MigrationProvisionedConcurrencyConfig?: MigrationProvisionedConcurrencyConfig | undefined;
}
/**
 * @public
 */
export interface GetAccountRiskSettingsRequest {
    AccountId: string | undefined;
}
/**
 * @public
 */
export interface GetAccountRiskSettingsResponse {
    RiskSettings: AccountRiskSettings | undefined;
    AccountBlacklistedForAccountRiskMitigation: boolean | undefined;
}
/**
 * @public
 */
export interface GetAccountSettingsRequest20150331 {
}
/**
 * @public
 */
export interface GetAccountSettingsResponse20150331 {
    SupportedFeatures?: (string)[] | undefined;
    FunctionCount?: number | undefined;
    CodeStorage?: number | undefined;
    CodeStorageLimit?: number | undefined;
    AliasCount?: number | undefined;
    AliasCountLimit?: number | undefined;
}
/**
 * @public
 */
export interface GetAccountSettingsRequest20160819 {
    IncludePreviewFeatures?: boolean | undefined;
    IncludeDeprecatedFeaturesAccess?: boolean | undefined;
    IncludeDeprecatedRuntimeDetails?: boolean | undefined;
    IncludeUnreservedConcurrentExecutionsMinimum?: boolean | undefined;
    IncludeBlacklistedFeatures?: boolean | undefined;
}
/**
 * @public
 */
export interface GetAccountSettingsResponse20160819 {
    AccountLimit?: AccountLimit | undefined;
    AccountUsage?: AccountUsage | undefined;
    PreviewFeatures?: (string)[] | undefined;
    DeprecatedFeaturesAccess?: (string)[] | undefined;
    HasFunctionWithDeprecatedRuntime?: boolean | undefined;
    BlacklistedFeatures?: (string)[] | undefined;
}
/**
 * @public
 */
export interface GetAccountSettingsInternalRequest {
    AccountId: string | undefined;
    FieldsToIncludeInResponse?: (string)[] | undefined;
    FeaturesToQueryForStatus?: (string)[] | undefined;
}
/**
 * @public
 */
export interface GetAccountSettingsInternalResponse {
    CustomerConfig?: CustomerConfigInternal | undefined;
}
/**
 * @public
 */
export interface GetAliasRequest20150331 {
    FunctionName: string | undefined;
    Name: string | undefined;
}
/**
 * @public
 */
export interface GetCodeSigningConfigRequest {
    CodeSigningConfigArn: string | undefined;
}
/**
 * @public
 */
export interface GetCodeSigningConfigResponse {
    CodeSigningConfig: CodeSigningConfig | undefined;
}
/**
 * @public
 */
export interface GetDurableExecutionRequest {
    DurableExecutionArn: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ExecutionStatus: {
    readonly FAILED: "FAILED";
    readonly RUNNING: "RUNNING";
    readonly STOPPED: "STOPPED";
    readonly SUCCEEDED: "SUCCEEDED";
    readonly TIMED_OUT: "TIMED_OUT";
};
/**
 * @public
 */
export type ExecutionStatus = typeof ExecutionStatus[keyof typeof ExecutionStatus];
/**
 * @public
 */
export interface GetDurableExecutionResponse {
    DurableExecutionArn?: string | undefined;
    DurableExecutionName?: string | undefined;
    FunctionArn?: string | undefined;
    InputPayload?: string | undefined;
    Result?: string | undefined;
    Error?: ErrorObject | undefined;
    StartDate?: Date | undefined;
    Status?: ExecutionStatus | undefined;
    StopDate?: Date | undefined;
    Version?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionResponseFilterSensitiveLog: (obj: GetDurableExecutionResponse) => any;
/**
 * @public
 */
export interface GetDurableExecutionHistoryRequest {
    DurableExecutionArn: string | undefined;
    IncludeExecutionData?: boolean | undefined;
    MaxItems?: number | undefined;
    Marker?: string | undefined;
    ReverseOrder?: boolean | undefined;
}
/**
 * @public
 */
export interface EventError {
    Payload?: ErrorObject | undefined;
    Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventErrorFilterSensitiveLog: (obj: EventError) => any;
/**
 * @public
 */
export interface RetryDetails {
    CurrentAttempt?: number | undefined;
    NextAttemptDelaySeconds?: number | undefined;
}
/**
 * @public
 */
export interface CallbackFailedDetails {
    Error?: EventError | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackFailedDetailsFilterSensitiveLog: (obj: CallbackFailedDetails) => any;
/**
 * @public
 */
export interface EventInput {
    Payload?: string | undefined;
    Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventInputFilterSensitiveLog: (obj: EventInput) => any;
/**
 * @public
 */
export interface CallbackStartedDetails {
    CallbackId?: string | undefined;
    Input?: EventInput | undefined;
    HeartbeatTimeout?: number | undefined;
    Timeout?: number | undefined;
}
/**
 * @internal
 */
export declare const CallbackStartedDetailsFilterSensitiveLog: (obj: CallbackStartedDetails) => any;
/**
 * @public
 */
export interface EventResult {
    Payload?: string | undefined;
    Truncated?: boolean | undefined;
}
/**
 * @internal
 */
export declare const EventResultFilterSensitiveLog: (obj: EventResult) => any;
/**
 * @public
 */
export interface CallbackSucceededDetails {
    Result?: EventResult | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackSucceededDetailsFilterSensitiveLog: (obj: CallbackSucceededDetails) => any;
/**
 * @public
 */
export interface CallbackTimedOutDetails {
    Error?: EventError | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const CallbackTimedOutDetailsFilterSensitiveLog: (obj: CallbackTimedOutDetails) => any;
/**
 * @public
 */
export interface ContextFailedDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ContextFailedDetailsFilterSensitiveLog: (obj: ContextFailedDetails) => any;
/**
 * @public
 */
export interface ContextStartedDetails {
}
/**
 * @public
 */
export interface ContextSucceededDetails {
    Result?: EventResult | undefined;
}
/**
 * @internal
 */
export declare const ContextSucceededDetailsFilterSensitiveLog: (obj: ContextSucceededDetails) => any;
/**
 * @public
 * @enum
 */
export declare const EventType: {
    readonly CallbackFailed: "CallbackFailed";
    readonly CallbackStarted: "CallbackStarted";
    readonly CallbackSucceeded: "CallbackSucceeded";
    readonly CallbackTimedOut: "CallbackTimedOut";
    readonly ContextFailed: "ContextFailed";
    readonly ContextStarted: "ContextStarted";
    readonly ContextSucceeded: "ContextSucceeded";
    readonly ExecutionFailed: "ExecutionFailed";
    readonly ExecutionStarted: "ExecutionStarted";
    readonly ExecutionStopped: "ExecutionStopped";
    readonly ExecutionSucceeded: "ExecutionSucceeded";
    readonly ExecutionTimedOut: "ExecutionTimedOut";
    readonly InvokeCancelled: "InvokeCancelled";
    readonly InvokeFailed: "InvokeFailed";
    readonly InvokeStarted: "InvokeStarted";
    readonly InvokeSucceeded: "InvokeSucceeded";
    readonly InvokeTimedOut: "InvokeTimedOut";
    readonly StepFailed: "StepFailed";
    readonly StepStarted: "StepStarted";
    readonly StepSucceeded: "StepSucceeded";
    readonly WaitCancelled: "WaitCancelled";
    readonly WaitStarted: "WaitStarted";
    readonly WaitSucceeded: "WaitSucceeded";
};
/**
 * @public
 */
export type EventType = typeof EventType[keyof typeof EventType];
/**
 * @public
 */
export interface ExecutionFailedDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionFailedDetailsFilterSensitiveLog: (obj: ExecutionFailedDetails) => any;
/**
 * @public
 */
export interface ExecutionStartedDetails {
    Input?: EventInput | undefined;
    ExecutionTimeout?: number | undefined;
}
/**
 * @internal
 */
export declare const ExecutionStartedDetailsFilterSensitiveLog: (obj: ExecutionStartedDetails) => any;
/**
 * @public
 */
export interface ExecutionStoppedDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionStoppedDetailsFilterSensitiveLog: (obj: ExecutionStoppedDetails) => any;
/**
 * @public
 */
export interface ExecutionSucceededDetails {
    Result?: EventResult | undefined;
}
/**
 * @internal
 */
export declare const ExecutionSucceededDetailsFilterSensitiveLog: (obj: ExecutionSucceededDetails) => any;
/**
 * @public
 */
export interface ExecutionTimedOutDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const ExecutionTimedOutDetailsFilterSensitiveLog: (obj: ExecutionTimedOutDetails) => any;
/**
 * @public
 */
export interface InvokeCancelledDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const InvokeCancelledDetailsFilterSensitiveLog: (obj: InvokeCancelledDetails) => any;
/**
 * @public
 */
export interface InvokeFailedDetails {
    Error?: EventError | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeFailedDetailsFilterSensitiveLog: (obj: InvokeFailedDetails) => any;
/**
 * @public
 */
export interface InvokeStartedDetails {
    Input?: EventInput | undefined;
    FunctionArn?: string | undefined;
    DurableExecutionArn?: string | undefined;
}
/**
 * @internal
 */
export declare const InvokeStartedDetailsFilterSensitiveLog: (obj: InvokeStartedDetails) => any;
/**
 * @public
 */
export interface InvokeSucceededDetails {
    Result?: EventResult | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeSucceededDetailsFilterSensitiveLog: (obj: InvokeSucceededDetails) => any;
/**
 * @public
 */
export interface InvokeTimedOutDetails {
    Error?: EventError | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const InvokeTimedOutDetailsFilterSensitiveLog: (obj: InvokeTimedOutDetails) => any;
/**
 * @public
 */
export interface StepFailedDetails {
    Error?: EventError | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const StepFailedDetailsFilterSensitiveLog: (obj: StepFailedDetails) => any;
/**
 * @public
 */
export interface StepStartedDetails {
}
/**
 * @public
 */
export interface StepSucceededDetails {
    Result?: EventResult | undefined;
    RetryDetails?: RetryDetails | undefined;
}
/**
 * @internal
 */
export declare const StepSucceededDetailsFilterSensitiveLog: (obj: StepSucceededDetails) => any;
/**
 * @public
 */
export interface WaitCancelledDetails {
    Error?: EventError | undefined;
}
/**
 * @internal
 */
export declare const WaitCancelledDetailsFilterSensitiveLog: (obj: WaitCancelledDetails) => any;
/**
 * @public
 */
export interface WaitStartedDetails {
    Duration?: number | undefined;
    ScheduledEndTimestamp?: Date | undefined;
}
/**
 * @public
 */
export interface WaitSucceededDetails {
    Duration?: number | undefined;
}
/**
 * @public
 */
export interface Event {
    EventType?: EventType | undefined;
    SubType?: string | undefined;
    EventId?: number | undefined;
    Id?: string | undefined;
    Name?: string | undefined;
    EventTimestamp?: Date | undefined;
    ParentId?: string | undefined;
    ExecutionStartedDetails?: ExecutionStartedDetails | undefined;
    ExecutionSucceededDetails?: ExecutionSucceededDetails | undefined;
    ExecutionFailedDetails?: ExecutionFailedDetails | undefined;
    ExecutionTimedOutDetails?: ExecutionTimedOutDetails | undefined;
    ExecutionStoppedDetails?: ExecutionStoppedDetails | undefined;
    ContextStartedDetails?: ContextStartedDetails | undefined;
    ContextSucceededDetails?: ContextSucceededDetails | undefined;
    ContextFailedDetails?: ContextFailedDetails | undefined;
    WaitStartedDetails?: WaitStartedDetails | undefined;
    WaitSucceededDetails?: WaitSucceededDetails | undefined;
    WaitCancelledDetails?: WaitCancelledDetails | undefined;
    StepStartedDetails?: StepStartedDetails | undefined;
    StepSucceededDetails?: StepSucceededDetails | undefined;
    StepFailedDetails?: StepFailedDetails | undefined;
    InvokeStartedDetails?: InvokeStartedDetails | undefined;
    InvokeSucceededDetails?: InvokeSucceededDetails | undefined;
    InvokeFailedDetails?: InvokeFailedDetails | undefined;
    InvokeTimedOutDetails?: InvokeTimedOutDetails | undefined;
    InvokeCancelledDetails?: InvokeCancelledDetails | undefined;
    CallbackStartedDetails?: CallbackStartedDetails | undefined;
    CallbackSucceededDetails?: CallbackSucceededDetails | undefined;
    CallbackFailedDetails?: CallbackFailedDetails | undefined;
    CallbackTimedOutDetails?: CallbackTimedOutDetails | undefined;
}
/**
 * @internal
 */
export declare const EventFilterSensitiveLog: (obj: Event) => any;
/**
 * @public
 */
export interface GetDurableExecutionHistoryResponse {
    Events?: (Event)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionHistoryResponseFilterSensitiveLog: (obj: GetDurableExecutionHistoryResponse) => any;
/**
 * @public
 */
export interface GetDurableExecutionStateRequest {
    CheckpointToken: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface GetDurableExecutionStateResponse {
    Operations?: (Operation)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @internal
 */
export declare const GetDurableExecutionStateResponseFilterSensitiveLog: (obj: GetDurableExecutionStateResponse) => any;
/**
 * @public
 */
export interface OldGetEventSourceRequest {
    UUID: string | undefined;
}
/**
 * @public
 */
export interface GetEventSourceMappingRequest {
    UUID: string | undefined;
}
/**
 * @public
 */
export interface GetEventSourceMappingInternalRequest {
    UUID: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export interface FunctionCodeLocation {
    RepositoryType?: string | undefined;
    Location?: string | undefined;
    ImageUri?: string | undefined;
    ResolvedImageUri?: string | undefined;
    ResolvedS3Uri?: string | undefined;
    SourceKMSKeyArn?: string | undefined;
    Error?: string | undefined;
}
/**
 * @public
 */
export interface FunctionConfiguration {
    FunctionName?: string | undefined;
    FunctionARN?: string | undefined;
    ConfigurationId?: string | undefined;
    Runtime?: Runtime | undefined;
    Role?: string | undefined;
    Handler?: string | undefined;
    Mode?: Mode | undefined;
    CodeSize?: number | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
    LastModified?: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionResponse {
    Configuration?: FunctionConfiguration | undefined;
    Code?: FunctionCodeLocation | undefined;
}
/**
 * @public
 */
export interface Concurrency {
    ReservedConcurrentExecutions?: number | undefined;
}
/**
 * @public
 */
export interface GetFunctionResponse20150331 {
    Configuration?: FunctionConfiguration20150331 | undefined;
    Code?: FunctionCodeLocation | undefined;
    Tags?: Record<string, string> | undefined;
    Concurrency?: Concurrency | undefined;
}
/**
 * @internal
 */
export declare const GetFunctionResponse20150331FilterSensitiveLog: (obj: GetFunctionResponse20150331) => any;
/**
 * @public
 */
export interface GetFunctionCodeSigningConfigRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionCodeSigningConfigResponse {
    CodeSigningConfigArn: string | undefined;
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionConcurrencyRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionConcurrencyResponse {
    ReservedConcurrentExecutions?: number | undefined;
}
/**
 * @public
 */
export interface GetFunctionConfigurationRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export declare class InternalLambdaAccountDisabledException extends __BaseException {
    readonly name: "InternalLambdaAccountDisabledException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InternalLambdaAccountDisabledException, __BaseException>);
}
/**
 * @public
 */
export interface FunctionEventInvokeConfig {
    LastModified?: Date | undefined;
    FunctionArn?: string | undefined;
    MaximumRetryAttempts?: number | undefined;
    MaximumEventAgeInSeconds?: number | undefined;
    DestinationConfig?: DestinationConfig | undefined;
}
/**
 * @public
 */
export interface GetFunctionEventInvokeConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export interface FunctionScalingConfig {
    MinExecutionEnvironments?: number | undefined;
    MaxExecutionEnvironments?: number | undefined;
}
/**
 * @public
 */
export interface GetFunctionInternalResponse {
    Configuration?: FunctionConfiguration20150331 | undefined;
    Concurrency?: Concurrency | undefined;
    CodeSigningConfigArn?: string | undefined;
    AppliedFunctionScalingConfig?: FunctionScalingConfig | undefined;
    RequestedFunctionScalingConfig?: FunctionScalingConfig | undefined;
}
/**
 * @internal
 */
export declare const GetFunctionInternalResponseFilterSensitiveLog: (obj: GetFunctionInternalResponse) => any;
/**
 * @public
 */
export interface GetFunctionRecursionConfigRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const RecursiveLoop: {
    readonly Allow: "Allow";
    readonly Terminate: "Terminate";
};
/**
 * @public
 */
export type RecursiveLoop = typeof RecursiveLoop[keyof typeof RecursiveLoop];
/**
 * @public
 */
export interface GetFunctionRecursionConfigResponse {
    RecursiveLoop?: RecursiveLoop | undefined;
}
/**
 * @public
 */
export interface GetFunctionScalingConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionScalingConfigResponse {
    FunctionArn?: string | undefined;
    AppliedFunctionScalingConfig?: FunctionScalingConfig | undefined;
    RequestedFunctionScalingConfig?: FunctionScalingConfig | undefined;
}
/**
 * @public
 */
export interface GetFunctionUrlConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export interface GetFunctionUrlConfigResponse {
    FunctionUrl: string | undefined;
    FunctionArn: string | undefined;
    AuthType: FunctionUrlAuthType | undefined;
    Cors?: Cors | undefined;
    CreationTime: string | undefined;
    LastModifiedTime: string | undefined;
    InvokeMode?: InvokeMode | undefined;
}
/**
 * @public
 */
export interface GetLatestLayerVersionInfoInternalRequest {
    LayerArn: string | undefined;
}
/**
 * @public
 */
export interface GetLatestLayerVersionInfoInternalResponse {
    AccountId?: string | undefined;
    LayerArn?: string | undefined;
    Version?: number | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionRequest20181031 {
    LayerName: string | undefined;
    VersionNumber: number | undefined;
}
/**
 * @public
 */
export interface LayerVersionContentOutput20181031 {
    Location?: string | undefined;
    CodeSha256?: string | undefined;
    CodeSize?: number | undefined;
    UncompressedCodeSize?: number | undefined;
    SigningProfileVersionArn?: string | undefined;
    SigningJobArn?: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionResponse20181031 {
    Content?: LayerVersionContentOutput20181031 | undefined;
    LayerArn?: string | undefined;
    LayerVersionArn?: string | undefined;
    Description?: string | undefined;
    CreatedDate?: string | undefined;
    Version?: number | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
    LicenseInfo?: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionByArnRequest20181031 {
    Arn: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionInternalRequest {
    LayerVersionArn: string | undefined;
    AllowOnlyPresignedUrl?: boolean | undefined;
    FallbackLayerUriToSign?: string | undefined;
}
/**
 * @public
 */
export interface LayerVersionInternalContentOutput {
    CodeSigningProfileVersionArn?: string | undefined;
    CodeSigningJobArn?: string | undefined;
    InternalFormatLocation?: string | undefined;
    UncompressedCodeSize?: number | undefined;
    CodeSize?: number | undefined;
    CodeUri?: string | undefined;
    S3CodeVersionId?: string | undefined;
    CodeSignatureExpirationTime?: number | undefined;
    CodeSignatureStatus?: string | undefined;
    CodeSignatureRevocationData?: Uint8Array | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionInternalResponse {
    Content?: LayerVersionInternalContentOutput | undefined;
    LayerVersionArn?: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionPolicyRequest20181031 {
    LayerName: string | undefined;
    VersionNumber: number | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionPolicyResponse20181031 {
    Policy?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionPolicyInternalRequest {
    LayerVersionArn: string | undefined;
}
/**
 * @public
 */
export interface GetLayerVersionPolicyInternalResponse {
    Policy?: string | undefined;
}
/**
 * @public
 */
export interface GetPolicyRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 */
export interface GetPolicyResponse {
    Policy?: string | undefined;
    RevisionId?: string | undefined;
    PublicAccessAllowed?: boolean | undefined;
}
/**
 * @public
 */
export interface GetProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
}
/**
 * @public
 */
export interface GetProvisionedConcurrencyConfigResponse {
    RequestedProvisionedConcurrentExecutions?: number | undefined;
    AvailableProvisionedConcurrentExecutions?: number | undefined;
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
}
/**
 * @public
 */
export declare class ProvisionedConcurrencyConfigNotFoundException extends __BaseException {
    readonly name: "ProvisionedConcurrencyConfigNotFoundException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ProvisionedConcurrencyConfigNotFoundException, __BaseException>);
}
/**
 * @public
 */
export interface GetPublicAccessBlockConfigRequest {
    ResourceArn: string | undefined;
}
/**
 * @public
 */
export interface GetPublicAccessBlockConfigResponse {
    PublicAccessBlockConfig?: PublicAccessBlockConfig | undefined;
}
/**
 * @public
 */
export interface GetResourcePolicyRequest {
    ResourceArn: string | undefined;
}
/**
 * @public
 */
export interface GetResourcePolicyResponse {
    Policy?: string | undefined;
    RevisionId?: string | undefined;
    PublicAccessAllowed?: boolean | undefined;
}
/**
 * @public
 */
export interface GetRuntimeManagementConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const UpdateRuntimeOn: {
    readonly Auto: "Auto";
    readonly FunctionUpdate: "FunctionUpdate";
    readonly Manual: "Manual";
};
/**
 * @public
 */
export type UpdateRuntimeOn = typeof UpdateRuntimeOn[keyof typeof UpdateRuntimeOn];
/**
 * @public
 */
export interface GetRuntimeManagementConfigResponse {
    UpdateRuntimeOn?: UpdateRuntimeOn | undefined;
    FunctionArn?: string | undefined;
    RuntimeVersionArn?: string | undefined;
}
/**
 * @public
 */
export interface GetVersionProvisionedConcurrencyStatusRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface GetVersionProvisionedConcurrencyStatusResponse {
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    PreWarmingStatus?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface GetVersionSandboxSpecRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface GetVersionSandboxSpecResponse {
    SandboxSpec?: Uint8Array | undefined;
    PendingConfigSandboxSpec?: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const GetVersionSandboxSpecResponseFilterSensitiveLog: (obj: GetVersionSandboxSpecResponse) => any;
/**
 * @public
 */
export interface ImportAccountSettingsRequest {
    AccountId: string | undefined;
    CodeStorageTableEntry?: CodeStorageTableEntry | undefined;
    CustomerConfig: CustomerConfigInternal | undefined;
    RiskSettings?: MigrationAccountRiskSettings | undefined;
}
/**
 * @public
 */
export interface ImportAccountSettingsResponse {
    CodeStorageTableEntry?: CodeStorageTableEntry | undefined;
    CustomerConfig?: CustomerConfigInternal | undefined;
    RiskSettings?: MigrationAccountRiskSettings | undefined;
}
