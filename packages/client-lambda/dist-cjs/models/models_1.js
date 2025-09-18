"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SigningKeyType = exports.ProvisionedConcurrencyReconciliationActionEnum = exports.PublishLayerVersionRequest20181031FilterSensitiveLog = exports.LayerVersionContentInput20181031FilterSensitiveLog = exports.ListVersionsByFunctionResponse20150331FilterSensitiveLog = exports.ListFunctionsResponse20150331FilterSensitiveLog = exports.FunctionVersion = exports.InvokeWithResponseStreamResponseFilterSensitiveLog = exports.InvokeWithResponseStreamResponseEventFilterSensitiveLog = exports.InvokeWithResponseStreamResponseEvent = exports.InvokeResponseStreamUpdateFilterSensitiveLog = exports.InvokeWithResponseStreamRequestFilterSensitiveLog = exports.InvokeAsyncResponseFilterSensitiveLog = exports.InvokeAsyncRequestFilterSensitiveLog = exports.UnsupportedMediaTypeException = exports.SubnetIPAddressLimitReachedException = exports.SnapStartTimeoutException = exports.SnapStartRegenerationFailureException = exports.SnapStartNotReadyException = exports.SnapStartException = exports.SnapRestoreTimeoutException = exports.SnapRestoreException = exports.RequestTooLargeException = exports.RecursiveInvocationException = exports.NoPublishedVersionException = exports.ModeNotSupportedException = exports.KMSNotFoundException = exports.KMSInvalidStateException = exports.KMSDisabledException = exports.KMSAccessDeniedException = exports.InvocationResponseFilterSensitiveLog = exports.InvocationRequestFilterSensitiveLog = exports.LogType = exports.InvocationType = exports.InvalidZipFileException = exports.InvalidSubnetIDException = exports.InvalidSecurityGroupIDException = exports.InvalidRuntimeException = exports.InvalidRequestContentException = exports.ENILimitReachedException = exports.EFSMountTimeoutException = exports.EFSMountFailureException = exports.EFSMountConnectivityException = exports.EFSIOException = exports.EC2UnexpectedException = exports.EC2ThrottledException = exports.EC2AccessDeniedException = exports.DurableExecutionAlreadyStartedException = exports.ImportFunctionVersionResponseFilterSensitiveLog = exports.ImportFunctionVersionRequestFilterSensitiveLog = void 0;
exports.UploadFunctionRequestFilterSensitiveLog = exports.ProvisionedConcurrencyVersionStatus = exports.ProvisionedConcurrencyStatusReasonCodeEnum = exports.UpdateFunctionConfigurationRequest20150331FilterSensitiveLog = exports.UpdateFunctionCodeRequest20150331FilterSensitiveLog = exports.UpdateFunctionCodeRequestFilterSensitiveLog = exports.StopDurableExecutionRequestFilterSensitiveLog = exports.SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = exports.SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = exports.CallbackTimeoutException = void 0;
const LambdaServiceException_1 = require("./LambdaServiceException");
const models_0_1 = require("./models_0");
const smithy_client_1 = require("@smithy/smithy-client");
const ImportFunctionVersionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: (0, models_0_1.MigrationFunctionVersionFilterSensitiveLog)(obj.MigrationFunctionVersion)
    }),
});
exports.ImportFunctionVersionRequestFilterSensitiveLog = ImportFunctionVersionRequestFilterSensitiveLog;
const ImportFunctionVersionResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.MigrationFunctionVersion && { MigrationFunctionVersion: (0, models_0_1.MigrationFunctionVersionFilterSensitiveLog)(obj.MigrationFunctionVersion)
    }),
});
exports.ImportFunctionVersionResponseFilterSensitiveLog = ImportFunctionVersionResponseFilterSensitiveLog;
class DurableExecutionAlreadyStartedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.DurableExecutionAlreadyStartedException = DurableExecutionAlreadyStartedException;
class EC2AccessDeniedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EC2AccessDeniedException = EC2AccessDeniedException;
class EC2ThrottledException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EC2ThrottledException = EC2ThrottledException;
class EC2UnexpectedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EC2UnexpectedException = EC2UnexpectedException;
class EFSIOException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EFSIOException = EFSIOException;
class EFSMountConnectivityException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EFSMountConnectivityException = EFSMountConnectivityException;
class EFSMountFailureException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EFSMountFailureException = EFSMountFailureException;
class EFSMountTimeoutException extends LambdaServiceException_1.LambdaServiceException {
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
exports.EFSMountTimeoutException = EFSMountTimeoutException;
class ENILimitReachedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ENILimitReachedException = ENILimitReachedException;
class InvalidRequestContentException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidRequestContentException = InvalidRequestContentException;
class InvalidRuntimeException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidRuntimeException = InvalidRuntimeException;
class InvalidSecurityGroupIDException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidSecurityGroupIDException = InvalidSecurityGroupIDException;
class InvalidSubnetIDException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidSubnetIDException = InvalidSubnetIDException;
class InvalidZipFileException extends LambdaServiceException_1.LambdaServiceException {
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
exports.InvalidZipFileException = InvalidZipFileException;
exports.InvocationType = {
    DryRun: "DryRun",
    Event: "Event",
    RequestResponse: "RequestResponse",
};
exports.LogType = {
    None: "None",
    Tail: "Tail",
};
const InvocationRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.InvocationRequestFilterSensitiveLog = InvocationRequestFilterSensitiveLog;
const InvocationResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.InvocationResponseFilterSensitiveLog = InvocationResponseFilterSensitiveLog;
class KMSAccessDeniedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.KMSAccessDeniedException = KMSAccessDeniedException;
class KMSDisabledException extends LambdaServiceException_1.LambdaServiceException {
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
exports.KMSDisabledException = KMSDisabledException;
class KMSInvalidStateException extends LambdaServiceException_1.LambdaServiceException {
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
exports.KMSInvalidStateException = KMSInvalidStateException;
class KMSNotFoundException extends LambdaServiceException_1.LambdaServiceException {
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
exports.KMSNotFoundException = KMSNotFoundException;
class ModeNotSupportedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.ModeNotSupportedException = ModeNotSupportedException;
class NoPublishedVersionException extends LambdaServiceException_1.LambdaServiceException {
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
exports.NoPublishedVersionException = NoPublishedVersionException;
class RecursiveInvocationException extends LambdaServiceException_1.LambdaServiceException {
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
exports.RecursiveInvocationException = RecursiveInvocationException;
class RequestTooLargeException extends LambdaServiceException_1.LambdaServiceException {
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
exports.RequestTooLargeException = RequestTooLargeException;
class SnapRestoreException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapRestoreException = SnapRestoreException;
class SnapRestoreTimeoutException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapRestoreTimeoutException = SnapRestoreTimeoutException;
class SnapStartException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapStartException = SnapStartException;
class SnapStartNotReadyException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapStartNotReadyException = SnapStartNotReadyException;
class SnapStartRegenerationFailureException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapStartRegenerationFailureException = SnapStartRegenerationFailureException;
class SnapStartTimeoutException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SnapStartTimeoutException = SnapStartTimeoutException;
class SubnetIPAddressLimitReachedException extends LambdaServiceException_1.LambdaServiceException {
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
exports.SubnetIPAddressLimitReachedException = SubnetIPAddressLimitReachedException;
class UnsupportedMediaTypeException extends LambdaServiceException_1.LambdaServiceException {
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
exports.UnsupportedMediaTypeException = UnsupportedMediaTypeException;
const InvokeAsyncRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.InvokeArgs && { InvokeArgs: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.InvokeAsyncRequestFilterSensitiveLog = InvokeAsyncRequestFilterSensitiveLog;
const InvokeAsyncResponseFilterSensitiveLog = (obj) => ({
    ...obj,
});
exports.InvokeAsyncResponseFilterSensitiveLog = InvokeAsyncResponseFilterSensitiveLog;
const InvokeWithResponseStreamRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.InvokeWithResponseStreamRequestFilterSensitiveLog = InvokeWithResponseStreamRequestFilterSensitiveLog;
const InvokeResponseStreamUpdateFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.InvokeResponseStreamUpdateFilterSensitiveLog = InvokeResponseStreamUpdateFilterSensitiveLog;
var InvokeWithResponseStreamResponseEvent;
(function (InvokeWithResponseStreamResponseEvent) {
    InvokeWithResponseStreamResponseEvent.visit = (value, visitor) => {
        if (value.PayloadChunk !== undefined)
            return visitor.PayloadChunk(value.PayloadChunk);
        if (value.InvokeComplete !== undefined)
            return visitor.InvokeComplete(value.InvokeComplete);
        return visitor._(value.$unknown[0], value.$unknown[1]);
    };
})(InvokeWithResponseStreamResponseEvent || (exports.InvokeWithResponseStreamResponseEvent = InvokeWithResponseStreamResponseEvent = {}));
const InvokeWithResponseStreamResponseEventFilterSensitiveLog = (obj) => {
    if (obj.PayloadChunk !== undefined)
        return { PayloadChunk: (0, exports.InvokeResponseStreamUpdateFilterSensitiveLog)(obj.PayloadChunk)
        };
    if (obj.InvokeComplete !== undefined)
        return { InvokeComplete: obj.InvokeComplete
        };
    if (obj.$unknown !== undefined)
        return { [obj.$unknown[0]]: 'UNKNOWN' };
};
exports.InvokeWithResponseStreamResponseEventFilterSensitiveLog = InvokeWithResponseStreamResponseEventFilterSensitiveLog;
const InvokeWithResponseStreamResponseFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.EventStream && { EventStream: 'STREAMING_CONTENT'
    }),
});
exports.InvokeWithResponseStreamResponseFilterSensitiveLog = InvokeWithResponseStreamResponseFilterSensitiveLog;
exports.FunctionVersion = {
    ALL: "ALL",
};
const ListFunctionsResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Functions && { Functions: obj.Functions.map(item => (0, models_0_1.FunctionConfiguration20150331FilterSensitiveLog)(item))
    }),
});
exports.ListFunctionsResponse20150331FilterSensitiveLog = ListFunctionsResponse20150331FilterSensitiveLog;
const ListVersionsByFunctionResponse20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Versions && { Versions: obj.Versions.map(item => (0, models_0_1.FunctionConfiguration20150331FilterSensitiveLog)(item))
    }),
});
exports.ListVersionsByFunctionResponse20150331FilterSensitiveLog = ListVersionsByFunctionResponse20150331FilterSensitiveLog;
const LayerVersionContentInput20181031FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.LayerVersionContentInput20181031FilterSensitiveLog = LayerVersionContentInput20181031FilterSensitiveLog;
const PublishLayerVersionRequest20181031FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Content && { Content: (0, exports.LayerVersionContentInput20181031FilterSensitiveLog)(obj.Content)
    }),
});
exports.PublishLayerVersionRequest20181031FilterSensitiveLog = PublishLayerVersionRequest20181031FilterSensitiveLog;
exports.ProvisionedConcurrencyReconciliationActionEnum = {
    MARK_PROVISIONED_CONCURRENCY_AS_FAILED: "MARK_PROVISIONED_CONCURRENCY_AS_FAILED",
    RELEASE_PROVISIONED_CONCURRENCY: "RELEASE_PROVISIONED_CONCURRENCY",
    RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION: "RELEASE_PROVISIONED_CONCURRENCY_FOR_NON_INVOCABLE_FUNCTION",
    REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS: "REVERT_PROVISIONED_CONCURRENCY_TO_READY_STATUS",
};
exports.SigningKeyType = {
    KMS: "KMS",
    POPPYSEED: "POPPYSEED",
};
class CallbackTimeoutException extends LambdaServiceException_1.LambdaServiceException {
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
exports.CallbackTimeoutException = CallbackTimeoutException;
const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, models_0_1.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = SendDurableExecutionCallbackFailureRequestFilterSensitiveLog;
const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Result && { Result: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog;
const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Error && { Error: (0, models_0_1.ErrorObjectFilterSensitiveLog)(obj.Error)
    }),
});
exports.StopDurableExecutionRequestFilterSensitiveLog = StopDurableExecutionRequestFilterSensitiveLog;
const UpdateFunctionCodeRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.FunctionZip && { FunctionZip: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.UpdateFunctionCodeRequestFilterSensitiveLog = UpdateFunctionCodeRequestFilterSensitiveLog;
const UpdateFunctionCodeRequest20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.UpdateFunctionCodeRequest20150331FilterSensitiveLog = UpdateFunctionCodeRequest20150331FilterSensitiveLog;
const UpdateFunctionConfigurationRequest20150331FilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.Environment && { Environment: (0, models_0_1.EnvironmentFilterSensitiveLog)(obj.Environment)
    }),
});
exports.UpdateFunctionConfigurationRequest20150331FilterSensitiveLog = UpdateFunctionConfigurationRequest20150331FilterSensitiveLog;
exports.ProvisionedConcurrencyStatusReasonCodeEnum = {
    RELEASE_AND_CREATE_CONFIG: "RELEASE_AND_CREATE_CONFIG",
    RESOURCE_NON_INVOCABLE: "RESOURCE_NON_INVOCABLE",
};
exports.ProvisionedConcurrencyVersionStatus = {
    DELETING: "DELETING",
    NONE: "NONE",
};
const UploadFunctionRequestFilterSensitiveLog = (obj) => ({
    ...obj,
    ...(obj.FunctionZip && { FunctionZip: smithy_client_1.SENSITIVE_STRING
    }),
});
exports.UploadFunctionRequestFilterSensitiveLog = UploadFunctionRequestFilterSensitiveLog;
