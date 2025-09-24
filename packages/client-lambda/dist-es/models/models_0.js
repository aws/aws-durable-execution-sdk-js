import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { SENSITIVE_STRING, } from "@smithy/smithy-client";
export class InvalidParameterValueException extends __BaseException {
    name = "InvalidParameterValueException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "InvalidParameterValueException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidParameterValueException.prototype);
        this.Type = opts.Type;
    }
}
export class ResourceConflictException extends __BaseException {
    name = "ResourceConflictException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "ResourceConflictException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, ResourceConflictException.prototype);
        this.Type = opts.Type;
    }
}
export class ResourceNotFoundException extends __BaseException {
    name = "ResourceNotFoundException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "ResourceNotFoundException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class ServiceException extends __BaseException {
    name = "ServiceException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "ServiceException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, ServiceException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class PolicyLengthExceededException extends __BaseException {
    name = "PolicyLengthExceededException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "PolicyLengthExceededException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, PolicyLengthExceededException.prototype);
        this.Type = opts.Type;
    }
}
export class PreconditionFailedException extends __BaseException {
    name = "PreconditionFailedException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "PreconditionFailedException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, PreconditionFailedException.prototype);
        this.Type = opts.Type;
    }
}
export const ThrottleReason = {
    CallerRateLimitExceeded: "CallerRateLimitExceeded",
    ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded",
    ConcurrentSnapshotCreateLimitExceeded: "ConcurrentSnapshotCreateLimitExceeded",
    FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded",
    ReservedFunctionConcurrentInvocationLimitExceeded: "ReservedFunctionConcurrentInvocationLimitExceeded",
    ReservedFunctionInvocationRateLimitExceeded: "ReservedFunctionInvocationRateLimitExceeded",
};
export class TooManyRequestsException extends __BaseException {
    name = "TooManyRequestsException";
    $fault = "client";
    retryAfterSeconds;
    Type;
    Reason;
    constructor(opts) {
        super({
            name: "TooManyRequestsException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, TooManyRequestsException.prototype);
        this.retryAfterSeconds = opts.retryAfterSeconds;
        this.Type = opts.Type;
        this.Reason = opts.Reason;
    }
}
export const FunctionUrlAuthType = {
    AWS_IAM: "AWS_IAM",
    NONE: "NONE",
};
export class PublicPolicyException extends __BaseException {
    name = "PublicPolicyException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "PublicPolicyException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, PublicPolicyException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class AliasLimitExceededException extends __BaseException {
    name = "AliasLimitExceededException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "AliasLimitExceededException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, AliasLimitExceededException.prototype);
        this.Type = opts.Type;
    }
}
export const KafkaSchemaRegistryAuthType = {
    BASIC_AUTH: "BASIC_AUTH",
    CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
    SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
};
export const SchemaRegistryEventRecordFormat = {
    JSON: "JSON",
    SOURCE: "SOURCE",
};
export const KafkaSchemaValidationAttribute = {
    KEY: "KEY",
    VALUE: "VALUE",
};
export const ApplicationLogLevel = {
    Debug: "DEBUG",
    Error: "ERROR",
    Fatal: "FATAL",
    Info: "INFO",
    Trace: "TRACE",
    Warn: "WARN",
};
export const Architecture = {
    arm64: "arm64",
    x86_64: "x86_64",
};
export const OperationAction = {
    CANCEL: "CANCEL",
    FAIL: "FAIL",
    RETRY: "RETRY",
    START: "START",
    SUCCEED: "SUCCEED",
};
export const ErrorObjectFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ErrorMessage && { ErrorMessage: SENSITIVE_STRING
    }),
    ...(obj.ErrorType && { ErrorType: SENSITIVE_STRING
    }),
    ...(obj.ErrorData && { ErrorData: SENSITIVE_STRING
    }),
    ...(obj.StackTrace && { StackTrace: SENSITIVE_STRING
    }),
});
export const OperationType = {
    CALLBACK: "CALLBACK",
    CONTEXT: "CONTEXT",
    EXECUTION: "EXECUTION",
    INVOKE: "INVOKE",
    STEP: "STEP",
    WAIT: "WAIT",
};
export const OperationUpdateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const CheckpointDurableExecutionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Updates && { Updates: obj.Updates.map(item => OperationUpdateFilterSensitiveLog(item))
    }),
});
export const CallbackDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const ContextDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const ExecutionDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InputPayload && { InputPayload: SENSITIVE_STRING
    }),
});
export const InvokeDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const OperationStatus = {
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
    PENDING: "PENDING",
    READY: "READY",
    STARTED: "STARTED",
    STOPPED: "STOPPED",
    SUCCEEDED: "SUCCEEDED",
    TIMED_OUT: "TIMED_OUT",
};
export const StepDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const OperationFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ExecutionDetails && { ExecutionDetails: ExecutionDetailsFilterSensitiveLog(obj.ExecutionDetails)
    }),
    ...(obj.ContextDetails && { ContextDetails: ContextDetailsFilterSensitiveLog(obj.ContextDetails)
    }),
    ...(obj.StepDetails && { StepDetails: StepDetailsFilterSensitiveLog(obj.StepDetails)
    }),
    ...(obj.CallbackDetails && { CallbackDetails: CallbackDetailsFilterSensitiveLog(obj.CallbackDetails)
    }),
    ...(obj.InvokeDetails && { InvokeDetails: InvokeDetailsFilterSensitiveLog(obj.InvokeDetails)
    }),
});
export const CheckpointUpdatedExecutionStateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Operations && { Operations: obj.Operations.map(item => OperationFilterSensitiveLog(item))
    }),
});
export const CheckpointDurableExecutionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.NewExecutionState && { NewExecutionState: CheckpointUpdatedExecutionStateFilterSensitiveLog(obj.NewExecutionState)
    }),
});
export const CodeSigningPolicy = {
    Enforce: "Enforce",
    Warn: "Warn",
};
export const FullDocument = {
    Default: "Default",
    UpdateLookup: "UpdateLookup",
};
export const FunctionResponseType = {
    ReportBatchItemFailures: "ReportBatchItemFailures",
};
export const EventSourceMappingMetric = {
    EventCount: "EventCount",
};
export const EndPointType = {
    KAFKA_BOOTSTRAP_SERVERS: "KAFKA_BOOTSTRAP_SERVERS",
};
export const SourceAccessType = {
    BASIC_AUTH: "BASIC_AUTH",
    CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
    SASL_SCRAM_256_AUTH: "SASL_SCRAM_256_AUTH",
    SASL_SCRAM_512_AUTH: "SASL_SCRAM_512_AUTH",
    SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
    VIRTUAL_HOST: "VIRTUAL_HOST",
    VPC_SECURITY_GROUP: "VPC_SECURITY_GROUP",
    VPC_SUBNET: "VPC_SUBNET",
};
export const EventSourcePosition = {
    AT_TIMESTAMP: "AT_TIMESTAMP",
    LATEST: "LATEST",
    TRIM_HORIZON: "TRIM_HORIZON",
};
export class CodeSigningConfigNotFoundException extends __BaseException {
    name = "CodeSigningConfigNotFoundException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "CodeSigningConfigNotFoundException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, CodeSigningConfigNotFoundException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class CodeStorageExceededException extends __BaseException {
    name = "CodeStorageExceededException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "CodeStorageExceededException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, CodeStorageExceededException.prototype);
        this.Type = opts.Type;
    }
}
export class CodeVerificationFailedException extends __BaseException {
    name = "CodeVerificationFailedException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "CodeVerificationFailedException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, CodeVerificationFailedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export const S3ObjectStorageMode = {
    Copy: "COPY",
    Reference: "REFERENCE",
};
export const FunctionCodeFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: SENSITIVE_STRING
    }),
});
export const EnvironmentFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: SENSITIVE_STRING
    }),
});
export const ConcurrencyMode = {
    MULTI: "MULTI",
    SINGLE: "SINGLE",
};
export const UserOverride = {
    AllowRoot: "AllowRoot",
    AllowUnprivileged: "AllowUnprivileged",
    Deny: "Deny",
};
export const LogFormat = {
    Json: "JSON",
    Text: "Text",
};
export const SystemLogLevel = {
    Debug: "DEBUG",
    Info: "INFO",
    Warn: "WARN",
};
export const PackageType = {
    Image: "Image",
    Zip: "Zip",
};
export const ProgrammingModel = {
    HANDLER: "HANDLER",
    WEB: "WEB",
};
export const FunctionVersionLatestPublished = {
    LATEST_PUBLISHED: "LATEST_PUBLISHED",
};
export const Runtime = {
    byol: "byol",
    dotnet10: "dotnet10",
    dotnet6: "dotnet6",
    dotnet8: "dotnet8",
    dotnetcore10: "dotnetcore1.0",
    dotnetcore20: "dotnetcore2.0",
    dotnetcore21: "dotnetcore2.1",
    dotnetcore31: "dotnetcore3.1",
    go19: "go1.9",
    go1x: "go1.x",
    java11: "java11",
    java17: "java17",
    java21: "java21",
    java25: "java25",
    java8: "java8",
    java8al2: "java8.al2",
    nodejs: "nodejs",
    nodejs10x: "nodejs10.x",
    nodejs12x: "nodejs12.x",
    nodejs14x: "nodejs14.x",
    nodejs16x: "nodejs16.x",
    nodejs18x: "nodejs18.x",
    nodejs20x: "nodejs20.x",
    nodejs22x: "nodejs22.x",
    nodejs24x: "nodejs24.x",
    nodejs43: "nodejs4.3",
    nodejs43edge: "nodejs4.3-edge",
    nodejs610: "nodejs6.10",
    nodejs810: "nodejs8.10",
    provided: "provided",
    providedal2: "provided.al2",
    providedal2023: "provided.al2023",
    python27: "python2.7",
    python27greengrass: "python2.7-greengrass",
    python310: "python3.10",
    python311: "python3.11",
    python312: "python3.12",
    python313: "python3.13",
    python314: "python3.14",
    python36: "python3.6",
    python37: "python3.7",
    python38: "python3.8",
    python39: "python3.9",
    ruby25: "ruby2.5",
    ruby27: "ruby2.7",
    ruby32: "ruby3.2",
    ruby33: "ruby3.3",
    ruby34: "ruby3.4",
};
export const SnapStartApplyOn = {
    None: "None",
    PublishedVersions: "PublishedVersions",
};
export const TenantIsolationMode = {
    PER_INVOKE: "PER_INVOKE",
    PER_TENANT: "PER_TENANT",
};
export const TracingMode = {
    Active: "Active",
    PassThrough: "PassThrough",
};
export const CreateFunctionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Code && { Code: FunctionCodeFilterSensitiveLog(obj.Code)
    }),
    ...(obj.Environment && { Environment: EnvironmentFilterSensitiveLog(obj.Environment)
    }),
});
export const EnvironmentErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Message && { Message: SENSITIVE_STRING
    }),
});
export const EnvironmentResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: EnvironmentErrorFilterSensitiveLog(obj.Error)
    }),
});
export const ImageConfigErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Message && { Message: SENSITIVE_STRING
    }),
});
export const ImageConfigResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: ImageConfigErrorFilterSensitiveLog(obj.Error)
    }),
});
export const LastUpdateStatus = {
    Failed: "Failed",
    InProgress: "InProgress",
    Successful: "Successful",
};
export const LastUpdateStatusReasonCode = {
    DisabledKMSKey: "DisabledKMSKey",
    EFSIOError: "EFSIOError",
    EFSMountConnectivityError: "EFSMountConnectivityError",
    EFSMountFailure: "EFSMountFailure",
    EFSMountTimeout: "EFSMountTimeout",
    EniLimitExceeded: "EniLimitExceeded",
    FunctionError: "FunctionError",
    ImageAccessDenied: "ImageAccessDenied",
    ImageDeleted: "ImageDeleted",
    InsufficientRolePermissions: "InsufficientRolePermissions",
    InternalError: "InternalError",
    InvalidConfiguration: "InvalidConfiguration",
    InvalidImage: "InvalidImage",
    InvalidRuntime: "InvalidRuntime",
    InvalidSecurityGroup: "InvalidSecurityGroup",
    InvalidStateKMSKey: "InvalidStateKMSKey",
    InvalidSubnet: "InvalidSubnet",
    InvalidZipFileException: "InvalidZipFileException",
    KMSKeyAccessDenied: "KMSKeyAccessDenied",
    KMSKeyNotFound: "KMSKeyNotFound",
    SubnetOutOfIPAddresses: "SubnetOutOfIPAddresses",
};
export const SnapStartOptimizationStatus = {
    Off: "Off",
    On: "On",
};
export const State = {
    Active: "Active",
    ActiveNonInvocable: "ActiveNonInvocable",
    Deactivated: "Deactivated",
    Deactivating: "Deactivating",
    Deleting: "Deleting",
    Failed: "Failed",
    Inactive: "Inactive",
    Pending: "Pending",
};
export const StateReasonCode = {
    Creating: "Creating",
    DisabledKMSKey: "DisabledKMSKey",
    EFSIOError: "EFSIOError",
    EFSMountConnectivityError: "EFSMountConnectivityError",
    EFSMountFailure: "EFSMountFailure",
    EFSMountTimeout: "EFSMountTimeout",
    EniLimitExceeded: "EniLimitExceeded",
    FunctionError: "FunctionError",
    Idle: "Idle",
    ImageAccessDenied: "ImageAccessDenied",
    ImageDeleted: "ImageDeleted",
    InsufficientRolePermissions: "InsufficientRolePermissions",
    InternalError: "InternalError",
    InvalidConfiguration: "InvalidConfiguration",
    InvalidImage: "InvalidImage",
    InvalidRuntime: "InvalidRuntime",
    InvalidSecurityGroup: "InvalidSecurityGroup",
    InvalidStateKMSKey: "InvalidStateKMSKey",
    InvalidSubnet: "InvalidSubnet",
    InvalidZipFileException: "InvalidZipFileException",
    KMSKeyAccessDenied: "KMSKeyAccessDenied",
    KMSKeyNotFound: "KMSKeyNotFound",
    Restoring: "Restoring",
    SubnetOutOfIPAddresses: "SubnetOutOfIPAddresses",
};
export const FunctionConfiguration20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Environment && { Environment: EnvironmentResponseFilterSensitiveLog(obj.Environment)
    }),
    ...(obj.ImageConfigResponse && { ImageConfigResponse: ImageConfigResponseFilterSensitiveLog(obj.ImageConfigResponse)
    }),
});
export class InvalidCodeSignatureException extends __BaseException {
    name = "InvalidCodeSignatureException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InvalidCodeSignatureException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidCodeSignatureException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export const InvokeMode = {
    BUFFERED: "BUFFERED",
    RESPONSE_STREAM: "RESPONSE_STREAM",
};
export class ResourceInUseException extends __BaseException {
    name = "ResourceInUseException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "ResourceInUseException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, ResourceInUseException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export const ResourceType = {
    CODE_ARTIFACT: "CODE_ARTIFACT",
    PROVISIONED_CONCURRENCY: "PROVISIONED_CONCURRENCY",
};
export const FunctionResourceType = {
    PER_FUNCTION_CONCURRENCY: "PER_FUNCTION_CONCURRENCY",
};
export const FeatureStatus = {
    Accessible: "Accessible",
    Inaccessible: "Inaccessible",
};
export const CodeSignatureStatus = {
    CORRUPT: "CORRUPT",
    EXPIRED: "EXPIRED",
    MISMATCH: "MISMATCH",
    REVOKED: "REVOKED",
    VALID: "VALID",
};
export const Mode = {
    event: "event",
    http: "http",
};
export const ProvisionedConcurrencyState = {
    Active: "Active",
    Inactive: "Inactive",
};
export const RuntimeUpdateReason = {
    PINNED: "PINNED",
    PRERELEASE: "PRERELEASE",
    RELEASE: "RELEASE",
    ROLLOUT: "ROLLOUT",
};
export const VmSelectorPreference = {
    k5brave: "k5brave",
    k5preview: "k5preview",
    sbxv2brave: "sbxv2brave",
    sbxv2preview: "sbxv2preview",
};
export const MigrationFunctionVersionFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MergedLayersUri && { MergedLayersUri: SENSITIVE_STRING
    }),
    ...(obj.CodeMergedWithLayersUri && { CodeMergedWithLayersUri: SENSITIVE_STRING
    }),
});
export const ExportFunctionVersionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: MigrationFunctionVersionFilterSensitiveLog(obj.MigrationFunctionVersion)
    }),
});
export class ResourceNotReadyException extends __BaseException {
    name = "ResourceNotReadyException";
    $fault = "server";
    Type;
    constructor(opts) {
        super({
            name: "ResourceNotReadyException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, ResourceNotReadyException.prototype);
        this.Type = opts.Type;
    }
}
export const ProvisionedConcurrencyStatusEnum = {
    FAILED: "FAILED",
    IN_PROGRESS: "IN_PROGRESS",
    READY: "READY",
};
export const ExecutionStatus = {
    FAILED: "FAILED",
    RUNNING: "RUNNING",
    STOPPED: "STOPPED",
    SUCCEEDED: "SUCCEEDED",
    TIMED_OUT: "TIMED_OUT",
};
export const GetDurableExecutionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InputPayload && { InputPayload: SENSITIVE_STRING
    }),
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const EventErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: ErrorObjectFilterSensitiveLog(obj.Payload)
    }),
});
export const CallbackFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const EventResultFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export const CallbackSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result)
    }),
});
export const CallbackTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const ContextFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const ContextSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result)
    }),
});
export const EventType = {
    CallbackFailed: "CallbackFailed",
    CallbackStarted: "CallbackStarted",
    CallbackSucceeded: "CallbackSucceeded",
    CallbackTimedOut: "CallbackTimedOut",
    ContextFailed: "ContextFailed",
    ContextStarted: "ContextStarted",
    ContextSucceeded: "ContextSucceeded",
    ExecutionFailed: "ExecutionFailed",
    ExecutionStarted: "ExecutionStarted",
    ExecutionStopped: "ExecutionStopped",
    ExecutionSucceeded: "ExecutionSucceeded",
    ExecutionTimedOut: "ExecutionTimedOut",
    InvokeCancelled: "InvokeCancelled",
    InvokeFailed: "InvokeFailed",
    InvokeStarted: "InvokeStarted",
    InvokeSucceeded: "InvokeSucceeded",
    InvokeTimedOut: "InvokeTimedOut",
    StepFailed: "StepFailed",
    StepStarted: "StepStarted",
    StepSucceeded: "StepSucceeded",
    WaitCancelled: "WaitCancelled",
    WaitStarted: "WaitStarted",
    WaitSucceeded: "WaitSucceeded",
};
export const ExecutionFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const EventInputFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export const ExecutionStartedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input)
    }),
});
export const ExecutionStoppedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const ExecutionSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result)
    }),
});
export const ExecutionTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const InvokeFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const InvokeStartedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input)
    }),
});
export const InvokeStoppedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const InvokeSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result)
    }),
});
export const InvokeTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const StepFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const StepSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result)
    }),
});
export const WaitCancelledDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error)
    }),
});
export const EventFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ExecutionStartedDetails && { ExecutionStartedDetails: ExecutionStartedDetailsFilterSensitiveLog(obj.ExecutionStartedDetails)
    }),
    ...(obj.ExecutionSucceededDetails && { ExecutionSucceededDetails: ExecutionSucceededDetailsFilterSensitiveLog(obj.ExecutionSucceededDetails)
    }),
    ...(obj.ExecutionFailedDetails && { ExecutionFailedDetails: ExecutionFailedDetailsFilterSensitiveLog(obj.ExecutionFailedDetails)
    }),
    ...(obj.ExecutionTimedOutDetails && { ExecutionTimedOutDetails: ExecutionTimedOutDetailsFilterSensitiveLog(obj.ExecutionTimedOutDetails)
    }),
    ...(obj.ExecutionStoppedDetails && { ExecutionStoppedDetails: ExecutionStoppedDetailsFilterSensitiveLog(obj.ExecutionStoppedDetails)
    }),
    ...(obj.ContextSucceededDetails && { ContextSucceededDetails: ContextSucceededDetailsFilterSensitiveLog(obj.ContextSucceededDetails)
    }),
    ...(obj.ContextFailedDetails && { ContextFailedDetails: ContextFailedDetailsFilterSensitiveLog(obj.ContextFailedDetails)
    }),
    ...(obj.WaitCancelledDetails && { WaitCancelledDetails: WaitCancelledDetailsFilterSensitiveLog(obj.WaitCancelledDetails)
    }),
    ...(obj.StepSucceededDetails && { StepSucceededDetails: StepSucceededDetailsFilterSensitiveLog(obj.StepSucceededDetails)
    }),
    ...(obj.StepFailedDetails && { StepFailedDetails: StepFailedDetailsFilterSensitiveLog(obj.StepFailedDetails)
    }),
    ...(obj.InvokeStartedDetails && { InvokeStartedDetails: InvokeStartedDetailsFilterSensitiveLog(obj.InvokeStartedDetails)
    }),
    ...(obj.InvokeSucceededDetails && { InvokeSucceededDetails: InvokeSucceededDetailsFilterSensitiveLog(obj.InvokeSucceededDetails)
    }),
    ...(obj.InvokeFailedDetails && { InvokeFailedDetails: InvokeFailedDetailsFilterSensitiveLog(obj.InvokeFailedDetails)
    }),
    ...(obj.InvokeTimedOutDetails && { InvokeTimedOutDetails: InvokeTimedOutDetailsFilterSensitiveLog(obj.InvokeTimedOutDetails)
    }),
    ...(obj.InvokeStoppedDetails && { InvokeStoppedDetails: InvokeStoppedDetailsFilterSensitiveLog(obj.InvokeStoppedDetails)
    }),
    ...(obj.CallbackSucceededDetails && { CallbackSucceededDetails: CallbackSucceededDetailsFilterSensitiveLog(obj.CallbackSucceededDetails)
    }),
    ...(obj.CallbackFailedDetails && { CallbackFailedDetails: CallbackFailedDetailsFilterSensitiveLog(obj.CallbackFailedDetails)
    }),
    ...(obj.CallbackTimedOutDetails && { CallbackTimedOutDetails: CallbackTimedOutDetailsFilterSensitiveLog(obj.CallbackTimedOutDetails)
    }),
});
export const GetDurableExecutionHistoryResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Events && { Events: obj.Events.map(item => EventFilterSensitiveLog(item))
    }),
});
export const GetDurableExecutionStateResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Operations && { Operations: obj.Operations.map(item => OperationFilterSensitiveLog(item))
    }),
});
export const GetFunctionResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Configuration && { Configuration: FunctionConfiguration20150331FilterSensitiveLog(obj.Configuration)
    }),
});
export class InternalLambdaAccountDisabledException extends __BaseException {
    name = "InternalLambdaAccountDisabledException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InternalLambdaAccountDisabledException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, InternalLambdaAccountDisabledException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export const GetFunctionInternalResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Configuration && { Configuration: FunctionConfiguration20150331FilterSensitiveLog(obj.Configuration)
    }),
});
export const RecursiveLoop = {
    Allow: "Allow",
    Terminate: "Terminate",
};
export class ProvisionedConcurrencyConfigNotFoundException extends __BaseException {
    name = "ProvisionedConcurrencyConfigNotFoundException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "ProvisionedConcurrencyConfigNotFoundException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, ProvisionedConcurrencyConfigNotFoundException.prototype);
        this.Type = opts.Type;
    }
}
export const UpdateRuntimeOn = {
    Auto: "Auto",
    FunctionUpdate: "FunctionUpdate",
    Manual: "Manual",
};
export const GetVersionSandboxSpecResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.SandboxSpec && { SandboxSpec: SENSITIVE_STRING
    }),
    ...(obj.PendingConfigSandboxSpec && { PendingConfigSandboxSpec: SENSITIVE_STRING
    }),
});
