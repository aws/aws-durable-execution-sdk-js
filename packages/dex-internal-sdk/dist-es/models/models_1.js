import { LambdaServiceException as __BaseException } from "./LambdaServiceException";
import { EnvironmentFilterSensitiveLog, ErrorObjectFilterSensitiveLog, FunctionConfiguration20150331FilterSensitiveLog, MigrationFunctionVersionFilterSensitiveLog, } from "./models_0";
import { SENSITIVE_STRING, } from "@smithy/smithy-client";
export const ImportFunctionVersionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: MigrationFunctionVersionFilterSensitiveLog(obj.MigrationFunctionVersion)
    }),
});
export const ImportFunctionVersionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: MigrationFunctionVersionFilterSensitiveLog(obj.MigrationFunctionVersion)
    }),
});
export class DurableExecutionAlreadyStartedException extends __BaseException {
    name = "DurableExecutionAlreadyStartedException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "DurableExecutionAlreadyStartedException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, DurableExecutionAlreadyStartedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EC2AccessDeniedException extends __BaseException {
    name = "EC2AccessDeniedException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EC2AccessDeniedException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, EC2AccessDeniedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EC2ThrottledException extends __BaseException {
    name = "EC2ThrottledException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EC2ThrottledException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, EC2ThrottledException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EC2UnexpectedException extends __BaseException {
    name = "EC2UnexpectedException";
    $fault = "server";
    Type;
    Message;
    EC2ErrorCode;
    constructor(opts) {
        super({
            name: "EC2UnexpectedException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, EC2UnexpectedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
        this.EC2ErrorCode = opts.EC2ErrorCode;
    }
}
export class EFSIOException extends __BaseException {
    name = "EFSIOException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EFSIOException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, EFSIOException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EFSMountConnectivityException extends __BaseException {
    name = "EFSMountConnectivityException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EFSMountConnectivityException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, EFSMountConnectivityException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EFSMountFailureException extends __BaseException {
    name = "EFSMountFailureException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EFSMountFailureException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, EFSMountFailureException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class EFSMountTimeoutException extends __BaseException {
    name = "EFSMountTimeoutException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "EFSMountTimeoutException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, EFSMountTimeoutException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class ENILimitReachedException extends __BaseException {
    name = "ENILimitReachedException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "ENILimitReachedException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, ENILimitReachedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class InvalidRequestContentException extends __BaseException {
    name = "InvalidRequestContentException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "InvalidRequestContentException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidRequestContentException.prototype);
        this.Type = opts.Type;
    }
}
export class InvalidRuntimeException extends __BaseException {
    name = "InvalidRuntimeException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InvalidRuntimeException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidRuntimeException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class InvalidSecurityGroupIDException extends __BaseException {
    name = "InvalidSecurityGroupIDException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InvalidSecurityGroupIDException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidSecurityGroupIDException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class InvalidSubnetIDException extends __BaseException {
    name = "InvalidSubnetIDException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InvalidSubnetIDException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidSubnetIDException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class InvalidZipFileException extends __BaseException {
    name = "InvalidZipFileException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "InvalidZipFileException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, InvalidZipFileException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export const InvocationType = {
    DryRun: "DryRun",
    Event: "Event",
    RequestResponse: "RequestResponse",
};
export const LogType = {
    None: "None",
    Tail: "Tail",
};
export const InvocationRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export const InvocationResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export class KMSAccessDeniedException extends __BaseException {
    name = "KMSAccessDeniedException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "KMSAccessDeniedException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, KMSAccessDeniedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class KMSDisabledException extends __BaseException {
    name = "KMSDisabledException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "KMSDisabledException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, KMSDisabledException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class KMSInvalidStateException extends __BaseException {
    name = "KMSInvalidStateException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "KMSInvalidStateException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, KMSInvalidStateException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class KMSNotFoundException extends __BaseException {
    name = "KMSNotFoundException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "KMSNotFoundException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, KMSNotFoundException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class ModeNotSupportedException extends __BaseException {
    name = "ModeNotSupportedException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "ModeNotSupportedException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, ModeNotSupportedException.prototype);
        this.Type = opts.Type;
    }
}
export class NoPublishedVersionException extends __BaseException {
    name = "NoPublishedVersionException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "NoPublishedVersionException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, NoPublishedVersionException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class RecursiveInvocationException extends __BaseException {
    name = "RecursiveInvocationException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "RecursiveInvocationException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, RecursiveInvocationException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class RequestTooLargeException extends __BaseException {
    name = "RequestTooLargeException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "RequestTooLargeException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, RequestTooLargeException.prototype);
        this.Type = opts.Type;
    }
}
export class SnapRestoreException extends __BaseException {
    name = "SnapRestoreException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapRestoreException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapRestoreException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SnapRestoreTimeoutException extends __BaseException {
    name = "SnapRestoreTimeoutException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapRestoreTimeoutException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapRestoreTimeoutException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SnapStartException extends __BaseException {
    name = "SnapStartException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapStartException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapStartException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SnapStartNotReadyException extends __BaseException {
    name = "SnapStartNotReadyException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapStartNotReadyException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapStartNotReadyException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SnapStartRegenerationFailureException extends __BaseException {
    name = "SnapStartRegenerationFailureException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapStartRegenerationFailureException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapStartRegenerationFailureException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SnapStartTimeoutException extends __BaseException {
    name = "SnapStartTimeoutException";
    $fault = "client";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SnapStartTimeoutException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, SnapStartTimeoutException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class SubnetIPAddressLimitReachedException extends __BaseException {
    name = "SubnetIPAddressLimitReachedException";
    $fault = "server";
    Type;
    Message;
    constructor(opts) {
        super({
            name: "SubnetIPAddressLimitReachedException",
            $fault: "server",
            ...opts
        });
        Object.setPrototypeOf(this, SubnetIPAddressLimitReachedException.prototype);
        this.Type = opts.Type;
        this.Message = opts.Message;
    }
}
export class UnsupportedMediaTypeException extends __BaseException {
    name = "UnsupportedMediaTypeException";
    $fault = "client";
    Type;
    constructor(opts) {
        super({
            name: "UnsupportedMediaTypeException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, UnsupportedMediaTypeException.prototype);
        this.Type = opts.Type;
    }
}
export const InvokeAsyncRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InvokeArgs && { InvokeArgs: SENSITIVE_STRING
    }),
});
export const InvokeAsyncResponseFilterSensitiveLog = (obj) => ({
    ...obj,
});
export const InvokeWithResponseStreamRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export const InvokeResponseStreamUpdateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: SENSITIVE_STRING
    }),
});
export var InvokeWithResponseStreamResponseEvent;
(function (InvokeWithResponseStreamResponseEvent) {
    InvokeWithResponseStreamResponseEvent.visit = (value, visitor) => {
        if (value.PayloadChunk !== undefined)
            return visitor.PayloadChunk(value.PayloadChunk);
        if (value.InvokeComplete !== undefined)
            return visitor.InvokeComplete(value.InvokeComplete);
        return visitor._(value.$unknown[0], value.$unknown[1]);
    };
})(InvokeWithResponseStreamResponseEvent || (InvokeWithResponseStreamResponseEvent = {}));
export const InvokeWithResponseStreamResponseEventFilterSensitiveLog = (obj) => {
    if (obj.PayloadChunk !== undefined)
        return { PayloadChunk: InvokeResponseStreamUpdateFilterSensitiveLog(obj.PayloadChunk)
        };
    if (obj.InvokeComplete !== undefined)
        return { InvokeComplete: obj.InvokeComplete
        };
    if (obj.$unknown !== undefined)
        return { [obj.$unknown[0]]: 'UNKNOWN' };
};
export const InvokeWithResponseStreamResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.EventStream && { EventStream: 'STREAMING_CONTENT'
    }),
});
export const FunctionVersion = {
    ALL: "ALL",
};
export const ListFunctionsResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Functions && { Functions: obj.Functions.map(item => FunctionConfiguration20150331FilterSensitiveLog(item))
    }),
});
export const ListVersionsByFunctionResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Versions && { Versions: obj.Versions.map(item => FunctionConfiguration20150331FilterSensitiveLog(item))
    }),
});
export const LayerVersionContentInput20181031FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: SENSITIVE_STRING
    }),
});
export const PublishLayerVersionRequest20181031FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Content && { Content: LayerVersionContentInput20181031FilterSensitiveLog(obj.Content)
    }),
});
export const ProvisionedConcurrencyReconciliationActionEnum = {
    MARK_PROVISIONED_CONCURRENCY_AS_FAILED: "MARK_PROVISIONED_CONCURRENCY_AS_FAILED",
    RELEASE_PROVISIONED_CONCURRENCY: "RELEASE_PROVISIONED_CONCURRENCY",
    RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION: "RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION",
    REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS: "REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS",
};
export const SigningKeyType = {
    KMS: "KMS",
    POPPYSEED: "POPPYSEED",
};
export class CallbackTimeoutException extends __BaseException {
    name = "CallbackTimeoutException";
    $fault = "client";
    constructor(opts) {
        super({
            name: "CallbackTimeoutException",
            $fault: "client",
            ...opts
        });
        Object.setPrototypeOf(this, CallbackTimeoutException.prototype);
    }
}
export const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: SENSITIVE_STRING
    }),
});
export const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error)
    }),
});
export const UpdateFunctionCodeRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.FunctionZip && { FunctionZip: SENSITIVE_STRING
    }),
});
export const UpdateFunctionCodeRequest20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: SENSITIVE_STRING
    }),
});
export const UpdateFunctionConfigurationRequest20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Environment && { Environment: EnvironmentFilterSensitiveLog(obj.Environment)
    }),
});
export const ProvisionedConcurrencyStatusReasonCodeEnum = {
    RELEASE_AND_CREATE_CONFIG: "RELEASE_AND_CREATE_CONFIG",
    RESOURCE_NON_INVOCABLE: "RESOURCE_NON_INVOCABLE",
};
export const ProvisionedConcurrencyVersionStatus = {
    DELETING: "DELETING",
    NONE: "NONE",
};
export const UploadFunctionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.FunctionZip && { FunctionZip: SENSITIVE_STRING
    }),
});
