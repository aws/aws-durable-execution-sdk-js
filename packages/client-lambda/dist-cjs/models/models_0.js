"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionVersionLatestPublished = exports.ProgrammingModel = exports.PackageType = exports.SystemLogLevel = exports.LogFormat = exports.UserOverride = exports.ConcurrencyMode = exports.EnvironmentFilterSensitiveLog = exports.FunctionCodeFilterSensitiveLog = exports.S3ObjectStorageMode = exports.CodeVerificationFailedException = exports.CodeStorageExceededException = exports.CodeSigningConfigNotFoundException = exports.EventSourcePosition = exports.SourceAccessType = exports.EndPointType = exports.EventSourceMappingMetric = exports.FunctionResponseType = exports.FullDocument = exports.CodeSigningPolicy = exports.CheckpointDurableExecutionResponseFilterSensitiveLog = exports.CheckpointUpdatedExecutionStateFilterSensitiveLog = exports.OperationFilterSensitiveLog = exports.StepDetailsFilterSensitiveLog = exports.OperationStatus = exports.InvokeDetailsFilterSensitiveLog = exports.ExecutionDetailsFilterSensitiveLog = exports.ContextDetailsFilterSensitiveLog = exports.CallbackDetailsFilterSensitiveLog = exports.CheckpointDurableExecutionRequestFilterSensitiveLog = exports.OperationUpdateFilterSensitiveLog = exports.OperationType = exports.ErrorObjectFilterSensitiveLog = exports.OperationAction = exports.Architecture = exports.ApplicationLogLevel = exports.KafkaSchemaValidationAttribute = exports.SchemaRegistryEventRecordFormat = exports.KafkaSchemaRegistryAuthType = exports.AliasLimitExceededException = exports.PublicPolicyException = exports.FunctionUrlAuthType = exports.TooManyRequestsException = exports.ThrottleReason = exports.PreconditionFailedException = exports.PolicyLengthExceededException = exports.ServiceException = exports.ResourceNotFoundException = exports.ResourceConflictException = exports.InvalidParameterValueException = void 0;
exports.InvokeSucceededDetailsFilterSensitiveLog = exports.InvokeStoppedDetailsFilterSensitiveLog = exports.InvokeStartedDetailsFilterSensitiveLog = exports.InvokeFailedDetailsFilterSensitiveLog = exports.ExecutionTimedOutDetailsFilterSensitiveLog = exports.ExecutionSucceededDetailsFilterSensitiveLog = exports.ExecutionStoppedDetailsFilterSensitiveLog = exports.ExecutionStartedDetailsFilterSensitiveLog = exports.EventInputFilterSensitiveLog = exports.ExecutionFailedDetailsFilterSensitiveLog = exports.EventType = exports.ContextSucceededDetailsFilterSensitiveLog = exports.ContextFailedDetailsFilterSensitiveLog = exports.CallbackTimedOutDetailsFilterSensitiveLog = exports.CallbackSucceededDetailsFilterSensitiveLog = exports.EventResultFilterSensitiveLog = exports.CallbackFailedDetailsFilterSensitiveLog = exports.EventErrorFilterSensitiveLog = exports.GetDurableExecutionResponseFilterSensitiveLog = exports.ExecutionStatus = exports.ProvisionedConcurrencyStatusEnum = exports.ResourceNotReadyException = exports.ExportFunctionVersionResponseFilterSensitiveLog = exports.MigrationFunctionVersionFilterSensitiveLog = exports.VmSelectorPreference = exports.RuntimeUpdateReason = exports.ProvisionedConcurrencyState = exports.Mode = exports.CodeSignatureStatus = exports.FeatureStatus = exports.FunctionResourceType = exports.ResourceType = exports.ResourceInUseException = exports.InvokeMode = exports.InvalidCodeSignatureException = exports.FunctionConfiguration20150331FilterSensitiveLog = exports.StateReasonCode = exports.State = exports.SnapStartOptimizationStatus = exports.LastUpdateStatusReasonCode = exports.LastUpdateStatus = exports.ImageConfigResponseFilterSensitiveLog = exports.ImageConfigErrorFilterSensitiveLog = exports.EnvironmentResponseFilterSensitiveLog = exports.EnvironmentErrorFilterSensitiveLog = exports.CreateFunctionRequestFilterSensitiveLog = exports.TracingMode = exports.TenantIsolationMode = exports.SnapStartApplyOn = exports.Runtime = void 0;
exports.GetVersionSandboxSpecResponseFilterSensitiveLog = exports.UpdateRuntimeOn = exports.ProvisionedConcurrencyConfigNotFoundException = exports.RecursiveLoop = exports.GetFunctionInternalResponseFilterSensitiveLog = exports.InternalLambdaAccountDisabledException = exports.GetFunctionResponse20150331FilterSensitiveLog = exports.GetDurableExecutionStateResponseFilterSensitiveLog = exports.GetDurableExecutionHistoryResponseFilterSensitiveLog = exports.EventFilterSensitiveLog = exports.WaitCancelledDetailsFilterSensitiveLog = exports.StepSucceededDetailsFilterSensitiveLog = exports.StepFailedDetailsFilterSensitiveLog = exports.InvokeTimedOutDetailsFilterSensitiveLog = void 0;
const LambdaServiceException_1 = require("./LambdaServiceException");
const smithy_client_1 = require("@smithy/smithy-client");
class InvalidParameterValueException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidParameterValueException = InvalidParameterValueException;
class ResourceConflictException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ResourceConflictException = ResourceConflictException;
class ResourceNotFoundException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ResourceNotFoundException = ResourceNotFoundException;
class ServiceException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ServiceException = ServiceException;
class PolicyLengthExceededException extends LambdaServiceException_1.LambdaServiceException {
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
exports.PolicyLengthExceededException = PolicyLengthExceededException;
class PreconditionFailedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.PreconditionFailedException = PreconditionFailedException;
exports.ThrottleReason = {
    CallerRateLimitExceeded: "CallerRateLimitExceeded",
    ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded",
    ConcurrentSnapshotCreateLimitExceeded: "ConcurrentSnapshotCreateLimitExceeded",
    FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded",
    ReservedFunctionConcurrentInvocationLimitExceeded: "ReservedFunctionConcurrentInvocationLimitExceeded",
    ReservedFunctionInvocationRateLimitExceeded: "ReservedFunctionInvocationRateLimitExceeded",
};
class TooManyRequestsException extends LambdaServiceException_1.LambdaServiceException {
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
exports.TooManyRequestsException = TooManyRequestsException;
exports.FunctionUrlAuthType = {
    AWS_IAM: "AWS_IAM",
    NONE: "NONE",
};
class PublicPolicyException extends LambdaServiceException_1.LambdaServiceException {
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
exports.PublicPolicyException = PublicPolicyException;
class AliasLimitExceededException extends LambdaServiceException_1.LambdaServiceException {
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
exports.AliasLimitExceededException = AliasLimitExceededException;
exports.KafkaSchemaRegistryAuthType = {
    BASIC_AUTH: "BASIC_AUTH",
    CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
    SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
};
exports.SchemaRegistryEventRecordFormat = {
    JSON: "JSON",
    SOURCE: "SOURCE",
};
exports.KafkaSchemaValidationAttribute = {
    KEY: "KEY",
    VALUE: "VALUE",
};
exports.ApplicationLogLevel = {
    Debug: "DEBUG",
    Error: "ERROR",
    Fatal: "FATAL",
    Info: "INFO",
    Trace: "TRACE",
    Warn: "WARN",
};
exports.Architecture = {
    arm64: "arm64",
    x86_64: "x86_64",
};
exports.OperationAction = {
    CANCEL: "CANCEL",
    FAIL: "FAIL",
    RETRY: "RETRY",
    START: "START",
    SUCCEED: "SUCCEED",
};
const ErrorObjectFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ErrorMessage && { ErrorMessage: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.ErrorType && { ErrorType: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.ErrorData && { ErrorData: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.StackTrace && { StackTrace: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.ErrorObjectFilterSensitiveLog = ErrorObjectFilterSensitiveLog;
exports.OperationType = {
    CALLBACK: "CALLBACK",
    CONTEXT: "CONTEXT",
    EXECUTION: "EXECUTION",
    INVOKE: "INVOKE",
    STEP: "STEP",
    WAIT: "WAIT",
};
const OperationUpdateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.OperationUpdateFilterSensitiveLog = OperationUpdateFilterSensitiveLog;
const CheckpointDurableExecutionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Updates && { Updates: obj.Updates.map(item => (0, exports.OperationUpdateFilterSensitiveLog)(item))
    }),
});
exports.CheckpointDurableExecutionRequestFilterSensitiveLog = CheckpointDurableExecutionRequestFilterSensitiveLog;
const CallbackDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.CallbackDetailsFilterSensitiveLog = CallbackDetailsFilterSensitiveLog;
const ContextDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.ContextDetailsFilterSensitiveLog = ContextDetailsFilterSensitiveLog;
const ExecutionDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InputPayload && { InputPayload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.ExecutionDetailsFilterSensitiveLog = ExecutionDetailsFilterSensitiveLog;
const InvokeDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.InvokeDetailsFilterSensitiveLog = InvokeDetailsFilterSensitiveLog;
exports.OperationStatus = {
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
    PENDING: "PENDING",
    READY: "READY",
    STARTED: "STARTED",
    STOPPED: "STOPPED",
    SUCCEEDED: "SUCCEEDED",
    TIMED_OUT: "TIMED_OUT",
};
const StepDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.StepDetailsFilterSensitiveLog = StepDetailsFilterSensitiveLog;
const OperationFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ExecutionDetails && { ExecutionDetails: (0, exports.ExecutionDetailsFilterSensitiveLog)(obj.ExecutionDetails)
    }),
    ...(obj.ContextDetails && { ContextDetails: (0, exports.ContextDetailsFilterSensitiveLog)(obj.ContextDetails)
    }),
    ...(obj.StepDetails && { StepDetails: (0, exports.StepDetailsFilterSensitiveLog)(obj.StepDetails)
    }),
    ...(obj.CallbackDetails && { CallbackDetails: (0, exports.CallbackDetailsFilterSensitiveLog)(obj.CallbackDetails)
    }),
    ...(obj.InvokeDetails && { InvokeDetails: (0, exports.InvokeDetailsFilterSensitiveLog)(obj.InvokeDetails)
    }),
});
exports.OperationFilterSensitiveLog = OperationFilterSensitiveLog;
const CheckpointUpdatedExecutionStateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Operations && { Operations: obj.Operations.map(item => (0, exports.OperationFilterSensitiveLog)(item))
    }),
});
exports.CheckpointUpdatedExecutionStateFilterSensitiveLog = CheckpointUpdatedExecutionStateFilterSensitiveLog;
const CheckpointDurableExecutionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.NewExecutionState && { NewExecutionState: (0, exports.CheckpointUpdatedExecutionStateFilterSensitiveLog)(obj.NewExecutionState)
    }),
});
exports.CheckpointDurableExecutionResponseFilterSensitiveLog = CheckpointDurableExecutionResponseFilterSensitiveLog;
exports.CodeSigningPolicy = {
    Enforce: "Enforce",
    Warn: "Warn",
};
exports.FullDocument = {
    Default: "Default",
    UpdateLookup: "UpdateLookup",
};
exports.FunctionResponseType = {
    ReportBatchItemFailures: "ReportBatchItemFailures",
};
exports.EventSourceMappingMetric = {
    EventCount: "EventCount",
};
exports.EndPointType = {
    KAFKA_BOOTSTRAP_SERVERS: "KAFKA_BOOTSTRAP_SERVERS",
};
exports.SourceAccessType = {
    BASIC_AUTH: "BASIC_AUTH",
    CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
    SASL_SCRAM_256_AUTH: "SASL_SCRAM_256_AUTH",
    SASL_SCRAM_512_AUTH: "SASL_SCRAM_512_AUTH",
    SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
    VIRTUAL_HOST: "VIRTUAL_HOST",
    VPC_SECURITY_GROUP: "VPC_SECURITY_GROUP",
    VPC_SUBNET: "VPC_SUBNET",
};
exports.EventSourcePosition = {
    AT_TIMESTAMP: "AT_TIMESTAMP",
    LATEST: "LATEST",
    TRIM_HORIZON: "TRIM_HORIZON",
};
class CodeSigningConfigNotFoundException extends LambdaServiceException_1.LambdaServiceException {
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
exports.CodeSigningConfigNotFoundException = CodeSigningConfigNotFoundException;
class CodeStorageExceededException extends LambdaServiceException_1.LambdaServiceException {
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
exports.CodeStorageExceededException = CodeStorageExceededException;
class CodeVerificationFailedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.CodeVerificationFailedException = CodeVerificationFailedException;
exports.S3ObjectStorageMode = {
    Copy: "COPY",
    Reference: "REFERENCE",
};
const FunctionCodeFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.FunctionCodeFilterSensitiveLog = FunctionCodeFilterSensitiveLog;
const EnvironmentFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.EnvironmentFilterSensitiveLog = EnvironmentFilterSensitiveLog;
exports.ConcurrencyMode = {
    MULTI: "MULTI",
    SINGLE: "SINGLE",
};
exports.UserOverride = {
    AllowRoot: "AllowRoot",
    AllowUnprivileged: "AllowUnprivileged",
    Deny: "Deny",
};
exports.LogFormat = {
    Json: "JSON",
    Text: "Text",
};
exports.SystemLogLevel = {
    Debug: "DEBUG",
    Info: "INFO",
    Warn: "WARN",
};
exports.PackageType = {
    Image: "Image",
    Zip: "Zip",
};
exports.ProgrammingModel = {
    HANDLER: "HANDLER",
    WEB: "WEB",
};
exports.FunctionVersionLatestPublished = {
    LATEST_PUBLISHED: "LATEST_PUBLISHED",
};
exports.Runtime = {
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
exports.SnapStartApplyOn = {
    None: "None",
    PublishedVersions: "PublishedVersions",
};
exports.TenantIsolationMode = {
    PER_INVOKE: "PER_INVOKE",
    PER_TENANT: "PER_TENANT",
};
exports.TracingMode = {
    Active: "Active",
    PassThrough: "PassThrough",
};
const CreateFunctionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Code && { Code: (0, exports.FunctionCodeFilterSensitiveLog)(obj.Code)
    }),
    ...(obj.Environment && { Environment: (0, exports.EnvironmentFilterSensitiveLog)(obj.Environment)
    }),
});
exports.CreateFunctionRequestFilterSensitiveLog = CreateFunctionRequestFilterSensitiveLog;
const EnvironmentErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Message && { Message: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.EnvironmentErrorFilterSensitiveLog = EnvironmentErrorFilterSensitiveLog;
const EnvironmentResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.EnvironmentErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.EnvironmentResponseFilterSensitiveLog = EnvironmentResponseFilterSensitiveLog;
const ImageConfigErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Message && { Message: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.ImageConfigErrorFilterSensitiveLog = ImageConfigErrorFilterSensitiveLog;
const ImageConfigResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.ImageConfigErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.ImageConfigResponseFilterSensitiveLog = ImageConfigResponseFilterSensitiveLog;
exports.LastUpdateStatus = {
    Failed: "Failed",
    InProgress: "InProgress",
    Successful: "Successful",
};
exports.LastUpdateStatusReasonCode = {
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
exports.SnapStartOptimizationStatus = {
    Off: "Off",
    On: "On",
};
exports.State = {
    Active: "Active",
    ActiveNonInvocable: "ActiveNonInvocable",
    Deactivated: "Deactivated",
    Deactivating: "Deactivating",
    Deleting: "Deleting",
    Failed: "Failed",
    Inactive: "Inactive",
    Pending: "Pending",
};
exports.StateReasonCode = {
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
const FunctionConfiguration20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Environment && { Environment: (0, exports.EnvironmentResponseFilterSensitiveLog)(obj.Environment)
    }),
    ...(obj.ImageConfigResponse && { ImageConfigResponse: (0, exports.ImageConfigResponseFilterSensitiveLog)(obj.ImageConfigResponse)
    }),
});
exports.FunctionConfiguration20150331FilterSensitiveLog = FunctionConfiguration20150331FilterSensitiveLog;
class InvalidCodeSignatureException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidCodeSignatureException = InvalidCodeSignatureException;
exports.InvokeMode = {
    BUFFERED: "BUFFERED",
    RESPONSE_STREAM: "RESPONSE_STREAM",
};
class ResourceInUseException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ResourceInUseException = ResourceInUseException;
exports.ResourceType = {
    CODE_ARTIFACT: "CODE_ARTIFACT",
    PROVISIONED_CONCURRENCY: "PROVISIONED_CONCURRENCY",
};
exports.FunctionResourceType = {
    PER_FUNCTION_CONCURRENCY: "PER_FUNCTION_CONCURRENCY",
};
exports.FeatureStatus = {
    Accessible: "Accessible",
    Inaccessible: "Inaccessible",
};
exports.CodeSignatureStatus = {
    CORRUPT: "CORRUPT",
    EXPIRED: "EXPIRED",
    MISMATCH: "MISMATCH",
    REVOKED: "REVOKED",
    VALID: "VALID",
};
exports.Mode = {
    event: "event",
    http: "http",
};
exports.ProvisionedConcurrencyState = {
    Active: "Active",
    Inactive: "Inactive",
};
exports.RuntimeUpdateReason = {
    PINNED: "PINNED",
    PRERELEASE: "PRERELEASE",
    RELEASE: "RELEASE",
    ROLLOUT: "ROLLOUT",
};
exports.VmSelectorPreference = {
    k5brave: "k5brave",
    k5preview: "k5preview",
    sbxv2brave: "sbxv2brave",
    sbxv2preview: "sbxv2preview",
};
const MigrationFunctionVersionFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MergedLayersUri && { MergedLayersUri: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.CodeMergedWithLayersUri && { CodeMergedWithLayersUri: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.MigrationFunctionVersionFilterSensitiveLog = MigrationFunctionVersionFilterSensitiveLog;
const ExportFunctionVersionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: (0, exports.MigrationFunctionVersionFilterSensitiveLog)(obj.MigrationFunctionVersion)
    }),
});
exports.ExportFunctionVersionResponseFilterSensitiveLog = ExportFunctionVersionResponseFilterSensitiveLog;
class ResourceNotReadyException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ResourceNotReadyException = ResourceNotReadyException;
exports.ProvisionedConcurrencyStatusEnum = {
    FAILED: "FAILED",
    IN_PROGRESS: "IN_PROGRESS",
    READY: "READY",
};
exports.ExecutionStatus = {
    FAILED: "FAILED",
    RUNNING: "RUNNING",
    STOPPED: "STOPPED",
    SUCCEEDED: "SUCCEEDED",
    TIMED_OUT: "TIMED_OUT",
};
const GetDurableExecutionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InputPayload && { InputPayload: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.Error && { Error: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.GetDurableExecutionResponseFilterSensitiveLog = GetDurableExecutionResponseFilterSensitiveLog;
const EventErrorFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: (0, exports.ErrorObjectFilterSensitiveLog)(obj.Payload)
    }),
});
exports.EventErrorFilterSensitiveLog = EventErrorFilterSensitiveLog;
const CallbackFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.CallbackFailedDetailsFilterSensitiveLog = CallbackFailedDetailsFilterSensitiveLog;
const EventResultFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.EventResultFilterSensitiveLog = EventResultFilterSensitiveLog;
const CallbackSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result)
    }),
});
exports.CallbackSucceededDetailsFilterSensitiveLog = CallbackSucceededDetailsFilterSensitiveLog;
const CallbackTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.CallbackTimedOutDetailsFilterSensitiveLog = CallbackTimedOutDetailsFilterSensitiveLog;
const ContextFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.ContextFailedDetailsFilterSensitiveLog = ContextFailedDetailsFilterSensitiveLog;
const ContextSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result)
    }),
});
exports.ContextSucceededDetailsFilterSensitiveLog = ContextSucceededDetailsFilterSensitiveLog;
exports.EventType = {
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
const ExecutionFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.ExecutionFailedDetailsFilterSensitiveLog = ExecutionFailedDetailsFilterSensitiveLog;
const EventInputFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.EventInputFilterSensitiveLog = EventInputFilterSensitiveLog;
const ExecutionStartedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Input && { Input: (0, exports.EventInputFilterSensitiveLog)(obj.Input)
    }),
});
exports.ExecutionStartedDetailsFilterSensitiveLog = ExecutionStartedDetailsFilterSensitiveLog;
const ExecutionStoppedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.ExecutionStoppedDetailsFilterSensitiveLog = ExecutionStoppedDetailsFilterSensitiveLog;
const ExecutionSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result)
    }),
});
exports.ExecutionSucceededDetailsFilterSensitiveLog = ExecutionSucceededDetailsFilterSensitiveLog;
const ExecutionTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.ExecutionTimedOutDetailsFilterSensitiveLog = ExecutionTimedOutDetailsFilterSensitiveLog;
const InvokeFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.InvokeFailedDetailsFilterSensitiveLog = InvokeFailedDetailsFilterSensitiveLog;
const InvokeStartedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Input && { Input: (0, exports.EventInputFilterSensitiveLog)(obj.Input)
    }),
});
exports.InvokeStartedDetailsFilterSensitiveLog = InvokeStartedDetailsFilterSensitiveLog;
const InvokeStoppedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.InvokeStoppedDetailsFilterSensitiveLog = InvokeStoppedDetailsFilterSensitiveLog;
const InvokeSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result)
    }),
});
exports.InvokeSucceededDetailsFilterSensitiveLog = InvokeSucceededDetailsFilterSensitiveLog;
const InvokeTimedOutDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.InvokeTimedOutDetailsFilterSensitiveLog = InvokeTimedOutDetailsFilterSensitiveLog;
const StepFailedDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.StepFailedDetailsFilterSensitiveLog = StepFailedDetailsFilterSensitiveLog;
const StepSucceededDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: (0, exports.EventResultFilterSensitiveLog)(obj.Result)
    }),
});
exports.StepSucceededDetailsFilterSensitiveLog = StepSucceededDetailsFilterSensitiveLog;
const WaitCancelledDetailsFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, exports.EventErrorFilterSensitiveLog)(obj.Error)
    }),
});
exports.WaitCancelledDetailsFilterSensitiveLog = WaitCancelledDetailsFilterSensitiveLog;
const EventFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ExecutionStartedDetails && { ExecutionStartedDetails: (0, exports.ExecutionStartedDetailsFilterSensitiveLog)(obj.ExecutionStartedDetails)
    }),
    ...(obj.ExecutionSucceededDetails && { ExecutionSucceededDetails: (0, exports.ExecutionSucceededDetailsFilterSensitiveLog)(obj.ExecutionSucceededDetails)
    }),
    ...(obj.ExecutionFailedDetails && { ExecutionFailedDetails: (0, exports.ExecutionFailedDetailsFilterSensitiveLog)(obj.ExecutionFailedDetails)
    }),
    ...(obj.ExecutionTimedOutDetails && { ExecutionTimedOutDetails: (0, exports.ExecutionTimedOutDetailsFilterSensitiveLog)(obj.ExecutionTimedOutDetails)
    }),
    ...(obj.ExecutionStoppedDetails && { ExecutionStoppedDetails: (0, exports.ExecutionStoppedDetailsFilterSensitiveLog)(obj.ExecutionStoppedDetails)
    }),
    ...(obj.ContextSucceededDetails && { ContextSucceededDetails: (0, exports.ContextSucceededDetailsFilterSensitiveLog)(obj.ContextSucceededDetails)
    }),
    ...(obj.ContextFailedDetails && { ContextFailedDetails: (0, exports.ContextFailedDetailsFilterSensitiveLog)(obj.ContextFailedDetails)
    }),
    ...(obj.WaitCancelledDetails && { WaitCancelledDetails: (0, exports.WaitCancelledDetailsFilterSensitiveLog)(obj.WaitCancelledDetails)
    }),
    ...(obj.StepSucceededDetails && { StepSucceededDetails: (0, exports.StepSucceededDetailsFilterSensitiveLog)(obj.StepSucceededDetails)
    }),
    ...(obj.StepFailedDetails && { StepFailedDetails: (0, exports.StepFailedDetailsFilterSensitiveLog)(obj.StepFailedDetails)
    }),
    ...(obj.InvokeStartedDetails && { InvokeStartedDetails: (0, exports.InvokeStartedDetailsFilterSensitiveLog)(obj.InvokeStartedDetails)
    }),
    ...(obj.InvokeSucceededDetails && { InvokeSucceededDetails: (0, exports.InvokeSucceededDetailsFilterSensitiveLog)(obj.InvokeSucceededDetails)
    }),
    ...(obj.InvokeFailedDetails && { InvokeFailedDetails: (0, exports.InvokeFailedDetailsFilterSensitiveLog)(obj.InvokeFailedDetails)
    }),
    ...(obj.InvokeTimedOutDetails && { InvokeTimedOutDetails: (0, exports.InvokeTimedOutDetailsFilterSensitiveLog)(obj.InvokeTimedOutDetails)
    }),
    ...(obj.InvokeStoppedDetails && { InvokeStoppedDetails: (0, exports.InvokeStoppedDetailsFilterSensitiveLog)(obj.InvokeStoppedDetails)
    }),
    ...(obj.CallbackSucceededDetails && { CallbackSucceededDetails: (0, exports.CallbackSucceededDetailsFilterSensitiveLog)(obj.CallbackSucceededDetails)
    }),
    ...(obj.CallbackFailedDetails && { CallbackFailedDetails: (0, exports.CallbackFailedDetailsFilterSensitiveLog)(obj.CallbackFailedDetails)
    }),
    ...(obj.CallbackTimedOutDetails && { CallbackTimedOutDetails: (0, exports.CallbackTimedOutDetailsFilterSensitiveLog)(obj.CallbackTimedOutDetails)
    }),
});
exports.EventFilterSensitiveLog = EventFilterSensitiveLog;
const GetDurableExecutionHistoryResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Events && { Events: obj.Events.map(item => (0, exports.EventFilterSensitiveLog)(item))
    }),
});
exports.GetDurableExecutionHistoryResponseFilterSensitiveLog = GetDurableExecutionHistoryResponseFilterSensitiveLog;
const GetDurableExecutionStateResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Operations && { Operations: obj.Operations.map(item => (0, exports.OperationFilterSensitiveLog)(item))
    }),
});
exports.GetDurableExecutionStateResponseFilterSensitiveLog = GetDurableExecutionStateResponseFilterSensitiveLog;
const GetFunctionResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Configuration && { Configuration: (0, exports.FunctionConfiguration20150331FilterSensitiveLog)(obj.Configuration)
    }),
});
exports.GetFunctionResponse20150331FilterSensitiveLog = GetFunctionResponse20150331FilterSensitiveLog;
class InternalLambdaAccountDisabledException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InternalLambdaAccountDisabledException = InternalLambdaAccountDisabledException;
const GetFunctionInternalResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Configuration && { Configuration: (0, exports.FunctionConfiguration20150331FilterSensitiveLog)(obj.Configuration)
    }),
});
exports.GetFunctionInternalResponseFilterSensitiveLog = GetFunctionInternalResponseFilterSensitiveLog;
exports.RecursiveLoop = {
    Allow: "Allow",
    Terminate: "Terminate",
};
class ProvisionedConcurrencyConfigNotFoundException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ProvisionedConcurrencyConfigNotFoundException = ProvisionedConcurrencyConfigNotFoundException;
exports.UpdateRuntimeOn = {
    Auto: "Auto",
    FunctionUpdate: "FunctionUpdate",
    Manual: "Manual",
};
const GetVersionSandboxSpecResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.SandboxSpec && { SandboxSpec: smithy_client_1.SENSITIVE_STRING
    }),
    ...(obj.PendingConfigSandboxSpec && { PendingConfigSandboxSpec: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.GetVersionSandboxSpecResponseFilterSensitiveLog = GetVersionSandboxSpecResponseFilterSensitiveLog;
