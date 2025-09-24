import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { AccountLimit, AccountRiskSettings, AccountUsage, AliasConfiguration20150331, AliasRoutingConfiguration, AllowedPublishers, AmazonManagedKafkaEventSourceConfig, Architecture, CodeSigningConfig, CodeSigningPolicies, Cors, CustomerConfigInternal, DeadLetterConfig, DestinationConfig, DocumentDBEventSourceConfig, DurableConfig, Environment, EphemeralStorage, ErrorObject, EventSourceMappingConfiguration, EventSourceMappingMetricsConfig, ExecutionEnvironmentConcurrencyConfig, ExecutionStatus, FileSystemConfig, FilterCriteria, FunctionConfiguration, FunctionConfiguration20150331, FunctionEventInvokeConfig, FunctionResourceType, FunctionResponseType, FunctionScalingConfig, FunctionUrlAuthType, FunctionVersionLatestPublished, ImageConfig, InvokeMode, LayerVersionContentOutput20181031, LoggingConfig, MigrationAlias, MigrationFunctionUrlConfig, MigrationFunctionVersion, MigrationLayerVersion, MigrationProvisionedConcurrencyConfig, Mode, OldEventSourceConfiguration, PackageType, ProgrammingModel, ProvisionedConcurrencyStatusEnum, ProvisionedPollerConfig, PublicAccessBlockConfig, RecursiveLoop, ResourceType, Runtime, S3ObjectStorageMode, ScalingConfig, SelfManagedKafkaEventSourceConfig, SnapStart, SourceAccessConfiguration, State, TracingConfig, UpdateRuntimeOn, VpcConfig, WebProgrammingModelConfig } from "./models_0";
import { ExceptionOptionType as __ExceptionOptionType } from "@smithy/smithy-client";
import { StreamingBlobTypes } from "@smithy/types";
/**
 * @public
 */
export interface ImportAliasResponse {
    MigrationAlias?: MigrationAlias | undefined;
}
/**
 * @public
 */
export interface ImportFunctionCounterRequest {
    FunctionName: string | undefined;
    CurrentVersionNumber: number | undefined;
}
/**
 * @public
 */
export interface FunctionCounterInternal {
    FunctionArn?: string | undefined;
    CurrentVersionNumber?: number | undefined;
}
/**
 * @public
 */
export interface ImportFunctionCounterResponse {
    FunctionCounter?: FunctionCounterInternal | undefined;
}
/**
 * @public
 */
export interface ImportFunctionUrlConfigsRequest {
    MigrationFunctionUrlConfig: MigrationFunctionUrlConfig | undefined;
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface ImportFunctionUrlConfigsResponse {
    MigrationFunctionUrlConfig?: MigrationFunctionUrlConfig | undefined;
}
/**
 * @public
 */
export interface ImportFunctionVersionRequest {
    FunctionName: string | undefined;
    MigrationFunctionVersion: MigrationFunctionVersion | undefined;
}
/**
 * @internal
 */
export declare const ImportFunctionVersionRequestFilterSensitiveLog: (obj: ImportFunctionVersionRequest) => any;
/**
 * @public
 */
export interface ImportFunctionVersionResponse {
    MigrationFunctionVersion?: MigrationFunctionVersion | undefined;
}
/**
 * @internal
 */
export declare const ImportFunctionVersionResponseFilterSensitiveLog: (obj: ImportFunctionVersionResponse) => any;
/**
 * @public
 */
export interface ImportLayerVersionRequest {
    LayerVersionArn: string | undefined;
    LayerVersion?: MigrationLayerVersion | undefined;
}
/**
 * @public
 */
export interface ImportLayerVersionResponse {
    LayerVersion?: MigrationLayerVersion | undefined;
}
/**
 * @public
 */
export interface ImportProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    MigrationProvisionedConcurrencyConfig: MigrationProvisionedConcurrencyConfig | undefined;
}
/**
 * @public
 */
export interface ImportProvisionedConcurrencyConfigResponse {
    MigrationProvisionedConcurrencyConfig?: MigrationProvisionedConcurrencyConfig | undefined;
}
/**
 * @public
 */
export interface InformTagrisAfterResourceCreationRequest {
    Resource: string | undefined;
    TagrisExpectedVersion: number | undefined;
}
/**
 * @public
 */
export declare class DurableExecutionAlreadyStartedException extends __BaseException {
    readonly name: "DurableExecutionAlreadyStartedException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<DurableExecutionAlreadyStartedException, __BaseException>);
}
/**
 * @public
 */
export declare class EC2AccessDeniedException extends __BaseException {
    readonly name: "EC2AccessDeniedException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EC2AccessDeniedException, __BaseException>);
}
/**
 * @public
 */
export declare class EC2ThrottledException extends __BaseException {
    readonly name: "EC2ThrottledException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EC2ThrottledException, __BaseException>);
}
/**
 * @public
 */
export declare class EC2UnexpectedException extends __BaseException {
    readonly name: "EC2UnexpectedException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    EC2ErrorCode?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EC2UnexpectedException, __BaseException>);
}
/**
 * @public
 */
export declare class EFSIOException extends __BaseException {
    readonly name: "EFSIOException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EFSIOException, __BaseException>);
}
/**
 * @public
 */
export declare class EFSMountConnectivityException extends __BaseException {
    readonly name: "EFSMountConnectivityException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EFSMountConnectivityException, __BaseException>);
}
/**
 * @public
 */
export declare class EFSMountFailureException extends __BaseException {
    readonly name: "EFSMountFailureException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EFSMountFailureException, __BaseException>);
}
/**
 * @public
 */
export declare class EFSMountTimeoutException extends __BaseException {
    readonly name: "EFSMountTimeoutException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<EFSMountTimeoutException, __BaseException>);
}
/**
 * @public
 */
export declare class ENILimitReachedException extends __BaseException {
    readonly name: "ENILimitReachedException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ENILimitReachedException, __BaseException>);
}
/**
 * @public
 */
export declare class InvalidRequestContentException extends __BaseException {
    readonly name: "InvalidRequestContentException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidRequestContentException, __BaseException>);
}
/**
 * @public
 */
export declare class InvalidRuntimeException extends __BaseException {
    readonly name: "InvalidRuntimeException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidRuntimeException, __BaseException>);
}
/**
 * @public
 */
export declare class InvalidSecurityGroupIDException extends __BaseException {
    readonly name: "InvalidSecurityGroupIDException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidSecurityGroupIDException, __BaseException>);
}
/**
 * @public
 */
export declare class InvalidSubnetIDException extends __BaseException {
    readonly name: "InvalidSubnetIDException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidSubnetIDException, __BaseException>);
}
/**
 * @public
 */
export declare class InvalidZipFileException extends __BaseException {
    readonly name: "InvalidZipFileException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InvalidZipFileException, __BaseException>);
}
/**
 * @public
 * @enum
 */
export declare const InvocationType: {
    readonly DryRun: "DryRun";
    readonly Event: "Event";
    readonly RequestResponse: "RequestResponse";
};
/**
 * @public
 */
export type InvocationType = typeof InvocationType[keyof typeof InvocationType];
/**
 * @public
 * @enum
 */
export declare const LogType: {
    readonly None: "None";
    readonly Tail: "Tail";
};
/**
 * @public
 */
export type LogType = typeof LogType[keyof typeof LogType];
/**
 * @public
 */
export interface InvocationRequest {
    FunctionName: string | undefined;
    InvocationType?: InvocationType | undefined;
    SourceArn?: string | undefined;
    LogType?: LogType | undefined;
    ClientContext?: string | undefined;
    DurableExecutionName?: string | undefined;
    ContentType?: string | undefined;
    SourceAccount?: string | undefined;
    EventSourceToken?: string | undefined;
    Payload?: Uint8Array | undefined;
    Qualifier?: string | undefined;
    TraceFields?: string | undefined;
    InternalLambda?: string | undefined;
    OnSuccessDestinationArn?: string | undefined;
    OnFailureDestinationArn?: string | undefined;
    TenantId?: string | undefined;
    DurableFunctionInvokeExecution?: boolean | undefined;
}
/**
 * @internal
 */
export declare const InvocationRequestFilterSensitiveLog: (obj: InvocationRequest) => any;
/**
 * @public
 */
export interface InvocationResponse {
    StatusCode?: number | undefined;
    FunctionError?: string | undefined;
    LogResult?: string | undefined;
    ContentType?: string | undefined;
    FunctionResponseMode?: string | undefined;
    ContentLength?: number | undefined;
    TraceFields?: string | undefined;
    Payload?: Uint8Array | undefined;
    ExecutedVersion?: string | undefined;
    DurableExecutionArn?: string | undefined;
}
/**
 * @internal
 */
export declare const InvocationResponseFilterSensitiveLog: (obj: InvocationResponse) => any;
/**
 * @public
 */
export declare class KMSAccessDeniedException extends __BaseException {
    readonly name: "KMSAccessDeniedException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<KMSAccessDeniedException, __BaseException>);
}
/**
 * @public
 */
export declare class KMSDisabledException extends __BaseException {
    readonly name: "KMSDisabledException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<KMSDisabledException, __BaseException>);
}
/**
 * @public
 */
export declare class KMSInvalidStateException extends __BaseException {
    readonly name: "KMSInvalidStateException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<KMSInvalidStateException, __BaseException>);
}
/**
 * @public
 */
export declare class KMSNotFoundException extends __BaseException {
    readonly name: "KMSNotFoundException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<KMSNotFoundException, __BaseException>);
}
/**
 * @public
 */
export declare class ModeNotSupportedException extends __BaseException {
    readonly name: "ModeNotSupportedException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ModeNotSupportedException, __BaseException>);
}
/**
 * @public
 */
export declare class NoPublishedVersionException extends __BaseException {
    readonly name: "NoPublishedVersionException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<NoPublishedVersionException, __BaseException>);
}
/**
 * @public
 */
export declare class RecursiveInvocationException extends __BaseException {
    readonly name: "RecursiveInvocationException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<RecursiveInvocationException, __BaseException>);
}
/**
 * @public
 */
export declare class RequestTooLargeException extends __BaseException {
    readonly name: "RequestTooLargeException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<RequestTooLargeException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapRestoreException extends __BaseException {
    readonly name: "SnapRestoreException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapRestoreException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapRestoreTimeoutException extends __BaseException {
    readonly name: "SnapRestoreTimeoutException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapRestoreTimeoutException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapStartException extends __BaseException {
    readonly name: "SnapStartException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapStartException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapStartNotReadyException extends __BaseException {
    readonly name: "SnapStartNotReadyException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapStartNotReadyException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapStartRegenerationFailureException extends __BaseException {
    readonly name: "SnapStartRegenerationFailureException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapStartRegenerationFailureException, __BaseException>);
}
/**
 * @public
 */
export declare class SnapStartTimeoutException extends __BaseException {
    readonly name: "SnapStartTimeoutException";
    readonly $fault: "client";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SnapStartTimeoutException, __BaseException>);
}
/**
 * @public
 */
export declare class SubnetIPAddressLimitReachedException extends __BaseException {
    readonly name: "SubnetIPAddressLimitReachedException";
    readonly $fault: "server";
    Type?: string | undefined;
    Message?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<SubnetIPAddressLimitReachedException, __BaseException>);
}
/**
 * @public
 */
export declare class UnsupportedMediaTypeException extends __BaseException {
    readonly name: "UnsupportedMediaTypeException";
    readonly $fault: "client";
    Type?: string | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<UnsupportedMediaTypeException, __BaseException>);
}
/**
 * @public
 */
export interface InvokeAsyncRequest {
    FunctionName: string | undefined;
    InternalLambda?: string | undefined;
    DryRun?: boolean | undefined;
    InvokeArgs: Uint8Array | undefined;
    SourceArn?: string | undefined;
}
/**
 * @internal
 */
export declare const InvokeAsyncRequestFilterSensitiveLog: (obj: InvokeAsyncRequest) => any;
/**
 * @public
 */
export interface InvokeAsyncResponse {
    Status?: number | undefined;
    Body?: StreamingBlobTypes | undefined;
}
/**
 * @internal
 */
export declare const InvokeAsyncResponseFilterSensitiveLog: (obj: InvokeAsyncResponse) => any;
/**
 * @public
 */
export interface InvokeWithResponseStreamRequest {
    FunctionName: string | undefined;
    InvocationType?: InvocationType | undefined;
    LogType?: LogType | undefined;
    ClientContext?: string | undefined;
    ContentType?: string | undefined;
    SourceOwner?: string | undefined;
    SourceArn?: string | undefined;
    SourceAccount?: string | undefined;
    EventSourceToken?: string | undefined;
    Qualifier?: string | undefined;
    TraceFields?: string | undefined;
    InternalLambda?: string | undefined;
    Payload?: Uint8Array | undefined;
    TenantId?: string | undefined;
}
/**
 * @internal
 */
export declare const InvokeWithResponseStreamRequestFilterSensitiveLog: (obj: InvokeWithResponseStreamRequest) => any;
/**
 * @public
 */
export interface InvokeWithResponseStreamCompleteEvent {
    ErrorCode?: string | undefined;
    ErrorDetails?: string | undefined;
    LogResult?: string | undefined;
}
/**
 * @public
 */
export interface InvokeResponseStreamUpdate {
    Payload?: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const InvokeResponseStreamUpdateFilterSensitiveLog: (obj: InvokeResponseStreamUpdate) => any;
/**
 * @public
 */
export type InvokeWithResponseStreamResponseEvent = InvokeWithResponseStreamResponseEvent.InvokeCompleteMember | InvokeWithResponseStreamResponseEvent.PayloadChunkMember | InvokeWithResponseStreamResponseEvent.$UnknownMember;
/**
 * @public
 */
export declare namespace InvokeWithResponseStreamResponseEvent {
    interface PayloadChunkMember {
        PayloadChunk: InvokeResponseStreamUpdate;
        InvokeComplete?: never;
        $unknown?: never;
    }
    interface InvokeCompleteMember {
        PayloadChunk?: never;
        InvokeComplete: InvokeWithResponseStreamCompleteEvent;
        $unknown?: never;
    }
    /**
     * @public
     */
    interface $UnknownMember {
        PayloadChunk?: never;
        InvokeComplete?: never;
        $unknown: [string, any];
    }
    interface Visitor<T> {
        PayloadChunk: (value: InvokeResponseStreamUpdate) => T;
        InvokeComplete: (value: InvokeWithResponseStreamCompleteEvent) => T;
        _: (name: string, value: any) => T;
    }
    const visit: <T>(value: InvokeWithResponseStreamResponseEvent, visitor: Visitor<T>) => T;
}
/**
 * @internal
 */
export declare const InvokeWithResponseStreamResponseEventFilterSensitiveLog: (obj: InvokeWithResponseStreamResponseEvent) => any;
/**
 * @public
 */
export interface InvokeWithResponseStreamResponse {
    StatusCode?: number | undefined;
    ExecutedVersion?: string | undefined;
    TraceFields?: string | undefined;
    ContentType?: string | undefined;
    EventStream?: AsyncIterable<InvokeWithResponseStreamResponseEvent> | undefined;
}
/**
 * @internal
 */
export declare const InvokeWithResponseStreamResponseFilterSensitiveLog: (obj: InvokeWithResponseStreamResponse) => any;
/**
 * @public
 */
export interface ListAliasesRequest20150331 {
    FunctionName: string | undefined;
    FunctionVersion?: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListAliasesResponse20150331 {
    NextMarker?: string | undefined;
    Aliases?: (AliasConfiguration20150331)[] | undefined;
}
/**
 * @public
 */
export interface ListAliasesInternalRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
}
/**
 * @public
 */
export interface ListAliasesInternalResponse {
    NextMarker?: string | undefined;
    Aliases?: (string)[] | undefined;
}
/**
 * @public
 */
export interface ListCodeSigningConfigsRequest {
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListCodeSigningConfigsResponse {
    NextMarker?: string | undefined;
    CodeSigningConfigs?: (CodeSigningConfig)[] | undefined;
}
/**
 * @public
 */
export interface ListDurableExecutionsRequest {
    FunctionName?: string | undefined;
    FunctionVersion?: string | undefined;
    DurableExecutionName?: string | undefined;
    StatusFilter?: (ExecutionStatus)[] | undefined;
    TimeAfter?: Date | undefined;
    TimeBefore?: Date | undefined;
    ReverseOrder?: boolean | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface Execution {
    DurableExecutionArn?: string | undefined;
    DurableExecutionName?: string | undefined;
    FunctionArn?: string | undefined;
    Status?: ExecutionStatus | undefined;
    StartDate?: Date | undefined;
    StopDate?: Date | undefined;
}
/**
 * @public
 */
export interface ListDurableExecutionsResponse {
    DurableExecutions?: (Execution)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface ListEventSourceMappingsRequest {
    EventSourceArn?: string | undefined;
    FunctionName?: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListEventSourceMappingsResponse {
    NextMarker?: string | undefined;
    EventSourceMappings?: (EventSourceMappingConfiguration)[] | undefined;
}
/**
 * @public
 */
export interface ListEventSourceMappingsInternalRequest {
    Marker?: string | undefined;
    MaxItems?: number | undefined;
    AccountId: string | undefined;
}
/**
 * @public
 */
export interface EventSourceMappingInternalConfiguration {
    EventSourceMappingArn?: string | undefined;
}
/**
 * @public
 */
export interface ListEventSourceMappingsInternalResponse {
    NextMarker?: string | undefined;
    EventSourceMappings?: (EventSourceMappingInternalConfiguration)[] | undefined;
}
/**
 * @public
 */
export interface OldListEventSourcesRequest {
    EventSourceArn?: string | undefined;
    FunctionName?: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface OldListEventSourcesResponse {
    NextMarker?: string | undefined;
    EventSources?: (OldEventSourceConfiguration)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionAliasResourceMappingsRequest {
    FunctionArn: string | undefined;
    Alias: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionAliasResourceMappingsResponse {
    ResourceMappings?: (ResourceType)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionCountersInternalRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionCountersInternalResponse {
    NextMarker?: string | undefined;
    FunctionCounters?: (FunctionCounterInternal)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionEventInvokeConfigsRequest {
    FunctionName: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListFunctionEventInvokeConfigsResponse {
    FunctionEventInvokeConfigs?: (FunctionEventInvokeConfig)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionResourceMappingsRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionResourceMappingsResponse {
    ResourceMappings?: (FunctionResourceType)[] | undefined;
}
/**
 * @public
 * @enum
 */
export declare const FunctionVersion: {
    readonly ALL: "ALL";
};
/**
 * @public
 */
export type FunctionVersion = typeof FunctionVersion[keyof typeof FunctionVersion];
/**
 * @public
 */
export interface ListFunctionsRequest {
    MasterRegion?: string | undefined;
    FunctionVersion?: FunctionVersion | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListFunctionsResponse {
    NextMarker?: string | undefined;
    Functions?: (FunctionConfiguration)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionsResponse20150331 {
    NextMarker?: string | undefined;
    Functions?: (FunctionConfiguration20150331)[] | undefined;
}
/**
 * @internal
 */
export declare const ListFunctionsResponse20150331FilterSensitiveLog: (obj: ListFunctionsResponse20150331) => any;
/**
 * @public
 */
export interface ListFunctionsByCodeSigningConfigRequest {
    CodeSigningConfigArn: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListFunctionsByCodeSigningConfigResponse {
    NextMarker?: string | undefined;
    FunctionArns?: (string)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionUrlConfigsRequest {
    FunctionName: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface FunctionUrlConfig {
    FunctionUrl: string | undefined;
    FunctionArn: string | undefined;
    CreationTime: string | undefined;
    LastModifiedTime: string | undefined;
    Cors?: Cors | undefined;
    AuthType: FunctionUrlAuthType | undefined;
    InvokeMode?: InvokeMode | undefined;
}
/**
 * @public
 */
export interface ListFunctionUrlConfigsResponse {
    FunctionUrlConfigs: (FunctionUrlConfig)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionUrlsInternalRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface FunctionUrlInternal {
    FunctionUrl?: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionUrlsInternalResponse {
    NextMarker?: string | undefined;
    FunctionUrls?: (FunctionUrlInternal)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionVersionResourceMappingsRequest {
    FunctionArn: string | undefined;
    Version: string | undefined;
}
/**
 * @public
 */
export interface ListFunctionVersionResourceMappingsResponse {
    ResourceMappings?: (ResourceType)[] | undefined;
}
/**
 * @public
 */
export interface ListFunctionVersionsInternalRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
}
/**
 * @public
 */
export interface FunctionVersionInternal {
    FunctionArn?: string | undefined;
    State?: State | undefined;
}
/**
 * @public
 */
export interface ListFunctionVersionsInternalResponse {
    NextMarker?: string | undefined;
    FunctionVersions?: (FunctionVersionInternal)[] | undefined;
}
/**
 * @public
 */
export interface ListLayersRequest20181031 {
    CompatibleArchitecture?: Architecture | undefined;
    CompatibleRuntime?: Runtime | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface LayerVersionsListItem20181031 {
    LayerVersionArn?: string | undefined;
    Version?: number | undefined;
    Description?: string | undefined;
    CreatedDate?: string | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
    LicenseInfo?: string | undefined;
}
/**
 * @public
 */
export interface LayersListItem20181031 {
    LayerName?: string | undefined;
    LayerArn?: string | undefined;
    LatestMatchingVersion?: LayerVersionsListItem20181031 | undefined;
}
/**
 * @public
 */
export interface ListLayersResponse20181031 {
    NextMarker?: string | undefined;
    Layers?: (LayersListItem20181031)[] | undefined;
}
/**
 * @public
 */
export interface ListLayerVersionsRequest20181031 {
    CompatibleArchitecture?: Architecture | undefined;
    CompatibleRuntime?: Runtime | undefined;
    LayerName: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListLayerVersionsResponse20181031 {
    NextMarker?: string | undefined;
    LayerVersions?: (LayerVersionsListItem20181031)[] | undefined;
}
/**
 * @public
 */
export interface ListLayerVersionsInternalRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListLayerVersionsInternalResponse {
    NextMarker?: string | undefined;
    LayerVersionArns?: (string)[] | undefined;
}
/**
 * @public
 */
export interface ListProvisionedConcurrencyConfigsRequest {
    FunctionName: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ProvisionedConcurrencyConfigListItem {
    FunctionArn?: string | undefined;
    RequestedProvisionedConcurrentExecutions?: number | undefined;
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
}
/**
 * @public
 */
export interface ListProvisionedConcurrencyConfigsResponse {
    ProvisionedConcurrencyConfigs?: (ProvisionedConcurrencyConfigListItem)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface ListProvisionedConcurrencyConfigsByAccountIdRequest {
    AccountId: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListProvisionedConcurrencyConfigsByAccountIdResponse {
    ProvisionedConcurrencyConfigs?: (ProvisionedConcurrencyConfigListItem)[] | undefined;
    NextMarker?: string | undefined;
}
/**
 * @public
 */
export interface ListTagsRequest20170331 {
    Resource: string | undefined;
}
/**
 * @public
 */
export interface ListTagsResponse20170331 {
    Tags?: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface ListVersionsByFunctionRequest20150331 {
    FunctionName: string | undefined;
    Marker?: string | undefined;
    MaxItems?: number | undefined;
}
/**
 * @public
 */
export interface ListVersionsByFunctionResponse20150331 {
    NextMarker?: string | undefined;
    Versions?: (FunctionConfiguration20150331)[] | undefined;
}
/**
 * @internal
 */
export declare const ListVersionsByFunctionResponse20150331FilterSensitiveLog: (obj: ListVersionsByFunctionResponse20150331) => any;
/**
 * @public
 */
export interface DirectUploadLayerCodeTempPath {
    bucketName?: string | undefined;
    key?: string | undefined;
}
/**
 * @public
 */
export interface LayerVersionContentInput20181031 {
    S3Bucket?: string | undefined;
    S3Key?: string | undefined;
    S3ObjectVersion?: string | undefined;
    ZipFile?: Uint8Array | undefined;
    DirectUploadLayerCodeTempPath?: DirectUploadLayerCodeTempPath | undefined;
}
/**
 * @internal
 */
export declare const LayerVersionContentInput20181031FilterSensitiveLog: (obj: LayerVersionContentInput20181031) => any;
/**
 * @public
 */
export interface PublishLayerVersionRequest20181031 {
    LayerName: string | undefined;
    Description?: string | undefined;
    Content: LayerVersionContentInput20181031 | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
    LicenseInfo?: string | undefined;
    FasCredentials?: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const PublishLayerVersionRequest20181031FilterSensitiveLog: (obj: PublishLayerVersionRequest20181031) => any;
/**
 * @public
 */
export interface LayerCodeSignatureCloudTrailData {
    signingProfileVersionArn?: string | undefined;
    signingJobArn?: string | undefined;
    signatureStatus?: string | undefined;
}
/**
 * @public
 */
export interface PublishLayerVersionResponse20181031 {
    Content?: LayerVersionContentOutput20181031 | undefined;
    LayerArn?: string | undefined;
    LayerVersionArn?: string | undefined;
    Description?: string | undefined;
    CreatedDate?: string | undefined;
    Version?: number | undefined;
    CompatibleArchitectures?: (Architecture)[] | undefined;
    CompatibleRuntimes?: (Runtime)[] | undefined;
    LicenseInfo?: string | undefined;
    LayerCodeSignatureCloudTrailData?: LayerCodeSignatureCloudTrailData | undefined;
}
/**
 * @public
 */
export interface PublishVersionRequest20150331 {
    FunctionName: string | undefined;
    CodeSha256?: string | undefined;
    Description?: string | undefined;
    RevisionId?: string | undefined;
    PublishTo?: FunctionVersionLatestPublished | undefined;
}
/**
 * @public
 */
export interface PutFunctionAliasResourceMappingRequest {
    FunctionArn: string | undefined;
    Alias: string | undefined;
    ResourceType: ResourceType | undefined;
}
/**
 * @public
 */
export interface PutFunctionCodeSigningConfigRequest {
    CodeSigningConfigArn: string | undefined;
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface PutFunctionCodeSigningConfigResponse {
    CodeSigningConfigArn: string | undefined;
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface PutFunctionConcurrencyRequest20171031 {
    FunctionName: string | undefined;
    ReservedConcurrentExecutions: number | undefined;
}
/**
 * @public
 */
export interface PutFunctionEventInvokeConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    MaximumRetryAttempts?: number | undefined;
    MaximumEventAgeInSeconds?: number | undefined;
    DestinationConfig?: DestinationConfig | undefined;
}
/**
 * @public
 */
export interface PutFunctionRecursionConfigRequest {
    FunctionName: string | undefined;
    RecursiveLoop: RecursiveLoop | undefined;
}
/**
 * @public
 */
export interface PutFunctionRecursionConfigResponse {
    RecursiveLoop?: RecursiveLoop | undefined;
}
/**
 * @public
 */
export interface PutFunctionResourceMappingRequest {
    FunctionArn: string | undefined;
    ResourceType: FunctionResourceType | undefined;
}
/**
 * @public
 */
export interface PutFunctionResourceMappingResponse {
    FunctionId: string | undefined;
    FunctionSequenceNumber?: number | undefined;
}
/**
 * @public
 */
export interface PutFunctionScalingConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
    FunctionScalingConfig?: FunctionScalingConfig | undefined;
}
/**
 * @public
 */
export interface PutFunctionScalingConfigResponse {
    FunctionState?: State | undefined;
}
/**
 * @public
 */
export interface PutFunctionVersionResourceMappingRequest {
    FunctionArn: string | undefined;
    Version: string | undefined;
    ResourceType: ResourceType | undefined;
}
/**
 * @public
 */
export interface PutProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    Qualifier: string | undefined;
    ProvisionedConcurrentExecutions: number | undefined;
}
/**
 * @public
 */
export interface PutProvisionedConcurrencyConfigResponse {
    RequestedProvisionedConcurrentExecutions?: number | undefined;
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
}
/**
 * @public
 */
export interface PutPublicAccessBlockConfigRequest {
    ResourceArn: string | undefined;
    PublicAccessBlockConfig: PublicAccessBlockConfig | undefined;
}
/**
 * @public
 */
export interface PutPublicAccessBlockConfigResponse {
    PublicAccessBlockConfig?: PublicAccessBlockConfig | undefined;
}
/**
 * @public
 */
export interface PutResourcePolicyRequest {
    ResourceArn: string | undefined;
    Policy: string | undefined;
    BlockPublicPolicy?: boolean | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface PutResourcePolicyResponse {
    Policy?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface PutRuntimeManagementConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    UpdateRuntimeOn: UpdateRuntimeOn | undefined;
    RuntimeVersionArn?: string | undefined;
}
/**
 * @public
 */
export interface PutRuntimeManagementConfigResponse {
    UpdateRuntimeOn: UpdateRuntimeOn | undefined;
    FunctionArn: string | undefined;
    RuntimeVersionArn?: string | undefined;
}
/**
 * @public
 */
export interface ProvisionedConcurrencyConfigReconciliationItem {
    ProvisionedConcurrencyConfigArn?: string | undefined;
    LastModified?: string | undefined;
    PreWarmingStatusReason?: string | undefined;
}
/**
 * @public
 */
export interface ProvisionedConcurrencyFunctionVersionReconciliationItem {
    ProvisionedConcurrentExecutions?: number | undefined;
    RevisionId?: number | undefined;
    LastModified?: string | undefined;
    PreWarmingStatus?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ProvisionedConcurrencyReconciliationActionEnum: {
    readonly MARK_PROVISIONED_CONCURRENCY_AS_FAILED: "MARK_PROVISIONED_CONCURRENCY_AS_FAILED";
    readonly RELEASE_PROVISIONED_CONCURRENCY: "RELEASE_PROVISIONED_CONCURRENCY";
    readonly RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION: "RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION";
    readonly REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS: "REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS";
};
/**
 * @public
 */
export type ProvisionedConcurrencyReconciliationActionEnum = typeof ProvisionedConcurrencyReconciliationActionEnum[keyof typeof ProvisionedConcurrencyReconciliationActionEnum];
/**
 * @public
 */
export interface ReconcileProvisionedConcurrencyRequest {
    FunctionName: string | undefined;
    ReconciliationAction: ProvisionedConcurrencyReconciliationActionEnum | undefined;
    ProvisionedConcurrencyFunctionVersion: ProvisionedConcurrencyFunctionVersionReconciliationItem | undefined;
    ProvisionedConcurrencyConfig?: ProvisionedConcurrencyConfigReconciliationItem | undefined;
}
/**
 * @public
 */
export interface RedriveFunctionResourceTagsRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface RedriveFunctionResourceTagsResponse {
    Terminated?: boolean | undefined;
    ValidationToken?: string | undefined;
}
/**
 * @public
 */
export interface RemoveEventSourceRequest {
    UUID: string | undefined;
}
/**
 * @public
 */
export interface RemoveLayerVersionPermissionRequest20181031 {
    LayerName: string | undefined;
    VersionNumber: number | undefined;
    StatementId: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface RemovePermissionRequest {
    FunctionName: string | undefined;
    StatementId: string | undefined;
    Qualifier?: string | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface ResetFunctionFeatureInternalRequest {
    FeatureGate: string | undefined;
    FunctionArn: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const SigningKeyType: {
    readonly KMS: "KMS";
    readonly POPPYSEED: "POPPYSEED";
};
/**
 * @public
 */
export type SigningKeyType = typeof SigningKeyType[keyof typeof SigningKeyType];
/**
 * @public
 */
export interface ResignFunctionAliasRequest {
    FunctionArn: string | undefined;
    SigningKeyType: SigningKeyType | undefined;
}
/**
 * @public
 */
export interface ResignFunctionAliasResponse {
    Resigned?: boolean | undefined;
}
/**
 * @public
 */
export interface ResignFunctionVersionRequest {
    FunctionArn: string | undefined;
    SigningKeyType: SigningKeyType | undefined;
}
/**
 * @public
 */
export interface ResignFunctionVersionResponse {
    Resigned?: boolean | undefined;
}
/**
 * @public
 */
export interface RuntimeUpdate {
    UpdateRuntimeOn?: UpdateRuntimeOn | undefined;
}
/**
 * @public
 */
export interface RollbackFunctionRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    RuntimeUpdate?: RuntimeUpdate | undefined;
}
/**
 * @public
 */
export interface RuntimeResult {
    UpdateRuntimeOn?: UpdateRuntimeOn | undefined;
    RuntimeVersionArn?: string | undefined;
}
/**
 * @public
 */
export interface RollbackFunctionResponse {
    RuntimeResult?: RuntimeResult | undefined;
}
/**
 * @public
 */
export interface RollbackTagsOwnershipFromLambdaRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface RollbackTagsOwnershipFromLambdaResponse {
    HasTagsOwnershipTransferOccurred: boolean | undefined;
    ValidationToken?: string | undefined;
}
/**
 * @public
 */
export interface SafeDeleteProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    LastModified: string | undefined;
}
/**
 * @public
 */
export declare class CallbackTimeoutException extends __BaseException {
    readonly name: "CallbackTimeoutException";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<CallbackTimeoutException, __BaseException>);
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureRequest {
    CallbackId: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog: (obj: SendDurableExecutionCallbackFailureRequest) => any;
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureResponse {
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatRequest {
    CallbackId: string | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatResponse {
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessRequest {
    CallbackId: string | undefined;
    Result?: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog: (obj: SendDurableExecutionCallbackSuccessRequest) => any;
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessResponse {
}
/**
 * @public
 */
export interface SetAccountRiskSettingsRequest {
    AccountId: string | undefined;
    RiskSettings: AccountRiskSettings | undefined;
}
/**
 * @public
 */
export interface SetAccountSettingsRequest20170430 {
    DeprecatedFeaturesAccess?: (string)[] | undefined;
}
/**
 * @public
 */
export interface SetAccountSettingsResponse20170430 {
    AccountLimit?: AccountLimit | undefined;
    AccountUsage?: AccountUsage | undefined;
    PreviewFeatures?: (string)[] | undefined;
    DeprecatedFeaturesAccess?: (string)[] | undefined;
}
/**
 * @public
 */
export interface StopDurableExecutionRequest {
    DurableExecutionArn: string | undefined;
    Error?: ErrorObject | undefined;
}
/**
 * @internal
 */
export declare const StopDurableExecutionRequestFilterSensitiveLog: (obj: StopDurableExecutionRequest) => any;
/**
 * @public
 */
export interface StopDurableExecutionResponse {
    StopDate?: Date | undefined;
}
/**
 * @public
 */
export interface Tag {
    Key: string | undefined;
    Value?: string | undefined;
}
/**
 * @public
 */
export interface TagsInternal {
    Items?: (Tag)[] | undefined;
}
/**
 * @public
 */
export interface TagResourceRequest20170331 {
    Resource: string | undefined;
    Tags: TagsInternal | undefined;
}
/**
 * @public
 */
export interface TagResourceResponse20170331 {
    Tags?: TagsInternal | undefined;
}
/**
 * @public
 */
export interface TagResourceRequest20170331v2 {
    Resource: string | undefined;
    Tags: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface TagResourceBeforeResourceCreationRequest {
    Resource: string | undefined;
    Tags: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface TagResourceBeforeResourceCreationResponse {
    TagrisExpectedVersion: number | undefined;
}
/**
 * @public
 */
export interface TransferTagsOwnershipToLambdaRequest {
    FunctionArn: string | undefined;
}
/**
 * @public
 */
export interface TransferTagsOwnershipToLambdaResponse {
    HasTagsOwnershipTransferOccurred: boolean | undefined;
}
/**
 * @public
 */
export interface TagKeys {
    Items?: (string)[] | undefined;
}
/**
 * @public
 */
export interface UntagResourceRequest20170331 {
    Resource: string | undefined;
    TagKeys: TagKeys | undefined;
}
/**
 * @public
 */
export interface UntagResourceRequest20170331v2 {
    Resource: string | undefined;
    TagKeys: (string)[] | undefined;
}
/**
 * @public
 */
export interface UpdateAccountSettingsInternalRequest {
    AccountId: string | undefined;
    CustomerConfig: CustomerConfigInternal | undefined;
}
/**
 * @public
 */
export interface UpdateAliasRequest20150331 {
    FunctionName: string | undefined;
    Name: string | undefined;
    FunctionVersion?: string | undefined;
    Description?: string | undefined;
    RoutingConfig?: AliasRoutingConfiguration | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface UpdateCodeSigningConfigRequest {
    Description?: string | undefined;
    CodeSigningConfigArn: string | undefined;
    AllowedPublishers?: AllowedPublishers | undefined;
    CodeSigningPolicies?: CodeSigningPolicies | undefined;
}
/**
 * @public
 */
export interface UpdateCodeSigningConfigResponse {
    CodeSigningConfig: CodeSigningConfig | undefined;
}
/**
 * @public
 */
export interface UpdateConcurrencyInProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    ConcurrentExecutions: number | undefined;
}
/**
 * @public
 */
export interface UpdateEventSourceMappingRequest {
    UUID: string | undefined;
    FunctionName?: string | undefined;
    Enabled?: boolean | undefined;
    BatchSize?: number | undefined;
    FilterCriteria?: FilterCriteria | undefined;
    KMSKeyArn?: string | undefined;
    MetricsConfig?: EventSourceMappingMetricsConfig | undefined;
    ScalingConfig?: ScalingConfig | undefined;
    MaximumBatchingWindowInSeconds?: number | undefined;
    ParallelizationFactor?: number | undefined;
    DestinationConfig?: DestinationConfig | undefined;
    MaximumRecordAgeInSeconds?: number | undefined;
    BisectBatchOnFunctionError?: boolean | undefined;
    MaximumRetryAttempts?: number | undefined;
    PartialBatchResponse?: boolean | undefined;
    TumblingWindowInSeconds?: number | undefined;
    SourceAccessConfigurations?: (SourceAccessConfiguration)[] | undefined;
    FunctionResponseTypes?: (FunctionResponseType)[] | undefined;
    AmazonManagedKafkaEventSourceConfig?: AmazonManagedKafkaEventSourceConfig | undefined;
    SelfManagedKafkaEventSourceConfig?: SelfManagedKafkaEventSourceConfig | undefined;
    DocumentDBEventSourceConfig?: DocumentDBEventSourceConfig | undefined;
    ProvisionedPollerConfig?: ProvisionedPollerConfig | undefined;
}
/**
 * @public
 */
export interface UpdateFunctionCodeRequest {
    FunctionName: string | undefined;
    FunctionZip: Uint8Array | undefined;
}
/**
 * @internal
 */
export declare const UpdateFunctionCodeRequestFilterSensitiveLog: (obj: UpdateFunctionCodeRequest) => any;
/**
 * @public
 */
export interface UpdateFunctionCodeRequest20150331 {
    FunctionName: string | undefined;
    ZipFile?: Uint8Array | undefined;
    S3Bucket?: string | undefined;
    S3Key?: string | undefined;
    S3ObjectVersion?: string | undefined;
    S3ObjectStorageMode?: S3ObjectStorageMode | undefined;
    ImageUri?: string | undefined;
    Publish?: boolean | undefined;
    DryRun?: boolean | undefined;
    RevisionId?: string | undefined;
    Architectures?: (Architecture)[] | undefined;
    SourceKMSKeyArn?: string | undefined;
    PublishTo?: FunctionVersionLatestPublished | undefined;
}
/**
 * @internal
 */
export declare const UpdateFunctionCodeRequest20150331FilterSensitiveLog: (obj: UpdateFunctionCodeRequest20150331) => any;
/**
 * @public
 */
export interface UpdateFunctionConfigurationRequest {
    FunctionName: string | undefined;
    Role?: string | undefined;
    Handler?: string | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
}
/**
 * @public
 */
export interface UpdateFunctionConfigurationRequest20150331 {
    FunctionName: string | undefined;
    Role?: string | undefined;
    Handler?: string | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
    VpcConfig?: VpcConfig | undefined;
    Environment?: Environment | undefined;
    Runtime?: Runtime | undefined;
    DeadLetterConfig?: DeadLetterConfig | undefined;
    KMSKeyArn?: string | undefined;
    TracingConfig?: TracingConfig | undefined;
    RevisionId?: string | undefined;
    Layers?: (string)[] | undefined;
    FileSystemConfigs?: (FileSystemConfig)[] | undefined;
    PackageType?: PackageType | undefined;
    ImageConfig?: ImageConfig | undefined;
    EphemeralStorage?: EphemeralStorage | undefined;
    SnapStart?: SnapStart | undefined;
    LoggingConfig?: LoggingConfig | undefined;
    ProgrammingModel?: ProgrammingModel | undefined;
    WebProgrammingModelConfig?: WebProgrammingModelConfig | undefined;
    ExecutionEnvironmentConcurrencyConfig?: ExecutionEnvironmentConcurrencyConfig | undefined;
    DurableConfig?: DurableConfig | undefined;
}
/**
 * @internal
 */
export declare const UpdateFunctionConfigurationRequest20150331FilterSensitiveLog: (obj: UpdateFunctionConfigurationRequest20150331) => any;
/**
 * @public
 */
export interface UpdateFunctionEventInvokeConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    MaximumRetryAttempts?: number | undefined;
    MaximumEventAgeInSeconds?: number | undefined;
    DestinationConfig?: DestinationConfig | undefined;
}
/**
 * @public
 */
export interface UpdateFunctionUrlConfigRequest {
    FunctionName: string | undefined;
    Qualifier?: string | undefined;
    AuthType?: FunctionUrlAuthType | undefined;
    Cors?: Cors | undefined;
    InvokeMode?: InvokeMode | undefined;
}
/**
 * @public
 */
export interface UpdateFunctionUrlConfigResponse {
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
export interface UpdateFunctionVersionResourceMappingRequest {
    CurrentValue: string | undefined;
    FunctionArn: string | undefined;
    NewValue: string | undefined;
    ResourceType: ResourceType | undefined;
    Version: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ProvisionedConcurrencyStatusReasonCodeEnum: {
    readonly RELEASE_AND_CREATE_CONFIG: "RELEASE_AND_CREATE_CONFIG";
    readonly RESOURCE_NON_INVOCABLE: "RESOURCE_NON_INVOCABLE";
};
/**
 * @public
 */
export type ProvisionedConcurrencyStatusReasonCodeEnum = typeof ProvisionedConcurrencyStatusReasonCodeEnum[keyof typeof ProvisionedConcurrencyStatusReasonCodeEnum];
/**
 * @public
 */
export interface UpdateProvisionedConcurrencyConfigRequest {
    FunctionName: string | undefined;
    Status: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
    ProvisionedConcurrentExecutions?: number | undefined;
    ProvisionedConcurrencyStatusReasonCode?: ProvisionedConcurrencyStatusReasonCodeEnum | undefined;
}
/**
 * @public
 */
export interface UpdateProvisionedConcurrencyConfigResponse {
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    StatusReason?: string | undefined;
    LastModified?: string | undefined;
}
/**
 * @public
 * @enum
 */
export declare const ProvisionedConcurrencyVersionStatus: {
    readonly DELETING: "DELETING";
    readonly NONE: "NONE";
};
/**
 * @public
 */
export type ProvisionedConcurrencyVersionStatus = typeof ProvisionedConcurrencyVersionStatus[keyof typeof ProvisionedConcurrencyVersionStatus];
/**
 * @public
 */
export interface UpdateVersionProvisionedConcurrencyStatusRequest {
    FunctionName: string | undefined;
    DesiredConcurrentExecutions: number | undefined;
    ProvisionedConcurrentExecutions: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    RevisionId: string | undefined;
    VersionStatus?: ProvisionedConcurrencyVersionStatus | undefined;
}
/**
 * @public
 */
export interface UpdateVersionProvisionedConcurrencyStatusResponse {
    AllocatedProvisionedConcurrentExecutions?: number | undefined;
    Status?: ProvisionedConcurrencyStatusEnum | undefined;
    RevisionId?: string | undefined;
}
/**
 * @public
 */
export interface UploadFunctionRequest {
    FunctionName: string | undefined;
    FunctionZip: Uint8Array | undefined;
    Runtime: Runtime | undefined;
    Role: string | undefined;
    Handler: string | undefined;
    Mode: Mode | undefined;
    Description?: string | undefined;
    Timeout?: number | undefined;
    MemorySize?: number | undefined;
}
/**
 * @internal
 */
export declare const UploadFunctionRequestFilterSensitiveLog: (obj: UploadFunctionRequest) => any;
/**
 * @public
 */
export interface ValidateProvisionedConcurrencyFunctionVersionRequest {
    FunctionName: string | undefined;
}
/**
 * @public
 */
export interface ValidateProvisionedConcurrencyFunctionVersionResponse {
    DesiredProvisionedConcurrentExecutions?: number | undefined;
}
