"use strict";

var middlewareHostHeader = require("@aws-sdk/middleware-host-header");
var middlewareLogger = require("@aws-sdk/middleware-logger");
var middlewareRecursionDetection = require("@aws-sdk/middleware-recursion-detection");
var middlewareUserAgent = require("@aws-sdk/middleware-user-agent");
var configResolver = require("@smithy/config-resolver");
var core = require("@smithy/core");
var eventstreamSerdeConfigResolver = require("@smithy/eventstream-serde-config-resolver");
var middlewareContentLength = require("@smithy/middleware-content-length");
var middlewareEndpoint = require("@smithy/middleware-endpoint");
var middlewareRetry = require("@smithy/middleware-retry");
var smithyClient = require("@smithy/smithy-client");
var httpAuthSchemeProvider = require("./auth/httpAuthSchemeProvider");
var runtimeConfig = require("./runtimeConfig");
var regionConfigResolver = require("@aws-sdk/region-config-resolver");
var protocolHttp = require("@smithy/protocol-http");
var middlewareSerde = require("@smithy/middleware-serde");
var core$1 = require("@aws-sdk/core");
var utilWaiter = require("@smithy/util-waiter");

const resolveClientEndpointParameters = (options) => {
  return Object.assign(options, {
    useDualstackEndpoint: options.useDualstackEndpoint ?? false,
    useFipsEndpoint: options.useFipsEndpoint ?? false,
    defaultSigningName: "lambda",
  });
};
const commonParams = {
  UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
  Endpoint: { type: "builtInParams", name: "endpoint" },
  Region: { type: "builtInParams", name: "region" },
  UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

const getHttpAuthExtensionConfiguration = (runtimeConfig) => {
  const _httpAuthSchemes = runtimeConfig.httpAuthSchemes;
  let _httpAuthSchemeProvider = runtimeConfig.httpAuthSchemeProvider;
  let _credentials = runtimeConfig.credentials;
  return {
    setHttpAuthScheme(httpAuthScheme) {
      const index = _httpAuthSchemes.findIndex(
        (scheme) => scheme.schemeId === httpAuthScheme.schemeId,
      );
      if (index === -1) {
        _httpAuthSchemes.push(httpAuthScheme);
      } else {
        _httpAuthSchemes.splice(index, 1, httpAuthScheme);
      }
    },
    httpAuthSchemes() {
      return _httpAuthSchemes;
    },
    setHttpAuthSchemeProvider(httpAuthSchemeProvider) {
      _httpAuthSchemeProvider = httpAuthSchemeProvider;
    },
    httpAuthSchemeProvider() {
      return _httpAuthSchemeProvider;
    },
    setCredentials(credentials) {
      _credentials = credentials;
    },
    credentials() {
      return _credentials;
    },
  };
};
const resolveHttpAuthRuntimeConfig = (config) => {
  return {
    httpAuthSchemes: config.httpAuthSchemes(),
    httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
    credentials: config.credentials(),
  };
};

const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
  const extensionConfiguration = Object.assign(
    regionConfigResolver.getAwsRegionExtensionConfiguration(runtimeConfig),
    smithyClient.getDefaultExtensionConfiguration(runtimeConfig),
    protocolHttp.getHttpHandlerExtensionConfiguration(runtimeConfig),
    getHttpAuthExtensionConfiguration(runtimeConfig),
  );
  extensions.forEach((extension) =>
    extension.configure(extensionConfiguration),
  );
  return Object.assign(
    runtimeConfig,
    regionConfigResolver.resolveAwsRegionExtensionConfiguration(
      extensionConfiguration,
    ),
    smithyClient.resolveDefaultRuntimeConfig(extensionConfiguration),
    protocolHttp.resolveHttpHandlerRuntimeConfig(extensionConfiguration),
    resolveHttpAuthRuntimeConfig(extensionConfiguration),
  );
};

class LambdaClient extends smithyClient.Client {
  config;
  constructor(...[configuration]) {
    const _config_0 = runtimeConfig.getRuntimeConfig(configuration || {});
    super(_config_0);
    this.initConfig = _config_0;
    const _config_1 = resolveClientEndpointParameters(_config_0);
    const _config_2 = middlewareUserAgent.resolveUserAgentConfig(_config_1);
    const _config_3 = middlewareRetry.resolveRetryConfig(_config_2);
    const _config_4 = configResolver.resolveRegionConfig(_config_3);
    const _config_5 = middlewareHostHeader.resolveHostHeaderConfig(_config_4);
    const _config_6 = middlewareEndpoint.resolveEndpointConfig(_config_5);
    const _config_7 =
      eventstreamSerdeConfigResolver.resolveEventStreamSerdeConfig(_config_6);
    const _config_8 =
      httpAuthSchemeProvider.resolveHttpAuthSchemeConfig(_config_7);
    const _config_9 = resolveRuntimeExtensions(
      _config_8,
      configuration?.extensions || [],
    );
    this.config = _config_9;
    this.middlewareStack.use(
      middlewareUserAgent.getUserAgentPlugin(this.config),
    );
    this.middlewareStack.use(middlewareRetry.getRetryPlugin(this.config));
    this.middlewareStack.use(
      middlewareContentLength.getContentLengthPlugin(this.config),
    );
    this.middlewareStack.use(
      middlewareHostHeader.getHostHeaderPlugin(this.config),
    );
    this.middlewareStack.use(middlewareLogger.getLoggerPlugin(this.config));
    this.middlewareStack.use(
      middlewareRecursionDetection.getRecursionDetectionPlugin(this.config),
    );
    this.middlewareStack.use(
      core.getHttpAuthSchemeEndpointRuleSetPlugin(this.config, {
        httpAuthSchemeParametersProvider:
          httpAuthSchemeProvider.defaultLambdaHttpAuthSchemeParametersProvider,
        identityProviderConfigProvider: async (config) =>
          new core.DefaultIdentityProviderConfig({
            "aws.auth#sigv4": config.credentials,
          }),
      }),
    );
    this.middlewareStack.use(core.getHttpSigningPlugin(this.config));
  }
  destroy() {
    super.destroy();
  }
}

class LambdaServiceException extends smithyClient.ServiceException {
  constructor(options) {
    super(options);
    Object.setPrototypeOf(this, LambdaServiceException.prototype);
  }
}

class InvalidParameterValueException extends LambdaServiceException {
  name = "InvalidParameterValueException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "InvalidParameterValueException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidParameterValueException.prototype);
    this.Type = opts.Type;
  }
}
class PolicyLengthExceededException extends LambdaServiceException {
  name = "PolicyLengthExceededException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "PolicyLengthExceededException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, PolicyLengthExceededException.prototype);
    this.Type = opts.Type;
  }
}
class PreconditionFailedException extends LambdaServiceException {
  name = "PreconditionFailedException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "PreconditionFailedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, PreconditionFailedException.prototype);
    this.Type = opts.Type;
  }
}
class ResourceConflictException extends LambdaServiceException {
  name = "ResourceConflictException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "ResourceConflictException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, ResourceConflictException.prototype);
    this.Type = opts.Type;
  }
}
class ResourceNotFoundException extends LambdaServiceException {
  name = "ResourceNotFoundException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ResourceNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, ResourceNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class ServiceException extends LambdaServiceException {
  name = "ServiceException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ServiceException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, ServiceException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
const ThrottleReason = {
  CallerRateLimitExceeded: "CallerRateLimitExceeded",
  ConcurrentInvocationLimitExceeded: "ConcurrentInvocationLimitExceeded",
  ConcurrentSnapshotCreateLimitExceeded:
    "ConcurrentSnapshotCreateLimitExceeded",
  FunctionInvocationRateLimitExceeded: "FunctionInvocationRateLimitExceeded",
  ReservedFunctionConcurrentInvocationLimitExceeded:
    "ReservedFunctionConcurrentInvocationLimitExceeded",
  ReservedFunctionInvocationRateLimitExceeded:
    "ReservedFunctionInvocationRateLimitExceeded",
};
class TooManyRequestsException extends LambdaServiceException {
  name = "TooManyRequestsException";
  $fault = "client";
  retryAfterSeconds;
  Type;
  Reason;
  constructor(opts) {
    super({
      name: "TooManyRequestsException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, TooManyRequestsException.prototype);
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.Type = opts.Type;
    this.Reason = opts.Reason;
  }
}
const FunctionUrlAuthType = {
  AWS_IAM: "AWS_IAM",
  NONE: "NONE",
};
const KafkaSchemaRegistryAuthType = {
  BASIC_AUTH: "BASIC_AUTH",
  CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
  SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
};
const SchemaRegistryEventRecordFormat = {
  JSON: "JSON",
  SOURCE: "SOURCE",
};
const KafkaSchemaValidationAttribute = {
  KEY: "KEY",
  VALUE: "VALUE",
};
const ApplicationLogLevel = {
  Debug: "DEBUG",
  Error: "ERROR",
  Fatal: "FATAL",
  Info: "INFO",
  Trace: "TRACE",
  Warn: "WARN",
};
const Architecture = {
  arm64: "arm64",
  x86_64: "x86_64",
};
const OperationAction = {
  CANCEL: "CANCEL",
  FAIL: "FAIL",
  RETRY: "RETRY",
  START: "START",
  SUCCEED: "SUCCEED",
};
const OperationType = {
  CALLBACK: "CALLBACK",
  CHAINED_INVOKE: "CHAINED_INVOKE",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  STEP: "STEP",
  WAIT: "WAIT",
};
const OperationStatus = {
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  READY: "READY",
  STARTED: "STARTED",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
const CodeSigningPolicy = {
  Enforce: "Enforce",
  Warn: "Warn",
};
const FullDocument = {
  Default: "Default",
  UpdateLookup: "UpdateLookup",
};
const FunctionResponseType = {
  ReportBatchItemFailures: "ReportBatchItemFailures",
};
const EventSourceMappingMetric = {
  EventCount: "EventCount",
};
const EndPointType = {
  KAFKA_BOOTSTRAP_SERVERS: "KAFKA_BOOTSTRAP_SERVERS",
};
const SourceAccessType = {
  BASIC_AUTH: "BASIC_AUTH",
  CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
  SASL_SCRAM_256_AUTH: "SASL_SCRAM_256_AUTH",
  SASL_SCRAM_512_AUTH: "SASL_SCRAM_512_AUTH",
  SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
  VIRTUAL_HOST: "VIRTUAL_HOST",
  VPC_SECURITY_GROUP: "VPC_SECURITY_GROUP",
  VPC_SUBNET: "VPC_SUBNET",
};
const EventSourcePosition = {
  AT_TIMESTAMP: "AT_TIMESTAMP",
  LATEST: "LATEST",
  TRIM_HORIZON: "TRIM_HORIZON",
};
class ResourceInUseException extends LambdaServiceException {
  name = "ResourceInUseException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ResourceInUseException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, ResourceInUseException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class CodeSigningConfigNotFoundException extends LambdaServiceException {
  name = "CodeSigningConfigNotFoundException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "CodeSigningConfigNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, CodeSigningConfigNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class CodeStorageExceededException extends LambdaServiceException {
  name = "CodeStorageExceededException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "CodeStorageExceededException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, CodeStorageExceededException.prototype);
    this.Type = opts.Type;
  }
}
class CodeVerificationFailedException extends LambdaServiceException {
  name = "CodeVerificationFailedException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "CodeVerificationFailedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, CodeVerificationFailedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
const LogFormat = {
  Json: "JSON",
  Text: "Text",
};
const SystemLogLevel = {
  Debug: "DEBUG",
  Info: "INFO",
  Warn: "WARN",
};
const PackageType = {
  Image: "Image",
  Zip: "Zip",
};
const Runtime = {
  dotnet6: "dotnet6",
  dotnet8: "dotnet8",
  dotnetcore10: "dotnetcore1.0",
  dotnetcore20: "dotnetcore2.0",
  dotnetcore21: "dotnetcore2.1",
  dotnetcore31: "dotnetcore3.1",
  go1x: "go1.x",
  java11: "java11",
  java17: "java17",
  java21: "java21",
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
  nodejs43: "nodejs4.3",
  nodejs43edge: "nodejs4.3-edge",
  nodejs610: "nodejs6.10",
  nodejs810: "nodejs8.10",
  provided: "provided",
  providedal2: "provided.al2",
  providedal2023: "provided.al2023",
  python27: "python2.7",
  python310: "python3.10",
  python311: "python3.11",
  python312: "python3.12",
  python313: "python3.13",
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
const SnapStartApplyOn = {
  None: "None",
  PublishedVersions: "PublishedVersions",
};
const TracingMode = {
  Active: "Active",
  PassThrough: "PassThrough",
};
const LastUpdateStatus = {
  Failed: "Failed",
  InProgress: "InProgress",
  Successful: "Successful",
};
const LastUpdateStatusReasonCode = {
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
const SnapStartOptimizationStatus = {
  Off: "Off",
  On: "On",
};
const State = {
  Active: "Active",
  Failed: "Failed",
  Inactive: "Inactive",
  Pending: "Pending",
};
const StateReasonCode = {
  Creating: "Creating",
  DisabledKMSKey: "DisabledKMSKey",
  DrainingDurableExecutions: "DrainingDurableExecutions",
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
class InvalidCodeSignatureException extends LambdaServiceException {
  name = "InvalidCodeSignatureException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "InvalidCodeSignatureException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidCodeSignatureException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
const InvokeMode = {
  BUFFERED: "BUFFERED",
  RESPONSE_STREAM: "RESPONSE_STREAM",
};
const RecursiveLoop = {
  Allow: "Allow",
  Terminate: "Terminate",
};
const UpdateRuntimeOn = {
  Auto: "Auto",
  FunctionUpdate: "FunctionUpdate",
  Manual: "Manual",
};
class DurableExecutionAlreadyStartedException extends LambdaServiceException {
  name = "DurableExecutionAlreadyStartedException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "DurableExecutionAlreadyStartedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(
      this,
      DurableExecutionAlreadyStartedException.prototype,
    );
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EC2AccessDeniedException extends LambdaServiceException {
  name = "EC2AccessDeniedException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EC2AccessDeniedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, EC2AccessDeniedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EC2ThrottledException extends LambdaServiceException {
  name = "EC2ThrottledException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EC2ThrottledException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, EC2ThrottledException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EC2UnexpectedException extends LambdaServiceException {
  name = "EC2UnexpectedException";
  $fault = "server";
  Type;
  Message;
  EC2ErrorCode;
  constructor(opts) {
    super({
      name: "EC2UnexpectedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, EC2UnexpectedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
    this.EC2ErrorCode = opts.EC2ErrorCode;
  }
}
class EFSIOException extends LambdaServiceException {
  name = "EFSIOException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EFSIOException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, EFSIOException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EFSMountConnectivityException extends LambdaServiceException {
  name = "EFSMountConnectivityException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EFSMountConnectivityException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, EFSMountConnectivityException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EFSMountFailureException extends LambdaServiceException {
  name = "EFSMountFailureException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EFSMountFailureException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, EFSMountFailureException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class EFSMountTimeoutException extends LambdaServiceException {
  name = "EFSMountTimeoutException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "EFSMountTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, EFSMountTimeoutException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class ENILimitReachedException extends LambdaServiceException {
  name = "ENILimitReachedException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "ENILimitReachedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, ENILimitReachedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class InvalidRequestContentException extends LambdaServiceException {
  name = "InvalidRequestContentException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "InvalidRequestContentException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidRequestContentException.prototype);
    this.Type = opts.Type;
  }
}
class InvalidRuntimeException extends LambdaServiceException {
  name = "InvalidRuntimeException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "InvalidRuntimeException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidRuntimeException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class InvalidSecurityGroupIDException extends LambdaServiceException {
  name = "InvalidSecurityGroupIDException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "InvalidSecurityGroupIDException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidSecurityGroupIDException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class InvalidSubnetIDException extends LambdaServiceException {
  name = "InvalidSubnetIDException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "InvalidSubnetIDException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidSubnetIDException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class InvalidZipFileException extends LambdaServiceException {
  name = "InvalidZipFileException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "InvalidZipFileException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, InvalidZipFileException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
const InvocationType = {
  DryRun: "DryRun",
  Event: "Event",
  RequestResponse: "RequestResponse",
};
const LogType = {
  None: "None",
  Tail: "Tail",
};
class KMSAccessDeniedException extends LambdaServiceException {
  name = "KMSAccessDeniedException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "KMSAccessDeniedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, KMSAccessDeniedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class KMSDisabledException extends LambdaServiceException {
  name = "KMSDisabledException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "KMSDisabledException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, KMSDisabledException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class KMSInvalidStateException extends LambdaServiceException {
  name = "KMSInvalidStateException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "KMSInvalidStateException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, KMSInvalidStateException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class KMSNotFoundException extends LambdaServiceException {
  name = "KMSNotFoundException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "KMSNotFoundException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, KMSNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class RecursiveInvocationException extends LambdaServiceException {
  name = "RecursiveInvocationException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "RecursiveInvocationException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, RecursiveInvocationException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class RequestTooLargeException extends LambdaServiceException {
  name = "RequestTooLargeException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "RequestTooLargeException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, RequestTooLargeException.prototype);
    this.Type = opts.Type;
  }
}
class ResourceNotReadyException extends LambdaServiceException {
  name = "ResourceNotReadyException";
  $fault = "server";
  Type;
  constructor(opts) {
    super({
      name: "ResourceNotReadyException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, ResourceNotReadyException.prototype);
    this.Type = opts.Type;
  }
}
class SnapStartException extends LambdaServiceException {
  name = "SnapStartException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "SnapStartException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, SnapStartException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class SnapStartNotReadyException extends LambdaServiceException {
  name = "SnapStartNotReadyException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "SnapStartNotReadyException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, SnapStartNotReadyException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class SnapStartTimeoutException extends LambdaServiceException {
  name = "SnapStartTimeoutException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "SnapStartTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, SnapStartTimeoutException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class SubnetIPAddressLimitReachedException extends LambdaServiceException {
  name = "SubnetIPAddressLimitReachedException";
  $fault = "server";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "SubnetIPAddressLimitReachedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, SubnetIPAddressLimitReachedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
class UnsupportedMediaTypeException extends LambdaServiceException {
  name = "UnsupportedMediaTypeException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "UnsupportedMediaTypeException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, UnsupportedMediaTypeException.prototype);
    this.Type = opts.Type;
  }
}
const ResponseStreamingInvocationType = {
  DryRun: "DryRun",
  RequestResponse: "RequestResponse",
};
exports.InvokeWithResponseStreamResponseEvent = void 0;
(function (InvokeWithResponseStreamResponseEvent) {
  InvokeWithResponseStreamResponseEvent.visit = (value, visitor) => {
    if (value.PayloadChunk !== undefined)
      return visitor.PayloadChunk(value.PayloadChunk);
    if (value.InvokeComplete !== undefined)
      return visitor.InvokeComplete(value.InvokeComplete);
    return visitor._(value.$unknown[0], value.$unknown[1]);
  };
})(
  exports.InvokeWithResponseStreamResponseEvent ||
    (exports.InvokeWithResponseStreamResponseEvent = {}),
);
const FunctionVersion = {
  ALL: "ALL",
};
const ProvisionedConcurrencyStatusEnum = {
  FAILED: "FAILED",
  IN_PROGRESS: "IN_PROGRESS",
  READY: "READY",
};
const ExecutionStatus = {
  FAILED: "FAILED",
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
const EventType = {
  CallbackFailed: "CallbackFailed",
  CallbackStarted: "CallbackStarted",
  CallbackSucceeded: "CallbackSucceeded",
  CallbackTimedOut: "CallbackTimedOut",
  ChainedInvokeCancelled: "ChainedInvokeCancelled",
  ChainedInvokeFailed: "ChainedInvokeFailed",
  ChainedInvokePending: "ChainedInvokePending",
  ChainedInvokeStarted: "ChainedInvokeStarted",
  ChainedInvokeSucceeded: "ChainedInvokeSucceeded",
  ChainedInvokeTimedOut: "ChainedInvokeTimedOut",
  ContextFailed: "ContextFailed",
  ContextStarted: "ContextStarted",
  ContextSucceeded: "ContextSucceeded",
  ExecutionFailed: "ExecutionFailed",
  ExecutionStarted: "ExecutionStarted",
  ExecutionStopped: "ExecutionStopped",
  ExecutionSucceeded: "ExecutionSucceeded",
  ExecutionTimedOut: "ExecutionTimedOut",
  InvocationCompleted: "InvocationCompleted",
  StepFailed: "StepFailed",
  StepStarted: "StepStarted",
  StepSucceeded: "StepSucceeded",
  WaitCancelled: "WaitCancelled",
  WaitStarted: "WaitStarted",
  WaitSucceeded: "WaitSucceeded",
};
class ProvisionedConcurrencyConfigNotFoundException extends LambdaServiceException {
  name = "ProvisionedConcurrencyConfigNotFoundException";
  $fault = "client";
  Type;
  constructor(opts) {
    super({
      name: "ProvisionedConcurrencyConfigNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(
      this,
      ProvisionedConcurrencyConfigNotFoundException.prototype,
    );
    this.Type = opts.Type;
  }
}
class CallbackTimeoutException extends LambdaServiceException {
  name = "CallbackTimeoutException";
  $fault = "client";
  Type;
  Message;
  constructor(opts) {
    super({
      name: "CallbackTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, CallbackTimeoutException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
}
const ErrorObjectFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ErrorMessage && { ErrorMessage: smithyClient.SENSITIVE_STRING }),
  ...(obj.ErrorType && { ErrorType: smithyClient.SENSITIVE_STRING }),
  ...(obj.ErrorData && { ErrorData: smithyClient.SENSITIVE_STRING }),
  ...(obj.StackTrace && { StackTrace: smithyClient.SENSITIVE_STRING }),
});
const OperationUpdateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const CheckpointDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Updates && {
    Updates: obj.Updates.map((item) => OperationUpdateFilterSensitiveLog(item)),
  }),
});
const CallbackDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const ChainedInvokeDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const ContextDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const ExecutionDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: smithyClient.SENSITIVE_STRING }),
});
const StepDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const OperationFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionDetails && {
    ExecutionDetails: ExecutionDetailsFilterSensitiveLog(obj.ExecutionDetails),
  }),
  ...(obj.ContextDetails && {
    ContextDetails: ContextDetailsFilterSensitiveLog(obj.ContextDetails),
  }),
  ...(obj.StepDetails && {
    StepDetails: StepDetailsFilterSensitiveLog(obj.StepDetails),
  }),
  ...(obj.CallbackDetails && {
    CallbackDetails: CallbackDetailsFilterSensitiveLog(obj.CallbackDetails),
  }),
  ...(obj.ChainedInvokeDetails && {
    ChainedInvokeDetails: ChainedInvokeDetailsFilterSensitiveLog(
      obj.ChainedInvokeDetails,
    ),
  }),
});
const CheckpointUpdatedExecutionStateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) => OperationFilterSensitiveLog(item)),
  }),
});
const CheckpointDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.NewExecutionState && {
    NewExecutionState: CheckpointUpdatedExecutionStateFilterSensitiveLog(
      obj.NewExecutionState,
    ),
  }),
});
const FunctionCodeFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ZipFile && { ZipFile: smithyClient.SENSITIVE_STRING }),
});
const EnvironmentFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Variables && { Variables: smithyClient.SENSITIVE_STRING }),
});
const CreateFunctionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Code && { Code: FunctionCodeFilterSensitiveLog(obj.Code) }),
  ...(obj.Environment && {
    Environment: EnvironmentFilterSensitiveLog(obj.Environment),
  }),
});
const EnvironmentErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Message && { Message: smithyClient.SENSITIVE_STRING }),
});
const EnvironmentResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Variables && { Variables: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: EnvironmentErrorFilterSensitiveLog(obj.Error) }),
});
const ImageConfigErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Message && { Message: smithyClient.SENSITIVE_STRING }),
});
const ImageConfigResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: ImageConfigErrorFilterSensitiveLog(obj.Error) }),
});
const RuntimeVersionErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Message && { Message: smithyClient.SENSITIVE_STRING }),
});
const RuntimeVersionConfigFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: RuntimeVersionErrorFilterSensitiveLog(obj.Error) }),
});
const FunctionConfigurationFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Environment && {
    Environment: EnvironmentResponseFilterSensitiveLog(obj.Environment),
  }),
  ...(obj.ImageConfigResponse && {
    ImageConfigResponse: ImageConfigResponseFilterSensitiveLog(
      obj.ImageConfigResponse,
    ),
  }),
  ...(obj.RuntimeVersionConfig && {
    RuntimeVersionConfig: RuntimeVersionConfigFilterSensitiveLog(
      obj.RuntimeVersionConfig,
    ),
  }),
});
const GetFunctionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Configuration && {
    Configuration: FunctionConfigurationFilterSensitiveLog(obj.Configuration),
  }),
});
const InvocationRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const InvocationResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const InvokeAsyncRequestFilterSensitiveLog = (obj) => ({
  ...obj,
});
const InvokeWithResponseStreamRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const InvokeResponseStreamUpdateFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const InvokeWithResponseStreamResponseEventFilterSensitiveLog = (obj) => {
  if (obj.PayloadChunk !== undefined)
    return {
      PayloadChunk: InvokeResponseStreamUpdateFilterSensitiveLog(
        obj.PayloadChunk,
      ),
    };
  if (obj.InvokeComplete !== undefined)
    return { InvokeComplete: obj.InvokeComplete };
  if (obj.$unknown !== undefined) return { [obj.$unknown[0]]: "UNKNOWN" };
};
const InvokeWithResponseStreamResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.EventStream && { EventStream: "STREAMING_CONTENT" }),
});
const ListFunctionsResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Functions && {
    Functions: obj.Functions.map((item) =>
      FunctionConfigurationFilterSensitiveLog(item),
    ),
  }),
});
const UpdateFunctionCodeRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ZipFile && { ZipFile: smithyClient.SENSITIVE_STRING }),
});
const UpdateFunctionConfigurationRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Environment && {
    Environment: EnvironmentFilterSensitiveLog(obj.Environment),
  }),
});
const ListVersionsByFunctionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Versions && {
    Versions: obj.Versions.map((item) =>
      FunctionConfigurationFilterSensitiveLog(item),
    ),
  }),
});
const GetDurableExecutionResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.InputPayload && { InputPayload: smithyClient.SENSITIVE_STRING }),
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const EventErrorFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: ErrorObjectFilterSensitiveLog(obj.Payload) }),
});
const CallbackFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const EventResultFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const CallbackSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
const CallbackTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ChainedInvokeFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const EventInputFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Payload && { Payload: smithyClient.SENSITIVE_STRING }),
});
const ChainedInvokePendingDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
});
const ChainedInvokeStoppedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ChainedInvokeSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
const ChainedInvokeTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ContextFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ContextSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
const ExecutionFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ExecutionStartedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
});
const ExecutionStoppedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const ExecutionSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
const ExecutionTimedOutDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const InvocationCompletedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const StepFailedDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const StepSucceededDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
});
const WaitCancelledDetailsFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
});
const EventFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ExecutionStartedDetails && {
    ExecutionStartedDetails: ExecutionStartedDetailsFilterSensitiveLog(
      obj.ExecutionStartedDetails,
    ),
  }),
  ...(obj.ExecutionSucceededDetails && {
    ExecutionSucceededDetails: ExecutionSucceededDetailsFilterSensitiveLog(
      obj.ExecutionSucceededDetails,
    ),
  }),
  ...(obj.ExecutionFailedDetails && {
    ExecutionFailedDetails: ExecutionFailedDetailsFilterSensitiveLog(
      obj.ExecutionFailedDetails,
    ),
  }),
  ...(obj.ExecutionTimedOutDetails && {
    ExecutionTimedOutDetails: ExecutionTimedOutDetailsFilterSensitiveLog(
      obj.ExecutionTimedOutDetails,
    ),
  }),
  ...(obj.ExecutionStoppedDetails && {
    ExecutionStoppedDetails: ExecutionStoppedDetailsFilterSensitiveLog(
      obj.ExecutionStoppedDetails,
    ),
  }),
  ...(obj.ContextSucceededDetails && {
    ContextSucceededDetails: ContextSucceededDetailsFilterSensitiveLog(
      obj.ContextSucceededDetails,
    ),
  }),
  ...(obj.ContextFailedDetails && {
    ContextFailedDetails: ContextFailedDetailsFilterSensitiveLog(
      obj.ContextFailedDetails,
    ),
  }),
  ...(obj.WaitCancelledDetails && {
    WaitCancelledDetails: WaitCancelledDetailsFilterSensitiveLog(
      obj.WaitCancelledDetails,
    ),
  }),
  ...(obj.StepSucceededDetails && {
    StepSucceededDetails: StepSucceededDetailsFilterSensitiveLog(
      obj.StepSucceededDetails,
    ),
  }),
  ...(obj.StepFailedDetails && {
    StepFailedDetails: StepFailedDetailsFilterSensitiveLog(
      obj.StepFailedDetails,
    ),
  }),
  ...(obj.ChainedInvokePendingDetails && {
    ChainedInvokePendingDetails: ChainedInvokePendingDetailsFilterSensitiveLog(
      obj.ChainedInvokePendingDetails,
    ),
  }),
  ...(obj.ChainedInvokeSucceededDetails && {
    ChainedInvokeSucceededDetails:
      ChainedInvokeSucceededDetailsFilterSensitiveLog(
        obj.ChainedInvokeSucceededDetails,
      ),
  }),
  ...(obj.ChainedInvokeFailedDetails && {
    ChainedInvokeFailedDetails: ChainedInvokeFailedDetailsFilterSensitiveLog(
      obj.ChainedInvokeFailedDetails,
    ),
  }),
  ...(obj.ChainedInvokeTimedOutDetails && {
    ChainedInvokeTimedOutDetails:
      ChainedInvokeTimedOutDetailsFilterSensitiveLog(
        obj.ChainedInvokeTimedOutDetails,
      ),
  }),
  ...(obj.ChainedInvokeStoppedDetails && {
    ChainedInvokeStoppedDetails: ChainedInvokeStoppedDetailsFilterSensitiveLog(
      obj.ChainedInvokeStoppedDetails,
    ),
  }),
  ...(obj.CallbackSucceededDetails && {
    CallbackSucceededDetails: CallbackSucceededDetailsFilterSensitiveLog(
      obj.CallbackSucceededDetails,
    ),
  }),
  ...(obj.CallbackFailedDetails && {
    CallbackFailedDetails: CallbackFailedDetailsFilterSensitiveLog(
      obj.CallbackFailedDetails,
    ),
  }),
  ...(obj.CallbackTimedOutDetails && {
    CallbackTimedOutDetails: CallbackTimedOutDetailsFilterSensitiveLog(
      obj.CallbackTimedOutDetails,
    ),
  }),
  ...(obj.InvocationCompletedDetails && {
    InvocationCompletedDetails: InvocationCompletedDetailsFilterSensitiveLog(
      obj.InvocationCompletedDetails,
    ),
  }),
});
const GetDurableExecutionHistoryResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Events && {
    Events: obj.Events.map((item) => EventFilterSensitiveLog(item)),
  }),
});
const GetDurableExecutionStateResponseFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Operations && {
    Operations: obj.Operations.map((item) => OperationFilterSensitiveLog(item)),
  }),
});
const LayerVersionContentInputFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.ZipFile && { ZipFile: smithyClient.SENSITIVE_STRING }),
});
const PublishLayerVersionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Content && {
    Content: LayerVersionContentInputFilterSensitiveLog(obj.Content),
  }),
});

const se_AddLayerVersionPermissionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  b.p(
    "VersionNumber",
    () => input.VersionNumber.toString(),
    "{VersionNumber}",
    false,
  );
  const query = smithyClient.map({
    [_RI]: [, input[_RI]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Action: [],
      OrganizationId: [],
      Principal: [],
      StatementId: [],
    }),
  );
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_AddPermissionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/policy");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Action: [],
      EventSourceToken: [],
      FunctionUrlAuthType: [],
      Principal: [],
      PrincipalOrgID: [],
      RevisionId: [],
      SourceAccount: [],
      SourceArn: [],
      StatementId: [],
    }),
  );
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_CheckpointDurableExecutionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/checkpoint");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      CheckpointToken: [],
      ClientToken: [],
      Updates: (_) => smithyClient._json(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_CreateAliasCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/aliases");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Description: [],
      FunctionVersion: [],
      Name: [],
      RoutingConfig: (_) => se_AliasRoutingConfiguration(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_CreateCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2020-04-22/code-signing-configs");
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AllowedPublishers: (_) => smithyClient._json(_),
      CodeSigningPolicies: (_) => smithyClient._json(_),
      Description: [],
      Tags: (_) => smithyClient._json(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_CreateEventSourceMappingCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/event-source-mappings");
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AmazonManagedKafkaEventSourceConfig: (_) => smithyClient._json(_),
      BatchSize: [],
      BisectBatchOnFunctionError: [],
      DestinationConfig: (_) => smithyClient._json(_),
      DocumentDBEventSourceConfig: (_) => smithyClient._json(_),
      Enabled: [],
      EventSourceArn: [],
      FilterCriteria: (_) => smithyClient._json(_),
      FunctionName: [],
      FunctionResponseTypes: (_) => smithyClient._json(_),
      KMSKeyArn: [],
      MaximumBatchingWindowInSeconds: [],
      MaximumRecordAgeInSeconds: [],
      MaximumRetryAttempts: [],
      MetricsConfig: (_) => smithyClient._json(_),
      ParallelizationFactor: [],
      ProvisionedPollerConfig: (_) => smithyClient._json(_),
      Queues: (_) => smithyClient._json(_),
      ScalingConfig: (_) => smithyClient._json(_),
      SelfManagedEventSource: (_) => smithyClient._json(_),
      SelfManagedKafkaEventSourceConfig: (_) => smithyClient._json(_),
      SourceAccessConfigurations: (_) => smithyClient._json(_),
      StartingPosition: [],
      StartingPositionTimestamp: (_) => _.getTime() / 1_000,
      Tags: (_) => smithyClient._json(_),
      Topics: (_) => smithyClient._json(_),
      TumblingWindowInSeconds: [],
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_CreateFunctionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions");
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Architectures: (_) => smithyClient._json(_),
      Code: (_) => se_FunctionCode(_, context),
      CodeSigningConfigArn: [],
      DeadLetterConfig: (_) => smithyClient._json(_),
      Description: [],
      DurableConfig: (_) => smithyClient._json(_),
      Environment: (_) => smithyClient._json(_),
      EphemeralStorage: (_) => smithyClient._json(_),
      FileSystemConfigs: (_) => smithyClient._json(_),
      FunctionName: [],
      Handler: [],
      ImageConfig: (_) => smithyClient._json(_),
      KMSKeyArn: [],
      Layers: (_) => smithyClient._json(_),
      LoggingConfig: (_) => smithyClient._json(_),
      MemorySize: [],
      PackageType: [],
      Publish: [],
      Role: [],
      Runtime: [],
      SnapStart: (_) => smithyClient._json(_),
      Tags: (_) => smithyClient._json(_),
      Timeout: [],
      TracingConfig: (_) => smithyClient._json(_),
      VpcConfig: (_) => smithyClient._json(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_CreateFunctionUrlConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2021-10-31/functions/{FunctionName}/url");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AuthType: [],
      Cors: (_) => smithyClient._json(_),
      InvokeMode: [],
    }),
  );
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_DeleteAliasCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
  b.p(
    "CodeSigningConfigArn",
    () => input.CodeSigningConfigArn,
    "{CodeSigningConfigArn}",
    false,
  );
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteEventSourceMappingCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/event-source-mappings/{UUID}");
  b.p("UUID", () => input.UUID, "{UUID}", false);
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteFunctionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_DeleteFunctionCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteFunctionConcurrencyCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteFunctionEventInvokeConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_DeleteFunctionUrlConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2021-10-31/functions/{FunctionName}/url");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_DeleteLayerVersionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  b.p(
    "VersionNumber",
    () => input.VersionNumber.toString(),
    "{VersionNumber}",
    false,
  );
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
};
const se_DeleteProvisionedConcurrencyConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, smithyClient.expectNonNull(input[_Q], `Qualifier`)],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_GetAccountSettingsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2016-08-19/account-settings");
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetAliasCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
  b.p(
    "CodeSigningConfigArn",
    () => input.CodeSigningConfigArn,
    "{CodeSigningConfigArn}",
    false,
  );
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetDurableExecutionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetDurableExecutionHistoryCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  const query = smithyClient.map({
    [_IED]: [
      () => input.IncludeExecutionData !== void 0,
      () => input[_IED].toString(),
    ],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    [_M]: [, input[_M]],
    [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetDurableExecutionStateCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/state");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  const query = smithyClient.map({
    [_CT]: [, smithyClient.expectNonNull(input[_CT], `CheckpointToken`)],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetEventSourceMappingCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/event-source-mappings/{UUID}");
  b.p("UUID", () => input.UUID, "{UUID}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetFunctionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetFunctionCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetFunctionConcurrencyCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-30/functions/{FunctionName}/concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetFunctionConfigurationCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/configuration");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetFunctionEventInvokeConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetFunctionRecursionConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetFunctionUrlConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2021-10-31/functions/{FunctionName}/url");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetLayerVersionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  b.p(
    "VersionNumber",
    () => input.VersionNumber.toString(),
    "{VersionNumber}",
    false,
  );
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetLayerVersionByArnCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers");
  const query = smithyClient.map({
    [_f]: [, "LayerVersion"],
    [_A]: [, smithyClient.expectNonNull(input[_A], `Arn`)],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetLayerVersionPolicyCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  b.p(
    "VersionNumber",
    () => input.VersionNumber.toString(),
    "{VersionNumber}",
    false,
  );
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_GetPolicyCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/policy");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetProvisionedConcurrencyConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, smithyClient.expectNonNull(input[_Q], `Qualifier`)],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_GetRuntimeManagementConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_InvokeCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = smithyClient.map({}, smithyClient.isSerializableHeaderValue, {
    "content-type": "application/octet-stream",
    [_xait]: input[_IT],
    [_xalt]: input[_LT],
    [_xacc]: input[_CC],
    [_xaden]: input[_DEN],
  });
  b.bp("/2015-03-31/functions/{FunctionName}/invocations");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  if (input.Payload !== undefined) {
    body = input.Payload;
  }
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_InvokeAsyncCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/octet-stream",
  };
  b.bp("/2014-11-13/functions/{FunctionName}/invoke-async");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  if (input.InvokeArgs !== undefined) {
    body = input.InvokeArgs;
  }
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_InvokeWithResponseStreamCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = smithyClient.map({}, smithyClient.isSerializableHeaderValue, {
    "content-type": "application/octet-stream",
    [_xait]: input[_IT],
    [_xalt]: input[_LT],
    [_xacc]: input[_CC],
  });
  b.bp("/2021-11-15/functions/{FunctionName}/response-streaming-invocations");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  if (input.Payload !== undefined) {
    body = input.Payload;
  }
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_ListAliasesCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_FV]: [, input[_FV]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListCodeSigningConfigsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-04-22/code-signing-configs");
  const query = smithyClient.map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListDurableExecutionsByFunctionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2025-12-01/functions/{FunctionName}/durable-executions");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
    [_DEN]: [, input[_DEN]],
    [_S]: [() => input.Statuses !== void 0, () => input[_S] || []],
    [_SA]: [
      () => input.StartedAfter !== void 0,
      () => smithyClient.serializeDateTime(input[_SA]).toString(),
    ],
    [_SB]: [
      () => input.StartedBefore !== void 0,
      () => smithyClient.serializeDateTime(input[_SB]).toString(),
    ],
    [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListEventSourceMappingsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/event-source-mappings");
  const query = smithyClient.map({
    [_ESA]: [, input[_ESA]],
    [_FN]: [, input[_FN]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListFunctionEventInvokeConfigsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config/list");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListFunctionsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions");
  const query = smithyClient.map({
    [_MR]: [, input[_MR]],
    [_FV]: [, input[_FV]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListFunctionsByCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}/functions");
  b.p(
    "CodeSigningConfigArn",
    () => input.CodeSigningConfigArn,
    "{CodeSigningConfigArn}",
    false,
  );
  const query = smithyClient.map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListFunctionUrlConfigsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2021-10-31/functions/{FunctionName}/urls");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListLayersCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers");
  const query = smithyClient.map({
    [_CR]: [, input[_CR]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    [_CA]: [, input[_CA]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListLayerVersionsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers/{LayerName}/versions");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  const query = smithyClient.map({
    [_CR]: [, input[_CR]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    [_CA]: [, input[_CA]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListProvisionedConcurrencyConfigsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_L]: [, "ALL"],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_ListTagsCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
};
const se_ListVersionsByFunctionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/versions");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
};
const se_PublishLayerVersionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2018-10-31/layers/{LayerName}/versions");
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      CompatibleArchitectures: (_) => smithyClient._json(_),
      CompatibleRuntimes: (_) => smithyClient._json(_),
      Content: (_) => se_LayerVersionContentInput(_, context),
      Description: [],
      LicenseInfo: [],
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_PublishVersionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/versions");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      CodeSha256: [],
      Description: [],
      RevisionId: [],
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_PutFunctionCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      CodeSigningConfigArn: [],
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_PutFunctionConcurrencyCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      ReservedConcurrentExecutions: [],
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_PutFunctionEventInvokeConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      DestinationConfig: (_) => smithyClient._json(_),
      MaximumEventAgeInSeconds: [],
      MaximumRetryAttempts: [],
    }),
  );
  b.m("PUT").h(headers).q(query).b(body);
  return b.build();
};
const se_PutFunctionRecursionConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      RecursiveLoop: [],
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_PutProvisionedConcurrencyConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, smithyClient.expectNonNull(input[_Q], `Qualifier`)],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      ProvisionedConcurrentExecutions: [],
    }),
  );
  b.m("PUT").h(headers).q(query).b(body);
  return b.build();
};
const se_PutRuntimeManagementConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      RuntimeVersionArn: [],
      UpdateRuntimeOn: [],
    }),
  );
  b.m("PUT").h(headers).q(query).b(body);
  return b.build();
};
const se_RemoveLayerVersionPermissionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp(
    "/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy/{StatementId}",
  );
  b.p("LayerName", () => input.LayerName, "{LayerName}", false);
  b.p(
    "VersionNumber",
    () => input.VersionNumber.toString(),
    "{VersionNumber}",
    false,
  );
  b.p("StatementId", () => input.StatementId, "{StatementId}", false);
  const query = smithyClient.map({
    [_RI]: [, input[_RI]],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_RemovePermissionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/policy/{StatementId}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("StatementId", () => input.StatementId, "{StatementId}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
    [_RI]: [, input[_RI]],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_SendDurableExecutionCallbackFailureCommand = async (
  input,
  context,
) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  if (input.Error !== undefined) {
    body = smithyClient._json(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_SendDurableExecutionCallbackHeartbeatCommand = async (
  input,
  context,
) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_SendDurableExecutionCallbackSuccessCommand = async (
  input,
  context,
) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/octet-stream",
  };
  b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/succeed");
  b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
  let body;
  if (input.Result !== undefined) {
    body = input.Result;
  }
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_StopDurableExecutionCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/stop");
  b.p(
    "DurableExecutionArn",
    () => input.DurableExecutionArn,
    "{DurableExecutionArn}",
    false,
  );
  let body;
  if (input.Error !== undefined) {
    body = smithyClient._json(input.Error);
  }
  if (body === undefined) {
    body = {};
  }
  body = JSON.stringify(body);
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_TagResourceCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Tags: (_) => smithyClient._json(_),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
};
const se_UntagResourceCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {};
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  const query = smithyClient.map({
    [_tK]: [
      smithyClient.expectNonNull(input.TagKeys, `TagKeys`) != null,
      () => input[_TK] || [],
    ],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
};
const se_UpdateAliasCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Description: [],
      FunctionVersion: [],
      RevisionId: [],
      RoutingConfig: (_) => se_AliasRoutingConfiguration(_),
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_UpdateCodeSigningConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
  b.p(
    "CodeSigningConfigArn",
    () => input.CodeSigningConfigArn,
    "{CodeSigningConfigArn}",
    false,
  );
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AllowedPublishers: (_) => smithyClient._json(_),
      CodeSigningPolicies: (_) => smithyClient._json(_),
      Description: [],
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_UpdateEventSourceMappingCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/event-source-mappings/{UUID}");
  b.p("UUID", () => input.UUID, "{UUID}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AmazonManagedKafkaEventSourceConfig: (_) => smithyClient._json(_),
      BatchSize: [],
      BisectBatchOnFunctionError: [],
      DestinationConfig: (_) => smithyClient._json(_),
      DocumentDBEventSourceConfig: (_) => smithyClient._json(_),
      Enabled: [],
      FilterCriteria: (_) => smithyClient._json(_),
      FunctionName: [],
      FunctionResponseTypes: (_) => smithyClient._json(_),
      KMSKeyArn: [],
      MaximumBatchingWindowInSeconds: [],
      MaximumRecordAgeInSeconds: [],
      MaximumRetryAttempts: [],
      MetricsConfig: (_) => smithyClient._json(_),
      ParallelizationFactor: [],
      ProvisionedPollerConfig: (_) => smithyClient._json(_),
      ScalingConfig: (_) => smithyClient._json(_),
      SelfManagedKafkaEventSourceConfig: (_) => smithyClient._json(_),
      SourceAccessConfigurations: (_) => smithyClient._json(_),
      TumblingWindowInSeconds: [],
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_UpdateFunctionCodeCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/code");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      Architectures: (_) => smithyClient._json(_),
      DryRun: [],
      ImageUri: [],
      Publish: [],
      RevisionId: [],
      S3Bucket: [],
      S3Key: [],
      S3ObjectVersion: [],
      SourceKMSKeyArn: [],
      ZipFile: (_) => context.base64Encoder(_),
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_UpdateFunctionConfigurationCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/configuration");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      DeadLetterConfig: (_) => smithyClient._json(_),
      Description: [],
      DurableConfig: (_) => smithyClient._json(_),
      Environment: (_) => smithyClient._json(_),
      EphemeralStorage: (_) => smithyClient._json(_),
      FileSystemConfigs: (_) => smithyClient._json(_),
      Handler: [],
      ImageConfig: (_) => smithyClient._json(_),
      KMSKeyArn: [],
      Layers: (_) => smithyClient._json(_),
      LoggingConfig: (_) => smithyClient._json(_),
      MemorySize: [],
      RevisionId: [],
      Role: [],
      Runtime: [],
      SnapStart: (_) => smithyClient._json(_),
      Timeout: [],
      TracingConfig: (_) => smithyClient._json(_),
      VpcConfig: (_) => smithyClient._json(_),
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
};
const se_UpdateFunctionEventInvokeConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      DestinationConfig: (_) => smithyClient._json(_),
      MaximumEventAgeInSeconds: [],
      MaximumRetryAttempts: [],
    }),
  );
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
};
const se_UpdateFunctionUrlConfigCommand = async (input, context) => {
  const b = core.requestBuilder(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2021-10-31/functions/{FunctionName}/url");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = smithyClient.map({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    smithyClient.take(input, {
      AuthType: [],
      Cors: (_) => smithyClient._json(_),
      InvokeMode: [],
    }),
  );
  b.m("PUT").h(headers).q(query).b(body);
  return b.build();
};
const de_AddLayerVersionPermissionCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    RevisionId: smithyClient.expectString,
    Statement: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_AddPermissionCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Statement: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CheckpointDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CheckpointToken: smithyClient.expectString,
    NewExecutionState: (_) => de_CheckpointUpdatedExecutionState(_),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CreateAliasCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AliasArn: smithyClient.expectString,
    Description: smithyClient.expectString,
    FunctionVersion: smithyClient.expectString,
    Name: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    RoutingConfig: (_) => de_AliasRoutingConfiguration(_),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CreateCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CreateEventSourceMappingCommand = async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AmazonManagedKafkaEventSourceConfig: smithyClient._json,
    BatchSize: smithyClient.expectInt32,
    BisectBatchOnFunctionError: smithyClient.expectBoolean,
    DestinationConfig: smithyClient._json,
    DocumentDBEventSourceConfig: smithyClient._json,
    EventSourceArn: smithyClient.expectString,
    EventSourceMappingArn: smithyClient.expectString,
    FilterCriteria: smithyClient._json,
    FilterCriteriaError: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionResponseTypes: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    LastProcessingResult: smithyClient.expectString,
    MaximumBatchingWindowInSeconds: smithyClient.expectInt32,
    MaximumRecordAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
    MetricsConfig: smithyClient._json,
    ParallelizationFactor: smithyClient.expectInt32,
    ProvisionedPollerConfig: smithyClient._json,
    Queues: smithyClient._json,
    ScalingConfig: smithyClient._json,
    SelfManagedEventSource: smithyClient._json,
    SelfManagedKafkaEventSourceConfig: smithyClient._json,
    SourceAccessConfigurations: smithyClient._json,
    StartingPosition: smithyClient.expectString,
    StartingPositionTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    State: smithyClient.expectString,
    StateTransitionReason: smithyClient.expectString,
    Topics: smithyClient._json,
    TumblingWindowInSeconds: smithyClient.expectInt32,
    UUID: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CreateFunctionCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Architectures: smithyClient._json,
    CodeSha256: smithyClient.expectString,
    CodeSize: smithyClient.expectLong,
    DeadLetterConfig: smithyClient._json,
    Description: smithyClient.expectString,
    DurableConfig: smithyClient._json,
    Environment: smithyClient._json,
    EphemeralStorage: smithyClient._json,
    FileSystemConfigs: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
    Handler: smithyClient.expectString,
    ImageConfigResponse: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: smithyClient.expectString,
    LastUpdateStatus: smithyClient.expectString,
    LastUpdateStatusReason: smithyClient.expectString,
    LastUpdateStatusReasonCode: smithyClient.expectString,
    Layers: smithyClient._json,
    LoggingConfig: smithyClient._json,
    MasterArn: smithyClient.expectString,
    MemorySize: smithyClient.expectInt32,
    PackageType: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    Role: smithyClient.expectString,
    Runtime: smithyClient.expectString,
    RuntimeVersionConfig: smithyClient._json,
    SigningJobArn: smithyClient.expectString,
    SigningProfileVersionArn: smithyClient.expectString,
    SnapStart: smithyClient._json,
    State: smithyClient.expectString,
    StateReason: smithyClient.expectString,
    StateReasonCode: smithyClient.expectString,
    Timeout: smithyClient.expectInt32,
    TracingConfig: smithyClient._json,
    Version: smithyClient.expectString,
    VpcConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CreateFunctionUrlConfigCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AuthType: smithyClient.expectString,
    Cors: smithyClient._json,
    CreationTime: smithyClient.expectString,
    FunctionArn: smithyClient.expectString,
    FunctionUrl: smithyClient.expectString,
    InvokeMode: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_DeleteAliasCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteEventSourceMappingCommand = async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AmazonManagedKafkaEventSourceConfig: smithyClient._json,
    BatchSize: smithyClient.expectInt32,
    BisectBatchOnFunctionError: smithyClient.expectBoolean,
    DestinationConfig: smithyClient._json,
    DocumentDBEventSourceConfig: smithyClient._json,
    EventSourceArn: smithyClient.expectString,
    EventSourceMappingArn: smithyClient.expectString,
    FilterCriteria: smithyClient._json,
    FilterCriteriaError: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionResponseTypes: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    LastProcessingResult: smithyClient.expectString,
    MaximumBatchingWindowInSeconds: smithyClient.expectInt32,
    MaximumRecordAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
    MetricsConfig: smithyClient._json,
    ParallelizationFactor: smithyClient.expectInt32,
    ProvisionedPollerConfig: smithyClient._json,
    Queues: smithyClient._json,
    ScalingConfig: smithyClient._json,
    SelfManagedEventSource: smithyClient._json,
    SelfManagedKafkaEventSourceConfig: smithyClient._json,
    SourceAccessConfigurations: smithyClient._json,
    StartingPosition: smithyClient.expectString,
    StartingPositionTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    State: smithyClient.expectString,
    StateTransitionReason: smithyClient.expectString,
    Topics: smithyClient._json,
    TumblingWindowInSeconds: smithyClient.expectInt32,
    UUID: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_DeleteFunctionCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteFunctionCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteFunctionConcurrencyCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteFunctionEventInvokeConfigCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteFunctionUrlConfigCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteLayerVersionCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_DeleteProvisionedConcurrencyConfigCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_GetAccountSettingsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AccountLimit: smithyClient._json,
    AccountUsage: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetAliasCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AliasArn: smithyClient.expectString,
    Description: smithyClient.expectString,
    FunctionVersion: smithyClient.expectString,
    Name: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    RoutingConfig: (_) => de_AliasRoutingConfiguration(_),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    DurableExecutionArn: smithyClient.expectString,
    DurableExecutionName: smithyClient.expectString,
    EndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Error: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    InputPayload: smithyClient.expectString,
    Result: smithyClient.expectString,
    StartTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Status: smithyClient.expectString,
    Version: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetDurableExecutionHistoryCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Events: (_) => de_Events(_),
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetDurableExecutionStateCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    NextMarker: smithyClient.expectString,
    Operations: (_) => de_Operations(_),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetEventSourceMappingCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AmazonManagedKafkaEventSourceConfig: smithyClient._json,
    BatchSize: smithyClient.expectInt32,
    BisectBatchOnFunctionError: smithyClient.expectBoolean,
    DestinationConfig: smithyClient._json,
    DocumentDBEventSourceConfig: smithyClient._json,
    EventSourceArn: smithyClient.expectString,
    EventSourceMappingArn: smithyClient.expectString,
    FilterCriteria: smithyClient._json,
    FilterCriteriaError: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionResponseTypes: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    LastProcessingResult: smithyClient.expectString,
    MaximumBatchingWindowInSeconds: smithyClient.expectInt32,
    MaximumRecordAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
    MetricsConfig: smithyClient._json,
    ParallelizationFactor: smithyClient.expectInt32,
    ProvisionedPollerConfig: smithyClient._json,
    Queues: smithyClient._json,
    ScalingConfig: smithyClient._json,
    SelfManagedEventSource: smithyClient._json,
    SelfManagedKafkaEventSourceConfig: smithyClient._json,
    SourceAccessConfigurations: smithyClient._json,
    StartingPosition: smithyClient.expectString,
    StartingPositionTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    State: smithyClient.expectString,
    StateTransitionReason: smithyClient.expectString,
    Topics: smithyClient._json,
    TumblingWindowInSeconds: smithyClient.expectInt32,
    UUID: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Code: smithyClient._json,
    Concurrency: smithyClient._json,
    Configuration: smithyClient._json,
    Tags: smithyClient._json,
    TagsError: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfigArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionConcurrencyCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    ReservedConcurrentExecutions: smithyClient.expectInt32,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionConfigurationCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Architectures: smithyClient._json,
    CodeSha256: smithyClient.expectString,
    CodeSize: smithyClient.expectLong,
    DeadLetterConfig: smithyClient._json,
    Description: smithyClient.expectString,
    DurableConfig: smithyClient._json,
    Environment: smithyClient._json,
    EphemeralStorage: smithyClient._json,
    FileSystemConfigs: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
    Handler: smithyClient.expectString,
    ImageConfigResponse: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: smithyClient.expectString,
    LastUpdateStatus: smithyClient.expectString,
    LastUpdateStatusReason: smithyClient.expectString,
    LastUpdateStatusReasonCode: smithyClient.expectString,
    Layers: smithyClient._json,
    LoggingConfig: smithyClient._json,
    MasterArn: smithyClient.expectString,
    MemorySize: smithyClient.expectInt32,
    PackageType: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    Role: smithyClient.expectString,
    Runtime: smithyClient.expectString,
    RuntimeVersionConfig: smithyClient._json,
    SigningJobArn: smithyClient.expectString,
    SigningProfileVersionArn: smithyClient.expectString,
    SnapStart: smithyClient._json,
    State: smithyClient.expectString,
    StateReason: smithyClient.expectString,
    StateReasonCode: smithyClient.expectString,
    Timeout: smithyClient.expectInt32,
    TracingConfig: smithyClient._json,
    Version: smithyClient.expectString,
    VpcConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionEventInvokeConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    DestinationConfig: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    MaximumEventAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionRecursionConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    RecursiveLoop: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetFunctionUrlConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AuthType: smithyClient.expectString,
    Cors: smithyClient._json,
    CreationTime: smithyClient.expectString,
    FunctionArn: smithyClient.expectString,
    FunctionUrl: smithyClient.expectString,
    InvokeMode: smithyClient.expectString,
    LastModifiedTime: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetLayerVersionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CompatibleArchitectures: smithyClient._json,
    CompatibleRuntimes: smithyClient._json,
    Content: smithyClient._json,
    CreatedDate: smithyClient.expectString,
    Description: smithyClient.expectString,
    LayerArn: smithyClient.expectString,
    LayerVersionArn: smithyClient.expectString,
    LicenseInfo: smithyClient.expectString,
    Version: smithyClient.expectLong,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetLayerVersionByArnCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CompatibleArchitectures: smithyClient._json,
    CompatibleRuntimes: smithyClient._json,
    Content: smithyClient._json,
    CreatedDate: smithyClient.expectString,
    Description: smithyClient.expectString,
    LayerArn: smithyClient.expectString,
    LayerVersionArn: smithyClient.expectString,
    LicenseInfo: smithyClient.expectString,
    Version: smithyClient.expectLong,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetLayerVersionPolicyCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Policy: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetPolicyCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Policy: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetProvisionedConcurrencyConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AllocatedProvisionedConcurrentExecutions: smithyClient.expectInt32,
    AvailableProvisionedConcurrentExecutions: smithyClient.expectInt32,
    LastModified: smithyClient.expectString,
    RequestedProvisionedConcurrentExecutions: smithyClient.expectInt32,
    Status: smithyClient.expectString,
    StatusReason: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_GetRuntimeManagementConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    FunctionArn: smithyClient.expectString,
    RuntimeVersionArn: smithyClient.expectString,
    UpdateRuntimeOn: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_InvokeCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
    [_FE]: [, output.headers[_xafe]],
    [_LR]: [, output.headers[_xalr]],
    [_EV]: [, output.headers[_xaev]],
    [_DEA]: [, output.headers[_xadea]],
  });
  const data = await smithyClient.collectBody(output.body, context);
  contents.Payload = data;
  smithyClient.map(contents, {
    StatusCode: [, output.statusCode],
  });
  return contents;
};
const de_InvokeAsyncCommand = async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  smithyClient.map(contents, {
    Status: [, output.statusCode],
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_InvokeWithResponseStreamCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
    [_EV]: [, output.headers[_xaev]],
    [_RSCT]: [, output.headers[_ct]],
  });
  const data = output.body;
  contents.EventStream = de_InvokeWithResponseStreamResponseEvent(
    data,
    context,
  );
  smithyClient.map(contents, {
    StatusCode: [, output.statusCode],
  });
  return contents;
};
const de_ListAliasesCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Aliases: (_) => de_AliasList(_),
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListCodeSigningConfigsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfigs: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListDurableExecutionsByFunctionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    DurableExecutions: (_) => de_DurableExecutions(_),
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListEventSourceMappingsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    EventSourceMappings: (_) => de_EventSourceMappingsList(_),
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListFunctionEventInvokeConfigsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    FunctionEventInvokeConfigs: (_) => de_FunctionEventInvokeConfigList(_),
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListFunctionsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Functions: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListFunctionsByCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    FunctionArns: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListFunctionUrlConfigsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    FunctionUrlConfigs: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListLayersCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Layers: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListLayerVersionsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    LayerVersions: smithyClient._json,
    NextMarker: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListProvisionedConcurrencyConfigsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    NextMarker: smithyClient.expectString,
    ProvisionedConcurrencyConfigs: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListTagsCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Tags: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_ListVersionsByFunctionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    NextMarker: smithyClient.expectString,
    Versions: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PublishLayerVersionCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CompatibleArchitectures: smithyClient._json,
    CompatibleRuntimes: smithyClient._json,
    Content: smithyClient._json,
    CreatedDate: smithyClient.expectString,
    Description: smithyClient.expectString,
    LayerArn: smithyClient.expectString,
    LayerVersionArn: smithyClient.expectString,
    LicenseInfo: smithyClient.expectString,
    Version: smithyClient.expectLong,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PublishVersionCommand = async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Architectures: smithyClient._json,
    CodeSha256: smithyClient.expectString,
    CodeSize: smithyClient.expectLong,
    DeadLetterConfig: smithyClient._json,
    Description: smithyClient.expectString,
    DurableConfig: smithyClient._json,
    Environment: smithyClient._json,
    EphemeralStorage: smithyClient._json,
    FileSystemConfigs: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
    Handler: smithyClient.expectString,
    ImageConfigResponse: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: smithyClient.expectString,
    LastUpdateStatus: smithyClient.expectString,
    LastUpdateStatusReason: smithyClient.expectString,
    LastUpdateStatusReasonCode: smithyClient.expectString,
    Layers: smithyClient._json,
    LoggingConfig: smithyClient._json,
    MasterArn: smithyClient.expectString,
    MemorySize: smithyClient.expectInt32,
    PackageType: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    Role: smithyClient.expectString,
    Runtime: smithyClient.expectString,
    RuntimeVersionConfig: smithyClient._json,
    SigningJobArn: smithyClient.expectString,
    SigningProfileVersionArn: smithyClient.expectString,
    SnapStart: smithyClient._json,
    State: smithyClient.expectString,
    StateReason: smithyClient.expectString,
    StateReasonCode: smithyClient.expectString,
    Timeout: smithyClient.expectInt32,
    TracingConfig: smithyClient._json,
    Version: smithyClient.expectString,
    VpcConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutFunctionCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfigArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutFunctionConcurrencyCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    ReservedConcurrentExecutions: smithyClient.expectInt32,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutFunctionEventInvokeConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    DestinationConfig: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    MaximumEventAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutFunctionRecursionConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    RecursiveLoop: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutProvisionedConcurrencyConfigCommand = async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AllocatedProvisionedConcurrentExecutions: smithyClient.expectInt32,
    AvailableProvisionedConcurrentExecutions: smithyClient.expectInt32,
    LastModified: smithyClient.expectString,
    RequestedProvisionedConcurrentExecutions: smithyClient.expectInt32,
    Status: smithyClient.expectString,
    StatusReason: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_PutRuntimeManagementConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    FunctionArn: smithyClient.expectString,
    RuntimeVersionArn: smithyClient.expectString,
    UpdateRuntimeOn: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_RemoveLayerVersionPermissionCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_RemovePermissionCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_SendDurableExecutionCallbackFailureCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_SendDurableExecutionCallbackHeartbeatCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_SendDurableExecutionCallbackSuccessCommand = async (
  output,
  context,
) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_StopDurableExecutionCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    StopTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_TagResourceCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_UntagResourceCommand = async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  await smithyClient.collectBody(output.body, context);
  return contents;
};
const de_UpdateAliasCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AliasArn: smithyClient.expectString,
    Description: smithyClient.expectString,
    FunctionVersion: smithyClient.expectString,
    Name: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    RoutingConfig: (_) => de_AliasRoutingConfiguration(_),
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateCodeSigningConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    CodeSigningConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateEventSourceMappingCommand = async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AmazonManagedKafkaEventSourceConfig: smithyClient._json,
    BatchSize: smithyClient.expectInt32,
    BisectBatchOnFunctionError: smithyClient.expectBoolean,
    DestinationConfig: smithyClient._json,
    DocumentDBEventSourceConfig: smithyClient._json,
    EventSourceArn: smithyClient.expectString,
    EventSourceMappingArn: smithyClient.expectString,
    FilterCriteria: smithyClient._json,
    FilterCriteriaError: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionResponseTypes: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    LastProcessingResult: smithyClient.expectString,
    MaximumBatchingWindowInSeconds: smithyClient.expectInt32,
    MaximumRecordAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
    MetricsConfig: smithyClient._json,
    ParallelizationFactor: smithyClient.expectInt32,
    ProvisionedPollerConfig: smithyClient._json,
    Queues: smithyClient._json,
    ScalingConfig: smithyClient._json,
    SelfManagedEventSource: smithyClient._json,
    SelfManagedKafkaEventSourceConfig: smithyClient._json,
    SourceAccessConfigurations: smithyClient._json,
    StartingPosition: smithyClient.expectString,
    StartingPositionTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    State: smithyClient.expectString,
    StateTransitionReason: smithyClient.expectString,
    Topics: smithyClient._json,
    TumblingWindowInSeconds: smithyClient.expectInt32,
    UUID: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateFunctionCodeCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Architectures: smithyClient._json,
    CodeSha256: smithyClient.expectString,
    CodeSize: smithyClient.expectLong,
    DeadLetterConfig: smithyClient._json,
    Description: smithyClient.expectString,
    DurableConfig: smithyClient._json,
    Environment: smithyClient._json,
    EphemeralStorage: smithyClient._json,
    FileSystemConfigs: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
    Handler: smithyClient.expectString,
    ImageConfigResponse: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: smithyClient.expectString,
    LastUpdateStatus: smithyClient.expectString,
    LastUpdateStatusReason: smithyClient.expectString,
    LastUpdateStatusReasonCode: smithyClient.expectString,
    Layers: smithyClient._json,
    LoggingConfig: smithyClient._json,
    MasterArn: smithyClient.expectString,
    MemorySize: smithyClient.expectInt32,
    PackageType: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    Role: smithyClient.expectString,
    Runtime: smithyClient.expectString,
    RuntimeVersionConfig: smithyClient._json,
    SigningJobArn: smithyClient.expectString,
    SigningProfileVersionArn: smithyClient.expectString,
    SnapStart: smithyClient._json,
    State: smithyClient.expectString,
    StateReason: smithyClient.expectString,
    StateReasonCode: smithyClient.expectString,
    Timeout: smithyClient.expectInt32,
    TracingConfig: smithyClient._json,
    Version: smithyClient.expectString,
    VpcConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateFunctionConfigurationCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    Architectures: smithyClient._json,
    CodeSha256: smithyClient.expectString,
    CodeSize: smithyClient.expectLong,
    DeadLetterConfig: smithyClient._json,
    Description: smithyClient.expectString,
    DurableConfig: smithyClient._json,
    Environment: smithyClient._json,
    EphemeralStorage: smithyClient._json,
    FileSystemConfigs: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionName: smithyClient.expectString,
    Handler: smithyClient.expectString,
    ImageConfigResponse: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: smithyClient.expectString,
    LastUpdateStatus: smithyClient.expectString,
    LastUpdateStatusReason: smithyClient.expectString,
    LastUpdateStatusReasonCode: smithyClient.expectString,
    Layers: smithyClient._json,
    LoggingConfig: smithyClient._json,
    MasterArn: smithyClient.expectString,
    MemorySize: smithyClient.expectInt32,
    PackageType: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    Role: smithyClient.expectString,
    Runtime: smithyClient.expectString,
    RuntimeVersionConfig: smithyClient._json,
    SigningJobArn: smithyClient.expectString,
    SigningProfileVersionArn: smithyClient.expectString,
    SnapStart: smithyClient._json,
    State: smithyClient.expectString,
    StateReason: smithyClient.expectString,
    StateReasonCode: smithyClient.expectString,
    Timeout: smithyClient.expectInt32,
    TracingConfig: smithyClient._json,
    Version: smithyClient.expectString,
    VpcConfig: smithyClient._json,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateFunctionEventInvokeConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    DestinationConfig: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    MaximumEventAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_UpdateFunctionUrlConfigCommand = async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = smithyClient.map({
    $metadata: deserializeMetadata(output),
  });
  const data = smithyClient.expectNonNull(
    smithyClient.expectObject(await core$1.parseJsonBody(output.body, context)),
    "body",
  );
  const doc = smithyClient.take(data, {
    AuthType: smithyClient.expectString,
    Cors: smithyClient._json,
    CreationTime: smithyClient.expectString,
    FunctionArn: smithyClient.expectString,
    FunctionUrl: smithyClient.expectString,
    InvokeMode: smithyClient.expectString,
    LastModifiedTime: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  return contents;
};
const de_CommandError = async (output, context) => {
  const parsedOutput = {
    ...output,
    body: await core$1.parseJsonErrorBody(output.body, context),
  };
  const errorCode = core$1.loadRestJsonErrorCode(output, parsedOutput.body);
  switch (errorCode) {
    case "InvalidParameterValueException":
    case "com.amazonaws.lambda#InvalidParameterValueException":
      throw await de_InvalidParameterValueExceptionRes(parsedOutput);
    case "PolicyLengthExceededException":
    case "com.amazonaws.lambda#PolicyLengthExceededException":
      throw await de_PolicyLengthExceededExceptionRes(parsedOutput);
    case "PreconditionFailedException":
    case "com.amazonaws.lambda#PreconditionFailedException":
      throw await de_PreconditionFailedExceptionRes(parsedOutput);
    case "ResourceConflictException":
    case "com.amazonaws.lambda#ResourceConflictException":
      throw await de_ResourceConflictExceptionRes(parsedOutput);
    case "ResourceNotFoundException":
    case "com.amazonaws.lambda#ResourceNotFoundException":
      throw await de_ResourceNotFoundExceptionRes(parsedOutput);
    case "ServiceException":
    case "com.amazonaws.lambda#ServiceException":
      throw await de_ServiceExceptionRes(parsedOutput);
    case "TooManyRequestsException":
    case "com.amazonaws.lambda#TooManyRequestsException":
      throw await de_TooManyRequestsExceptionRes(parsedOutput);
    case "CodeSigningConfigNotFoundException":
    case "com.amazonaws.lambda#CodeSigningConfigNotFoundException":
      throw await de_CodeSigningConfigNotFoundExceptionRes(parsedOutput);
    case "CodeStorageExceededException":
    case "com.amazonaws.lambda#CodeStorageExceededException":
      throw await de_CodeStorageExceededExceptionRes(parsedOutput);
    case "CodeVerificationFailedException":
    case "com.amazonaws.lambda#CodeVerificationFailedException":
      throw await de_CodeVerificationFailedExceptionRes(parsedOutput);
    case "InvalidCodeSignatureException":
    case "com.amazonaws.lambda#InvalidCodeSignatureException":
      throw await de_InvalidCodeSignatureExceptionRes(parsedOutput);
    case "ResourceInUseException":
    case "com.amazonaws.lambda#ResourceInUseException":
      throw await de_ResourceInUseExceptionRes(parsedOutput);
    case "ProvisionedConcurrencyConfigNotFoundException":
    case "com.amazonaws.lambda#ProvisionedConcurrencyConfigNotFoundException":
      throw await de_ProvisionedConcurrencyConfigNotFoundExceptionRes(
        parsedOutput,
      );
    case "DurableExecutionAlreadyStartedException":
    case "com.amazonaws.lambda#DurableExecutionAlreadyStartedException":
      throw await de_DurableExecutionAlreadyStartedExceptionRes(parsedOutput);
    case "EC2AccessDeniedException":
    case "com.amazonaws.lambda#EC2AccessDeniedException":
      throw await de_EC2AccessDeniedExceptionRes(parsedOutput);
    case "EC2ThrottledException":
    case "com.amazonaws.lambda#EC2ThrottledException":
      throw await de_EC2ThrottledExceptionRes(parsedOutput);
    case "EC2UnexpectedException":
    case "com.amazonaws.lambda#EC2UnexpectedException":
      throw await de_EC2UnexpectedExceptionRes(parsedOutput);
    case "EFSIOException":
    case "com.amazonaws.lambda#EFSIOException":
      throw await de_EFSIOExceptionRes(parsedOutput);
    case "EFSMountConnectivityException":
    case "com.amazonaws.lambda#EFSMountConnectivityException":
      throw await de_EFSMountConnectivityExceptionRes(parsedOutput);
    case "EFSMountFailureException":
    case "com.amazonaws.lambda#EFSMountFailureException":
      throw await de_EFSMountFailureExceptionRes(parsedOutput);
    case "EFSMountTimeoutException":
    case "com.amazonaws.lambda#EFSMountTimeoutException":
      throw await de_EFSMountTimeoutExceptionRes(parsedOutput);
    case "ENILimitReachedException":
    case "com.amazonaws.lambda#ENILimitReachedException":
      throw await de_ENILimitReachedExceptionRes(parsedOutput);
    case "InvalidRequestContentException":
    case "com.amazonaws.lambda#InvalidRequestContentException":
      throw await de_InvalidRequestContentExceptionRes(parsedOutput);
    case "InvalidRuntimeException":
    case "com.amazonaws.lambda#InvalidRuntimeException":
      throw await de_InvalidRuntimeExceptionRes(parsedOutput);
    case "InvalidSecurityGroupIDException":
    case "com.amazonaws.lambda#InvalidSecurityGroupIDException":
      throw await de_InvalidSecurityGroupIDExceptionRes(parsedOutput);
    case "InvalidSubnetIDException":
    case "com.amazonaws.lambda#InvalidSubnetIDException":
      throw await de_InvalidSubnetIDExceptionRes(parsedOutput);
    case "InvalidZipFileException":
    case "com.amazonaws.lambda#InvalidZipFileException":
      throw await de_InvalidZipFileExceptionRes(parsedOutput);
    case "KMSAccessDeniedException":
    case "com.amazonaws.lambda#KMSAccessDeniedException":
      throw await de_KMSAccessDeniedExceptionRes(parsedOutput);
    case "KMSDisabledException":
    case "com.amazonaws.lambda#KMSDisabledException":
      throw await de_KMSDisabledExceptionRes(parsedOutput);
    case "KMSInvalidStateException":
    case "com.amazonaws.lambda#KMSInvalidStateException":
      throw await de_KMSInvalidStateExceptionRes(parsedOutput);
    case "KMSNotFoundException":
    case "com.amazonaws.lambda#KMSNotFoundException":
      throw await de_KMSNotFoundExceptionRes(parsedOutput);
    case "RecursiveInvocationException":
    case "com.amazonaws.lambda#RecursiveInvocationException":
      throw await de_RecursiveInvocationExceptionRes(parsedOutput);
    case "RequestTooLargeException":
    case "com.amazonaws.lambda#RequestTooLargeException":
      throw await de_RequestTooLargeExceptionRes(parsedOutput);
    case "ResourceNotReadyException":
    case "com.amazonaws.lambda#ResourceNotReadyException":
      throw await de_ResourceNotReadyExceptionRes(parsedOutput);
    case "SnapStartException":
    case "com.amazonaws.lambda#SnapStartException":
      throw await de_SnapStartExceptionRes(parsedOutput);
    case "SnapStartNotReadyException":
    case "com.amazonaws.lambda#SnapStartNotReadyException":
      throw await de_SnapStartNotReadyExceptionRes(parsedOutput);
    case "SnapStartTimeoutException":
    case "com.amazonaws.lambda#SnapStartTimeoutException":
      throw await de_SnapStartTimeoutExceptionRes(parsedOutput);
    case "SubnetIPAddressLimitReachedException":
    case "com.amazonaws.lambda#SubnetIPAddressLimitReachedException":
      throw await de_SubnetIPAddressLimitReachedExceptionRes(parsedOutput);
    case "UnsupportedMediaTypeException":
    case "com.amazonaws.lambda#UnsupportedMediaTypeException":
      throw await de_UnsupportedMediaTypeExceptionRes(parsedOutput);
    case "CallbackTimeoutException":
    case "com.amazonaws.lambda#CallbackTimeoutException":
      throw await de_CallbackTimeoutExceptionRes(parsedOutput);
    default:
      const parsedBody = parsedOutput.body;
      return throwDefaultError({
        output,
        parsedBody,
        errorCode,
      });
  }
};
const throwDefaultError = smithyClient.withBaseException(
  LambdaServiceException,
);
const de_CallbackTimeoutExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new CallbackTimeoutException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_CodeSigningConfigNotFoundExceptionRes = async (
  parsedOutput,
  context,
) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new CodeSigningConfigNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_CodeStorageExceededExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new CodeStorageExceededException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_CodeVerificationFailedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new CodeVerificationFailedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_DurableExecutionAlreadyStartedExceptionRes = async (
  parsedOutput,
  context,
) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new DurableExecutionAlreadyStartedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EC2AccessDeniedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EC2AccessDeniedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EC2ThrottledExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EC2ThrottledException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EC2UnexpectedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    EC2ErrorCode: smithyClient.expectString,
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EC2UnexpectedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EFSIOExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EFSIOException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountConnectivityExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EFSMountConnectivityException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountFailureExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EFSMountFailureException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountTimeoutExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new EFSMountTimeoutException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ENILimitReachedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ENILimitReachedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidCodeSignatureExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidCodeSignatureException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidParameterValueExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidParameterValueException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidRequestContentExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidRequestContentException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidRuntimeExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidRuntimeException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidSecurityGroupIDExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidSecurityGroupIDException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidSubnetIDExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidSubnetIDException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidZipFileExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new InvalidZipFileException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_KMSAccessDeniedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new KMSAccessDeniedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_KMSDisabledExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new KMSDisabledException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_KMSInvalidStateExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new KMSInvalidStateException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_KMSNotFoundExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new KMSNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_PolicyLengthExceededExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new PolicyLengthExceededException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_PreconditionFailedExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new PreconditionFailedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ProvisionedConcurrencyConfigNotFoundExceptionRes = async (
  parsedOutput,
  context,
) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ProvisionedConcurrencyConfigNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_RecursiveInvocationExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new RecursiveInvocationException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_RequestTooLargeExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new RequestTooLargeException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceConflictExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ResourceConflictException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceInUseExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ResourceInUseException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceNotFoundExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ResourceNotFoundException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceNotReadyExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ResourceNotReadyException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_ServiceExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new ServiceException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new SnapStartException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartNotReadyExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new SnapStartNotReadyException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartTimeoutExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new SnapStartTimeoutException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_SubnetIPAddressLimitReachedExceptionRes = async (
  parsedOutput,
  context,
) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Message: smithyClient.expectString,
    Type: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new SubnetIPAddressLimitReachedException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_TooManyRequestsExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({
    [_rAS]: [, parsedOutput.headers[_ra]],
  });
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Reason: smithyClient.expectString,
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new TooManyRequestsException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_UnsupportedMediaTypeExceptionRes = async (parsedOutput, context) => {
  const contents = smithyClient.map({});
  const data = parsedOutput.body;
  const doc = smithyClient.take(data, {
    Type: smithyClient.expectString,
    message: smithyClient.expectString,
  });
  Object.assign(contents, doc);
  const exception = new UnsupportedMediaTypeException({
    $metadata: deserializeMetadata(parsedOutput),
    ...contents,
  });
  return smithyClient.decorateServiceException(exception, parsedOutput.body);
};
const de_InvokeWithResponseStreamResponseEvent = (output, context) => {
  return context.eventStreamMarshaller.deserialize(output, async (event) => {
    if (event["PayloadChunk"] != null) {
      return {
        PayloadChunk: await de_InvokeResponseStreamUpdate_event(
          event["PayloadChunk"],
        ),
      };
    }
    if (event["InvokeComplete"] != null) {
      return {
        InvokeComplete: await de_InvokeWithResponseStreamCompleteEvent_event(
          event["InvokeComplete"],
          context,
        ),
      };
    }
    return { $unknown: event };
  });
};
const de_InvokeResponseStreamUpdate_event = async (output, context) => {
  const contents = {};
  contents.Payload = output.body;
  return contents;
};
const de_InvokeWithResponseStreamCompleteEvent_event = async (
  output,
  context,
) => {
  const contents = {};
  const data = await core$1.parseJsonBody(output.body, context);
  Object.assign(contents, smithyClient._json(data));
  return contents;
};
const se_AdditionalVersionWeights = (input, context) => {
  return Object.entries(input).reduce((acc, [key, value]) => {
    if (value === null) {
      return acc;
    }
    acc[key] = smithyClient.serializeFloat(value);
    return acc;
  }, {});
};
const se_AliasRoutingConfiguration = (input, context) => {
  return smithyClient.take(input, {
    AdditionalVersionWeights: (_) => se_AdditionalVersionWeights(_),
  });
};
const se_FunctionCode = (input, context) => {
  return smithyClient.take(input, {
    ImageUri: [],
    S3Bucket: [],
    S3Key: [],
    S3ObjectVersion: [],
    SourceKMSKeyArn: [],
    ZipFile: context.base64Encoder,
  });
};
const se_LayerVersionContentInput = (input, context) => {
  return smithyClient.take(input, {
    S3Bucket: [],
    S3Key: [],
    S3ObjectVersion: [],
    ZipFile: context.base64Encoder,
  });
};
const de_AdditionalVersionWeights = (output, context) => {
  return Object.entries(output).reduce((acc, [key, value]) => {
    if (value === null) {
      return acc;
    }
    acc[key] = smithyClient.limitedParseDouble(value);
    return acc;
  }, {});
};
const de_AliasConfiguration = (output, context) => {
  return smithyClient.take(output, {
    AliasArn: smithyClient.expectString,
    Description: smithyClient.expectString,
    FunctionVersion: smithyClient.expectString,
    Name: smithyClient.expectString,
    RevisionId: smithyClient.expectString,
    RoutingConfig: (_) => de_AliasRoutingConfiguration(_),
  });
};
const de_AliasList = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_AliasConfiguration(entry);
    });
  return retVal;
};
const de_AliasRoutingConfiguration = (output, context) => {
  return smithyClient.take(output, {
    AdditionalVersionWeights: (_) => de_AdditionalVersionWeights(_),
  });
};
const de_CheckpointUpdatedExecutionState = (output, context) => {
  return smithyClient.take(output, {
    NextMarker: smithyClient.expectString,
    Operations: (_) => de_Operations(_),
  });
};
const de_DurableExecutions = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Execution(entry);
    });
  return retVal;
};
const de_Event = (output, context) => {
  return smithyClient.take(output, {
    CallbackFailedDetails: smithyClient._json,
    CallbackStartedDetails: smithyClient._json,
    CallbackSucceededDetails: smithyClient._json,
    CallbackTimedOutDetails: smithyClient._json,
    ChainedInvokeFailedDetails: smithyClient._json,
    ChainedInvokePendingDetails: smithyClient._json,
    ChainedInvokeStartedDetails: smithyClient._json,
    ChainedInvokeStoppedDetails: smithyClient._json,
    ChainedInvokeSucceededDetails: smithyClient._json,
    ChainedInvokeTimedOutDetails: smithyClient._json,
    ContextFailedDetails: smithyClient._json,
    ContextStartedDetails: smithyClient._json,
    ContextSucceededDetails: smithyClient._json,
    EventId: smithyClient.expectInt32,
    EventTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    EventType: smithyClient.expectString,
    ExecutionFailedDetails: smithyClient._json,
    ExecutionStartedDetails: smithyClient._json,
    ExecutionStoppedDetails: smithyClient._json,
    ExecutionSucceededDetails: smithyClient._json,
    ExecutionTimedOutDetails: smithyClient._json,
    Id: smithyClient.expectString,
    InvocationCompletedDetails: (_) => de_InvocationCompletedDetails(_),
    Name: smithyClient.expectString,
    ParentId: smithyClient.expectString,
    StepFailedDetails: smithyClient._json,
    StepStartedDetails: smithyClient._json,
    StepSucceededDetails: smithyClient._json,
    SubType: smithyClient.expectString,
    WaitCancelledDetails: smithyClient._json,
    WaitStartedDetails: (_) => de_WaitStartedDetails(_),
    WaitSucceededDetails: smithyClient._json,
  });
};
const de_Events = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Event(entry);
    });
  return retVal;
};
const de_EventSourceMappingConfiguration = (output, context) => {
  return smithyClient.take(output, {
    AmazonManagedKafkaEventSourceConfig: smithyClient._json,
    BatchSize: smithyClient.expectInt32,
    BisectBatchOnFunctionError: smithyClient.expectBoolean,
    DestinationConfig: smithyClient._json,
    DocumentDBEventSourceConfig: smithyClient._json,
    EventSourceArn: smithyClient.expectString,
    EventSourceMappingArn: smithyClient.expectString,
    FilterCriteria: smithyClient._json,
    FilterCriteriaError: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    FunctionResponseTypes: smithyClient._json,
    KMSKeyArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    LastProcessingResult: smithyClient.expectString,
    MaximumBatchingWindowInSeconds: smithyClient.expectInt32,
    MaximumRecordAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
    MetricsConfig: smithyClient._json,
    ParallelizationFactor: smithyClient.expectInt32,
    ProvisionedPollerConfig: smithyClient._json,
    Queues: smithyClient._json,
    ScalingConfig: smithyClient._json,
    SelfManagedEventSource: smithyClient._json,
    SelfManagedKafkaEventSourceConfig: smithyClient._json,
    SourceAccessConfigurations: smithyClient._json,
    StartingPosition: smithyClient.expectString,
    StartingPositionTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    State: smithyClient.expectString,
    StateTransitionReason: smithyClient.expectString,
    Topics: smithyClient._json,
    TumblingWindowInSeconds: smithyClient.expectInt32,
    UUID: smithyClient.expectString,
  });
};
const de_EventSourceMappingsList = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_EventSourceMappingConfiguration(entry);
    });
  return retVal;
};
const de_Execution = (output, context) => {
  return smithyClient.take(output, {
    DurableExecutionArn: smithyClient.expectString,
    DurableExecutionName: smithyClient.expectString,
    EndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    FunctionArn: smithyClient.expectString,
    StartTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Status: smithyClient.expectString,
  });
};
const de_FunctionEventInvokeConfig = (output, context) => {
  return smithyClient.take(output, {
    DestinationConfig: smithyClient._json,
    FunctionArn: smithyClient.expectString,
    LastModified: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    MaximumEventAgeInSeconds: smithyClient.expectInt32,
    MaximumRetryAttempts: smithyClient.expectInt32,
  });
};
const de_FunctionEventInvokeConfigList = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_FunctionEventInvokeConfig(entry);
    });
  return retVal;
};
const de_InvocationCompletedDetails = (output, context) => {
  return smithyClient.take(output, {
    EndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Error: smithyClient._json,
    RequestId: smithyClient.expectString,
    StartTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
  });
};
const de_Operation = (output, context) => {
  return smithyClient.take(output, {
    CallbackDetails: smithyClient._json,
    ChainedInvokeDetails: smithyClient._json,
    ContextDetails: smithyClient._json,
    EndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    ExecutionDetails: smithyClient._json,
    Id: smithyClient.expectString,
    Name: smithyClient.expectString,
    ParentId: smithyClient.expectString,
    StartTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Status: smithyClient.expectString,
    StepDetails: (_) => de_StepDetails(_),
    SubType: smithyClient.expectString,
    Type: smithyClient.expectString,
    WaitDetails: (_) => de_WaitDetails(_),
  });
};
const de_Operations = (output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Operation(entry);
    });
  return retVal;
};
const de_StepDetails = (output, context) => {
  return smithyClient.take(output, {
    Attempt: smithyClient.expectInt32,
    Error: smithyClient._json,
    NextAttemptTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
    Result: smithyClient.expectString,
  });
};
const de_WaitDetails = (output, context) => {
  return smithyClient.take(output, {
    ScheduledEndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
  });
};
const de_WaitStartedDetails = (output, context) => {
  return smithyClient.take(output, {
    Duration: smithyClient.expectInt32,
    ScheduledEndTimestamp: (_) =>
      smithyClient.expectNonNull(
        smithyClient.parseEpochTimestamp(smithyClient.expectNumber(_)),
      ),
  });
};
const deserializeMetadata = (output) => ({
  httpStatusCode: output.statusCode,
  requestId:
    output.headers["x-amzn-requestid"] ??
    output.headers["x-amzn-request-id"] ??
    output.headers["x-amz-request-id"],
  extendedRequestId: output.headers["x-amz-id-2"],
  cfId: output.headers["x-amz-cf-id"],
});
const _A = "Arn";
const _CA = "CompatibleArchitecture";
const _CC = "ClientContext";
const _CR = "CompatibleRuntime";
const _CT = "CheckpointToken";
const _DEA = "DurableExecutionArn";
const _DEN = "DurableExecutionName";
const _ESA = "EventSourceArn";
const _EV = "ExecutedVersion";
const _FE = "FunctionError";
const _FN = "FunctionName";
const _FV = "FunctionVersion";
const _IED = "IncludeExecutionData";
const _IT = "InvocationType";
const _L = "List";
const _LR = "LogResult";
const _LT = "LogType";
const _M = "Marker";
const _MI = "MaxItems";
const _MR = "MasterRegion";
const _Q = "Qualifier";
const _RI = "RevisionId";
const _RO = "ReverseOrder";
const _RSCT = "ResponseStreamContentType";
const _S = "Statuses";
const _SA = "StartedAfter";
const _SB = "StartedBefore";
const _TK = "TagKeys";
const _ct = "content-type";
const _f = "find";
const _rAS = "retryAfterSeconds";
const _ra = "retry-after";
const _tK = "tagKeys";
const _xacc = "x-amz-client-context";
const _xadea = "x-amz-durable-execution-arn";
const _xaden = "x-amz-durable-execution-name";
const _xaev = "x-amz-executed-version";
const _xafe = "x-amz-function-error";
const _xait = "x-amz-invocation-type";
const _xalr = "x-amz-log-result";
const _xalt = "x-amz-log-type";

class AddLayerVersionPermissionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "AddLayerVersionPermission", {})
  .n("LambdaClient", "AddLayerVersionPermissionCommand")
  .f(void 0, void 0)
  .ser(se_AddLayerVersionPermissionCommand)
  .de(de_AddLayerVersionPermissionCommand)
  .build() {}

class AddPermissionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "AddPermission", {})
  .n("LambdaClient", "AddPermissionCommand")
  .f(void 0, void 0)
  .ser(se_AddPermissionCommand)
  .de(de_AddPermissionCommand)
  .build() {}

class CheckpointDurableExecutionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CheckpointDurableExecution", {})
  .n("LambdaClient", "CheckpointDurableExecutionCommand")
  .f(
    CheckpointDurableExecutionRequestFilterSensitiveLog,
    CheckpointDurableExecutionResponseFilterSensitiveLog,
  )
  .ser(se_CheckpointDurableExecutionCommand)
  .de(de_CheckpointDurableExecutionCommand)
  .build() {}

class CreateAliasCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CreateAlias", {})
  .n("LambdaClient", "CreateAliasCommand")
  .f(void 0, void 0)
  .ser(se_CreateAliasCommand)
  .de(de_CreateAliasCommand)
  .build() {}

class CreateCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CreateCodeSigningConfig", {})
  .n("LambdaClient", "CreateCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_CreateCodeSigningConfigCommand)
  .de(de_CreateCodeSigningConfigCommand)
  .build() {}

class CreateEventSourceMappingCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CreateEventSourceMapping", {})
  .n("LambdaClient", "CreateEventSourceMappingCommand")
  .f(void 0, void 0)
  .ser(se_CreateEventSourceMappingCommand)
  .de(de_CreateEventSourceMappingCommand)
  .build() {}

class CreateFunctionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CreateFunction", {})
  .n("LambdaClient", "CreateFunctionCommand")
  .f(
    CreateFunctionRequestFilterSensitiveLog,
    FunctionConfigurationFilterSensitiveLog,
  )
  .ser(se_CreateFunctionCommand)
  .de(de_CreateFunctionCommand)
  .build() {}

class CreateFunctionUrlConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "CreateFunctionUrlConfig", {})
  .n("LambdaClient", "CreateFunctionUrlConfigCommand")
  .f(void 0, void 0)
  .ser(se_CreateFunctionUrlConfigCommand)
  .de(de_CreateFunctionUrlConfigCommand)
  .build() {}

class DeleteAliasCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteAlias", {})
  .n("LambdaClient", "DeleteAliasCommand")
  .f(void 0, void 0)
  .ser(se_DeleteAliasCommand)
  .de(de_DeleteAliasCommand)
  .build() {}

class DeleteCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteCodeSigningConfig", {})
  .n("LambdaClient", "DeleteCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_DeleteCodeSigningConfigCommand)
  .de(de_DeleteCodeSigningConfigCommand)
  .build() {}

class DeleteEventSourceMappingCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteEventSourceMapping", {})
  .n("LambdaClient", "DeleteEventSourceMappingCommand")
  .f(void 0, void 0)
  .ser(se_DeleteEventSourceMappingCommand)
  .de(de_DeleteEventSourceMappingCommand)
  .build() {}

class DeleteFunctionCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteFunctionCodeSigningConfig", {})
  .n("LambdaClient", "DeleteFunctionCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_DeleteFunctionCodeSigningConfigCommand)
  .de(de_DeleteFunctionCodeSigningConfigCommand)
  .build() {}

class DeleteFunctionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteFunction", {})
  .n("LambdaClient", "DeleteFunctionCommand")
  .f(void 0, void 0)
  .ser(se_DeleteFunctionCommand)
  .de(de_DeleteFunctionCommand)
  .build() {}

class DeleteFunctionConcurrencyCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteFunctionConcurrency", {})
  .n("LambdaClient", "DeleteFunctionConcurrencyCommand")
  .f(void 0, void 0)
  .ser(se_DeleteFunctionConcurrencyCommand)
  .de(de_DeleteFunctionConcurrencyCommand)
  .build() {}

class DeleteFunctionEventInvokeConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteFunctionEventInvokeConfig", {})
  .n("LambdaClient", "DeleteFunctionEventInvokeConfigCommand")
  .f(void 0, void 0)
  .ser(se_DeleteFunctionEventInvokeConfigCommand)
  .de(de_DeleteFunctionEventInvokeConfigCommand)
  .build() {}

class DeleteFunctionUrlConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteFunctionUrlConfig", {})
  .n("LambdaClient", "DeleteFunctionUrlConfigCommand")
  .f(void 0, void 0)
  .ser(se_DeleteFunctionUrlConfigCommand)
  .de(de_DeleteFunctionUrlConfigCommand)
  .build() {}

class DeleteLayerVersionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteLayerVersion", {})
  .n("LambdaClient", "DeleteLayerVersionCommand")
  .f(void 0, void 0)
  .ser(se_DeleteLayerVersionCommand)
  .de(de_DeleteLayerVersionCommand)
  .build() {}

class DeleteProvisionedConcurrencyConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "DeleteProvisionedConcurrencyConfig", {})
  .n("LambdaClient", "DeleteProvisionedConcurrencyConfigCommand")
  .f(void 0, void 0)
  .ser(se_DeleteProvisionedConcurrencyConfigCommand)
  .de(de_DeleteProvisionedConcurrencyConfigCommand)
  .build() {}

class GetAccountSettingsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetAccountSettings", {})
  .n("LambdaClient", "GetAccountSettingsCommand")
  .f(void 0, void 0)
  .ser(se_GetAccountSettingsCommand)
  .de(de_GetAccountSettingsCommand)
  .build() {}

class GetAliasCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetAlias", {})
  .n("LambdaClient", "GetAliasCommand")
  .f(void 0, void 0)
  .ser(se_GetAliasCommand)
  .de(de_GetAliasCommand)
  .build() {}

class GetCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetCodeSigningConfig", {})
  .n("LambdaClient", "GetCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetCodeSigningConfigCommand)
  .de(de_GetCodeSigningConfigCommand)
  .build() {}

class GetDurableExecutionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetDurableExecution", {})
  .n("LambdaClient", "GetDurableExecutionCommand")
  .f(void 0, GetDurableExecutionResponseFilterSensitiveLog)
  .ser(se_GetDurableExecutionCommand)
  .de(de_GetDurableExecutionCommand)
  .build() {}

class GetDurableExecutionHistoryCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetDurableExecutionHistory", {})
  .n("LambdaClient", "GetDurableExecutionHistoryCommand")
  .f(void 0, GetDurableExecutionHistoryResponseFilterSensitiveLog)
  .ser(se_GetDurableExecutionHistoryCommand)
  .de(de_GetDurableExecutionHistoryCommand)
  .build() {}

class GetDurableExecutionStateCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetDurableExecutionState", {})
  .n("LambdaClient", "GetDurableExecutionStateCommand")
  .f(void 0, GetDurableExecutionStateResponseFilterSensitiveLog)
  .ser(se_GetDurableExecutionStateCommand)
  .de(de_GetDurableExecutionStateCommand)
  .build() {}

class GetEventSourceMappingCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetEventSourceMapping", {})
  .n("LambdaClient", "GetEventSourceMappingCommand")
  .f(void 0, void 0)
  .ser(se_GetEventSourceMappingCommand)
  .de(de_GetEventSourceMappingCommand)
  .build() {}

class GetFunctionCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionCodeSigningConfig", {})
  .n("LambdaClient", "GetFunctionCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetFunctionCodeSigningConfigCommand)
  .de(de_GetFunctionCodeSigningConfigCommand)
  .build() {}

class GetFunctionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunction", {})
  .n("LambdaClient", "GetFunctionCommand")
  .f(void 0, GetFunctionResponseFilterSensitiveLog)
  .ser(se_GetFunctionCommand)
  .de(de_GetFunctionCommand)
  .build() {}

class GetFunctionConcurrencyCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionConcurrency", {})
  .n("LambdaClient", "GetFunctionConcurrencyCommand")
  .f(void 0, void 0)
  .ser(se_GetFunctionConcurrencyCommand)
  .de(de_GetFunctionConcurrencyCommand)
  .build() {}

class GetFunctionConfigurationCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionConfiguration", {})
  .n("LambdaClient", "GetFunctionConfigurationCommand")
  .f(void 0, FunctionConfigurationFilterSensitiveLog)
  .ser(se_GetFunctionConfigurationCommand)
  .de(de_GetFunctionConfigurationCommand)
  .build() {}

class GetFunctionEventInvokeConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionEventInvokeConfig", {})
  .n("LambdaClient", "GetFunctionEventInvokeConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetFunctionEventInvokeConfigCommand)
  .de(de_GetFunctionEventInvokeConfigCommand)
  .build() {}

class GetFunctionRecursionConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionRecursionConfig", {})
  .n("LambdaClient", "GetFunctionRecursionConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetFunctionRecursionConfigCommand)
  .de(de_GetFunctionRecursionConfigCommand)
  .build() {}

class GetFunctionUrlConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetFunctionUrlConfig", {})
  .n("LambdaClient", "GetFunctionUrlConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetFunctionUrlConfigCommand)
  .de(de_GetFunctionUrlConfigCommand)
  .build() {}

class GetLayerVersionByArnCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetLayerVersionByArn", {})
  .n("LambdaClient", "GetLayerVersionByArnCommand")
  .f(void 0, void 0)
  .ser(se_GetLayerVersionByArnCommand)
  .de(de_GetLayerVersionByArnCommand)
  .build() {}

class GetLayerVersionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetLayerVersion", {})
  .n("LambdaClient", "GetLayerVersionCommand")
  .f(void 0, void 0)
  .ser(se_GetLayerVersionCommand)
  .de(de_GetLayerVersionCommand)
  .build() {}

class GetLayerVersionPolicyCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetLayerVersionPolicy", {})
  .n("LambdaClient", "GetLayerVersionPolicyCommand")
  .f(void 0, void 0)
  .ser(se_GetLayerVersionPolicyCommand)
  .de(de_GetLayerVersionPolicyCommand)
  .build() {}

class GetPolicyCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetPolicy", {})
  .n("LambdaClient", "GetPolicyCommand")
  .f(void 0, void 0)
  .ser(se_GetPolicyCommand)
  .de(de_GetPolicyCommand)
  .build() {}

class GetProvisionedConcurrencyConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetProvisionedConcurrencyConfig", {})
  .n("LambdaClient", "GetProvisionedConcurrencyConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetProvisionedConcurrencyConfigCommand)
  .de(de_GetProvisionedConcurrencyConfigCommand)
  .build() {}

class GetRuntimeManagementConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "GetRuntimeManagementConfig", {})
  .n("LambdaClient", "GetRuntimeManagementConfigCommand")
  .f(void 0, void 0)
  .ser(se_GetRuntimeManagementConfigCommand)
  .de(de_GetRuntimeManagementConfigCommand)
  .build() {}

class InvokeAsyncCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "InvokeAsync", {})
  .n("LambdaClient", "InvokeAsyncCommand")
  .f(InvokeAsyncRequestFilterSensitiveLog, void 0)
  .ser(se_InvokeAsyncCommand)
  .de(de_InvokeAsyncCommand)
  .build() {}

class InvokeCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "Invoke", {})
  .n("LambdaClient", "InvokeCommand")
  .f(InvocationRequestFilterSensitiveLog, InvocationResponseFilterSensitiveLog)
  .ser(se_InvokeCommand)
  .de(de_InvokeCommand)
  .build() {}

class InvokeWithResponseStreamCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "InvokeWithResponseStream", {
    eventStream: {
      output: true,
    },
  })
  .n("LambdaClient", "InvokeWithResponseStreamCommand")
  .f(
    InvokeWithResponseStreamRequestFilterSensitiveLog,
    InvokeWithResponseStreamResponseFilterSensitiveLog,
  )
  .ser(se_InvokeWithResponseStreamCommand)
  .de(de_InvokeWithResponseStreamCommand)
  .build() {}

class ListAliasesCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListAliases", {})
  .n("LambdaClient", "ListAliasesCommand")
  .f(void 0, void 0)
  .ser(se_ListAliasesCommand)
  .de(de_ListAliasesCommand)
  .build() {}

class ListCodeSigningConfigsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListCodeSigningConfigs", {})
  .n("LambdaClient", "ListCodeSigningConfigsCommand")
  .f(void 0, void 0)
  .ser(se_ListCodeSigningConfigsCommand)
  .de(de_ListCodeSigningConfigsCommand)
  .build() {}

class ListDurableExecutionsByFunctionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListDurableExecutionsByFunction", {})
  .n("LambdaClient", "ListDurableExecutionsByFunctionCommand")
  .f(void 0, void 0)
  .ser(se_ListDurableExecutionsByFunctionCommand)
  .de(de_ListDurableExecutionsByFunctionCommand)
  .build() {}

class ListEventSourceMappingsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListEventSourceMappings", {})
  .n("LambdaClient", "ListEventSourceMappingsCommand")
  .f(void 0, void 0)
  .ser(se_ListEventSourceMappingsCommand)
  .de(de_ListEventSourceMappingsCommand)
  .build() {}

class ListFunctionEventInvokeConfigsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListFunctionEventInvokeConfigs", {})
  .n("LambdaClient", "ListFunctionEventInvokeConfigsCommand")
  .f(void 0, void 0)
  .ser(se_ListFunctionEventInvokeConfigsCommand)
  .de(de_ListFunctionEventInvokeConfigsCommand)
  .build() {}

class ListFunctionsByCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListFunctionsByCodeSigningConfig", {})
  .n("LambdaClient", "ListFunctionsByCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_ListFunctionsByCodeSigningConfigCommand)
  .de(de_ListFunctionsByCodeSigningConfigCommand)
  .build() {}

class ListFunctionsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListFunctions", {})
  .n("LambdaClient", "ListFunctionsCommand")
  .f(void 0, ListFunctionsResponseFilterSensitiveLog)
  .ser(se_ListFunctionsCommand)
  .de(de_ListFunctionsCommand)
  .build() {}

class ListFunctionUrlConfigsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListFunctionUrlConfigs", {})
  .n("LambdaClient", "ListFunctionUrlConfigsCommand")
  .f(void 0, void 0)
  .ser(se_ListFunctionUrlConfigsCommand)
  .de(de_ListFunctionUrlConfigsCommand)
  .build() {}

class ListLayersCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListLayers", {})
  .n("LambdaClient", "ListLayersCommand")
  .f(void 0, void 0)
  .ser(se_ListLayersCommand)
  .de(de_ListLayersCommand)
  .build() {}

class ListLayerVersionsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListLayerVersions", {})
  .n("LambdaClient", "ListLayerVersionsCommand")
  .f(void 0, void 0)
  .ser(se_ListLayerVersionsCommand)
  .de(de_ListLayerVersionsCommand)
  .build() {}

class ListProvisionedConcurrencyConfigsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListProvisionedConcurrencyConfigs", {})
  .n("LambdaClient", "ListProvisionedConcurrencyConfigsCommand")
  .f(void 0, void 0)
  .ser(se_ListProvisionedConcurrencyConfigsCommand)
  .de(de_ListProvisionedConcurrencyConfigsCommand)
  .build() {}

class ListTagsCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListTags", {})
  .n("LambdaClient", "ListTagsCommand")
  .f(void 0, void 0)
  .ser(se_ListTagsCommand)
  .de(de_ListTagsCommand)
  .build() {}

class ListVersionsByFunctionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "ListVersionsByFunction", {})
  .n("LambdaClient", "ListVersionsByFunctionCommand")
  .f(void 0, ListVersionsByFunctionResponseFilterSensitiveLog)
  .ser(se_ListVersionsByFunctionCommand)
  .de(de_ListVersionsByFunctionCommand)
  .build() {}

class PublishLayerVersionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PublishLayerVersion", {})
  .n("LambdaClient", "PublishLayerVersionCommand")
  .f(PublishLayerVersionRequestFilterSensitiveLog, void 0)
  .ser(se_PublishLayerVersionCommand)
  .de(de_PublishLayerVersionCommand)
  .build() {}

class PublishVersionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PublishVersion", {})
  .n("LambdaClient", "PublishVersionCommand")
  .f(void 0, FunctionConfigurationFilterSensitiveLog)
  .ser(se_PublishVersionCommand)
  .de(de_PublishVersionCommand)
  .build() {}

class PutFunctionCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutFunctionCodeSigningConfig", {})
  .n("LambdaClient", "PutFunctionCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_PutFunctionCodeSigningConfigCommand)
  .de(de_PutFunctionCodeSigningConfigCommand)
  .build() {}

class PutFunctionConcurrencyCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutFunctionConcurrency", {})
  .n("LambdaClient", "PutFunctionConcurrencyCommand")
  .f(void 0, void 0)
  .ser(se_PutFunctionConcurrencyCommand)
  .de(de_PutFunctionConcurrencyCommand)
  .build() {}

class PutFunctionEventInvokeConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutFunctionEventInvokeConfig", {})
  .n("LambdaClient", "PutFunctionEventInvokeConfigCommand")
  .f(void 0, void 0)
  .ser(se_PutFunctionEventInvokeConfigCommand)
  .de(de_PutFunctionEventInvokeConfigCommand)
  .build() {}

class PutFunctionRecursionConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutFunctionRecursionConfig", {})
  .n("LambdaClient", "PutFunctionRecursionConfigCommand")
  .f(void 0, void 0)
  .ser(se_PutFunctionRecursionConfigCommand)
  .de(de_PutFunctionRecursionConfigCommand)
  .build() {}

class PutProvisionedConcurrencyConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutProvisionedConcurrencyConfig", {})
  .n("LambdaClient", "PutProvisionedConcurrencyConfigCommand")
  .f(void 0, void 0)
  .ser(se_PutProvisionedConcurrencyConfigCommand)
  .de(de_PutProvisionedConcurrencyConfigCommand)
  .build() {}

class PutRuntimeManagementConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "PutRuntimeManagementConfig", {})
  .n("LambdaClient", "PutRuntimeManagementConfigCommand")
  .f(void 0, void 0)
  .ser(se_PutRuntimeManagementConfigCommand)
  .de(de_PutRuntimeManagementConfigCommand)
  .build() {}

class RemoveLayerVersionPermissionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "RemoveLayerVersionPermission", {})
  .n("LambdaClient", "RemoveLayerVersionPermissionCommand")
  .f(void 0, void 0)
  .ser(se_RemoveLayerVersionPermissionCommand)
  .de(de_RemoveLayerVersionPermissionCommand)
  .build() {}

class RemovePermissionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "RemovePermission", {})
  .n("LambdaClient", "RemovePermissionCommand")
  .f(void 0, void 0)
  .ser(se_RemovePermissionCommand)
  .de(de_RemovePermissionCommand)
  .build() {}

const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});
const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Result && { Result: smithyClient.SENSITIVE_STRING }),
});
const StopDurableExecutionRequestFilterSensitiveLog = (obj) => ({
  ...obj,
  ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
});

class SendDurableExecutionCallbackFailureCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "SendDurableExecutionCallbackFailure", {})
  .n("LambdaClient", "SendDurableExecutionCallbackFailureCommand")
  .f(SendDurableExecutionCallbackFailureRequestFilterSensitiveLog, void 0)
  .ser(se_SendDurableExecutionCallbackFailureCommand)
  .de(de_SendDurableExecutionCallbackFailureCommand)
  .build() {}

class SendDurableExecutionCallbackHeartbeatCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "SendDurableExecutionCallbackHeartbeat", {})
  .n("LambdaClient", "SendDurableExecutionCallbackHeartbeatCommand")
  .f(void 0, void 0)
  .ser(se_SendDurableExecutionCallbackHeartbeatCommand)
  .de(de_SendDurableExecutionCallbackHeartbeatCommand)
  .build() {}

class SendDurableExecutionCallbackSuccessCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "SendDurableExecutionCallbackSuccess", {})
  .n("LambdaClient", "SendDurableExecutionCallbackSuccessCommand")
  .f(SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog, void 0)
  .ser(se_SendDurableExecutionCallbackSuccessCommand)
  .de(de_SendDurableExecutionCallbackSuccessCommand)
  .build() {}

class StopDurableExecutionCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "StopDurableExecution", {})
  .n("LambdaClient", "StopDurableExecutionCommand")
  .f(StopDurableExecutionRequestFilterSensitiveLog, void 0)
  .ser(se_StopDurableExecutionCommand)
  .de(de_StopDurableExecutionCommand)
  .build() {}

class TagResourceCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "TagResource", {})
  .n("LambdaClient", "TagResourceCommand")
  .f(void 0, void 0)
  .ser(se_TagResourceCommand)
  .de(de_TagResourceCommand)
  .build() {}

class UntagResourceCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UntagResource", {})
  .n("LambdaClient", "UntagResourceCommand")
  .f(void 0, void 0)
  .ser(se_UntagResourceCommand)
  .de(de_UntagResourceCommand)
  .build() {}

class UpdateAliasCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateAlias", {})
  .n("LambdaClient", "UpdateAliasCommand")
  .f(void 0, void 0)
  .ser(se_UpdateAliasCommand)
  .de(de_UpdateAliasCommand)
  .build() {}

class UpdateCodeSigningConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateCodeSigningConfig", {})
  .n("LambdaClient", "UpdateCodeSigningConfigCommand")
  .f(void 0, void 0)
  .ser(se_UpdateCodeSigningConfigCommand)
  .de(de_UpdateCodeSigningConfigCommand)
  .build() {}

class UpdateEventSourceMappingCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateEventSourceMapping", {})
  .n("LambdaClient", "UpdateEventSourceMappingCommand")
  .f(void 0, void 0)
  .ser(se_UpdateEventSourceMappingCommand)
  .de(de_UpdateEventSourceMappingCommand)
  .build() {}

class UpdateFunctionCodeCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateFunctionCode", {})
  .n("LambdaClient", "UpdateFunctionCodeCommand")
  .f(
    UpdateFunctionCodeRequestFilterSensitiveLog,
    FunctionConfigurationFilterSensitiveLog,
  )
  .ser(se_UpdateFunctionCodeCommand)
  .de(de_UpdateFunctionCodeCommand)
  .build() {}

class UpdateFunctionConfigurationCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateFunctionConfiguration", {})
  .n("LambdaClient", "UpdateFunctionConfigurationCommand")
  .f(
    UpdateFunctionConfigurationRequestFilterSensitiveLog,
    FunctionConfigurationFilterSensitiveLog,
  )
  .ser(se_UpdateFunctionConfigurationCommand)
  .de(de_UpdateFunctionConfigurationCommand)
  .build() {}

class UpdateFunctionEventInvokeConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateFunctionEventInvokeConfig", {})
  .n("LambdaClient", "UpdateFunctionEventInvokeConfigCommand")
  .f(void 0, void 0)
  .ser(se_UpdateFunctionEventInvokeConfigCommand)
  .de(de_UpdateFunctionEventInvokeConfigCommand)
  .build() {}

class UpdateFunctionUrlConfigCommand extends smithyClient.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      middlewareSerde.getSerdePlugin(config, this.serialize, this.deserialize),
      middlewareEndpoint.getEndpointPlugin(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "UpdateFunctionUrlConfig", {})
  .n("LambdaClient", "UpdateFunctionUrlConfigCommand")
  .f(void 0, void 0)
  .ser(se_UpdateFunctionUrlConfigCommand)
  .de(de_UpdateFunctionUrlConfigCommand)
  .build() {}

const commands = {
  AddLayerVersionPermissionCommand,
  AddPermissionCommand,
  CheckpointDurableExecutionCommand,
  CreateAliasCommand,
  CreateCodeSigningConfigCommand,
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  DeleteAliasCommand,
  DeleteCodeSigningConfigCommand,
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
  DeleteFunctionCodeSigningConfigCommand,
  DeleteFunctionConcurrencyCommand,
  DeleteFunctionEventInvokeConfigCommand,
  DeleteFunctionUrlConfigCommand,
  DeleteLayerVersionCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  GetAccountSettingsCommand,
  GetAliasCommand,
  GetCodeSigningConfigCommand,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionStateCommand,
  GetEventSourceMappingCommand,
  GetFunctionCommand,
  GetFunctionCodeSigningConfigCommand,
  GetFunctionConcurrencyCommand,
  GetFunctionConfigurationCommand,
  GetFunctionEventInvokeConfigCommand,
  GetFunctionRecursionConfigCommand,
  GetFunctionUrlConfigCommand,
  GetLayerVersionCommand,
  GetLayerVersionByArnCommand,
  GetLayerVersionPolicyCommand,
  GetPolicyCommand,
  GetProvisionedConcurrencyConfigCommand,
  GetRuntimeManagementConfigCommand,
  InvokeCommand,
  InvokeAsyncCommand,
  InvokeWithResponseStreamCommand,
  ListAliasesCommand,
  ListCodeSigningConfigsCommand,
  ListDurableExecutionsByFunctionCommand,
  ListEventSourceMappingsCommand,
  ListFunctionEventInvokeConfigsCommand,
  ListFunctionsCommand,
  ListFunctionsByCodeSigningConfigCommand,
  ListFunctionUrlConfigsCommand,
  ListLayersCommand,
  ListLayerVersionsCommand,
  ListProvisionedConcurrencyConfigsCommand,
  ListTagsCommand,
  ListVersionsByFunctionCommand,
  PublishLayerVersionCommand,
  PublishVersionCommand,
  PutFunctionCodeSigningConfigCommand,
  PutFunctionConcurrencyCommand,
  PutFunctionEventInvokeConfigCommand,
  PutFunctionRecursionConfigCommand,
  PutProvisionedConcurrencyConfigCommand,
  PutRuntimeManagementConfigCommand,
  RemoveLayerVersionPermissionCommand,
  RemovePermissionCommand,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
  StopDurableExecutionCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateAliasCommand,
  UpdateCodeSigningConfigCommand,
  UpdateEventSourceMappingCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionEventInvokeConfigCommand,
  UpdateFunctionUrlConfigCommand,
};
class Lambda extends LambdaClient {}
smithyClient.createAggregatedClient(commands, Lambda);

const paginateGetDurableExecutionHistory = core.createPaginator(
  LambdaClient,
  GetDurableExecutionHistoryCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateGetDurableExecutionState = core.createPaginator(
  LambdaClient,
  GetDurableExecutionStateCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListAliases = core.createPaginator(
  LambdaClient,
  ListAliasesCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListCodeSigningConfigs = core.createPaginator(
  LambdaClient,
  ListCodeSigningConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListDurableExecutionsByFunction = core.createPaginator(
  LambdaClient,
  ListDurableExecutionsByFunctionCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListEventSourceMappings = core.createPaginator(
  LambdaClient,
  ListEventSourceMappingsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListFunctionEventInvokeConfigs = core.createPaginator(
  LambdaClient,
  ListFunctionEventInvokeConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListFunctionUrlConfigs = core.createPaginator(
  LambdaClient,
  ListFunctionUrlConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListFunctionsByCodeSigningConfig = core.createPaginator(
  LambdaClient,
  ListFunctionsByCodeSigningConfigCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListFunctions = core.createPaginator(
  LambdaClient,
  ListFunctionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListLayerVersions = core.createPaginator(
  LambdaClient,
  ListLayerVersionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListLayers = core.createPaginator(
  LambdaClient,
  ListLayersCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListProvisionedConcurrencyConfigs = core.createPaginator(
  LambdaClient,
  ListProvisionedConcurrencyConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const paginateListVersionsByFunction = core.createPaginator(
  LambdaClient,
  ListVersionsByFunctionCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

const checkState$5 = async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Active") {
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Failed") {
        return { state: utilWaiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Pending") {
        return { state: utilWaiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForFunctionActive = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$5,
  );
};
const waitUntilFunctionActive = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$5,
  );
  return utilWaiter.checkExceptions(result);
};

const checkState$4 = async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    try {
      const returnComparator = () => {
        return result.Configuration.State;
      };
      if (returnComparator() === "Active") {
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.Configuration.State;
      };
      if (returnComparator() === "Failed") {
        return { state: utilWaiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.Configuration.State;
      };
      if (returnComparator() === "Pending") {
        return { state: utilWaiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForFunctionActiveV2 = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$4,
  );
};
const waitUntilFunctionActiveV2 = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$4,
  );
  return utilWaiter.checkExceptions(result);
};

const checkState$3 = async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    return { state: utilWaiter.WaiterState.SUCCESS, reason };
  } catch (exception) {
    reason = exception;
    if (exception.name && exception.name == "ResourceNotFoundException") {
      return { state: utilWaiter.WaiterState.RETRY, reason };
    }
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForFunctionExists = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 20 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$3,
  );
};
const waitUntilFunctionExists = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 20 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$3,
  );
  return utilWaiter.checkExceptions(result);
};

const checkState$2 = async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = () => {
        return result.LastUpdateStatus;
      };
      if (returnComparator() === "Successful") {
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.LastUpdateStatus;
      };
      if (returnComparator() === "Failed") {
        return { state: utilWaiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.LastUpdateStatus;
      };
      if (returnComparator() === "InProgress") {
        return { state: utilWaiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForFunctionUpdated = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$2,
  );
};
const waitUntilFunctionUpdated = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$2,
  );
  return utilWaiter.checkExceptions(result);
};

const checkState$1 = async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    try {
      const returnComparator = () => {
        return result.Configuration.LastUpdateStatus;
      };
      if (returnComparator() === "Successful") {
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.Configuration.LastUpdateStatus;
      };
      if (returnComparator() === "Failed") {
        return { state: utilWaiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.Configuration.LastUpdateStatus;
      };
      if (returnComparator() === "InProgress") {
        return { state: utilWaiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForFunctionUpdatedV2 = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$1,
  );
};
const waitUntilFunctionUpdatedV2 = async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState$1,
  );
  return utilWaiter.checkExceptions(result);
};

const checkState = async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Active") {
        return { state: utilWaiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Failed") {
        return { state: utilWaiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = () => {
        return result.State;
      };
      if (returnComparator() === "Pending") {
        return { state: utilWaiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: utilWaiter.WaiterState.RETRY, reason };
};
const waitForPublishedVersionActive = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 1560 };
  return utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
};
const waitUntilPublishedVersionActive = async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 1560 };
  const result = await utilWaiter.createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
  return utilWaiter.checkExceptions(result);
};

Object.defineProperty(exports, "$Command", {
  enumerable: true,
  get: function () {
    return smithyClient.Command;
  },
});
Object.defineProperty(exports, "__Client", {
  enumerable: true,
  get: function () {
    return smithyClient.Client;
  },
});
exports.AddLayerVersionPermissionCommand = AddLayerVersionPermissionCommand;
exports.AddPermissionCommand = AddPermissionCommand;
exports.ApplicationLogLevel = ApplicationLogLevel;
exports.Architecture = Architecture;
exports.CallbackDetailsFilterSensitiveLog = CallbackDetailsFilterSensitiveLog;
exports.CallbackFailedDetailsFilterSensitiveLog =
  CallbackFailedDetailsFilterSensitiveLog;
exports.CallbackSucceededDetailsFilterSensitiveLog =
  CallbackSucceededDetailsFilterSensitiveLog;
exports.CallbackTimedOutDetailsFilterSensitiveLog =
  CallbackTimedOutDetailsFilterSensitiveLog;
exports.CallbackTimeoutException = CallbackTimeoutException;
exports.ChainedInvokeDetailsFilterSensitiveLog =
  ChainedInvokeDetailsFilterSensitiveLog;
exports.ChainedInvokeFailedDetailsFilterSensitiveLog =
  ChainedInvokeFailedDetailsFilterSensitiveLog;
exports.ChainedInvokePendingDetailsFilterSensitiveLog =
  ChainedInvokePendingDetailsFilterSensitiveLog;
exports.ChainedInvokeStoppedDetailsFilterSensitiveLog =
  ChainedInvokeStoppedDetailsFilterSensitiveLog;
exports.ChainedInvokeSucceededDetailsFilterSensitiveLog =
  ChainedInvokeSucceededDetailsFilterSensitiveLog;
exports.ChainedInvokeTimedOutDetailsFilterSensitiveLog =
  ChainedInvokeTimedOutDetailsFilterSensitiveLog;
exports.CheckpointDurableExecutionCommand = CheckpointDurableExecutionCommand;
exports.CheckpointDurableExecutionRequestFilterSensitiveLog =
  CheckpointDurableExecutionRequestFilterSensitiveLog;
exports.CheckpointDurableExecutionResponseFilterSensitiveLog =
  CheckpointDurableExecutionResponseFilterSensitiveLog;
exports.CheckpointUpdatedExecutionStateFilterSensitiveLog =
  CheckpointUpdatedExecutionStateFilterSensitiveLog;
exports.CodeSigningConfigNotFoundException = CodeSigningConfigNotFoundException;
exports.CodeSigningPolicy = CodeSigningPolicy;
exports.CodeStorageExceededException = CodeStorageExceededException;
exports.CodeVerificationFailedException = CodeVerificationFailedException;
exports.ContextDetailsFilterSensitiveLog = ContextDetailsFilterSensitiveLog;
exports.ContextFailedDetailsFilterSensitiveLog =
  ContextFailedDetailsFilterSensitiveLog;
exports.ContextSucceededDetailsFilterSensitiveLog =
  ContextSucceededDetailsFilterSensitiveLog;
exports.CreateAliasCommand = CreateAliasCommand;
exports.CreateCodeSigningConfigCommand = CreateCodeSigningConfigCommand;
exports.CreateEventSourceMappingCommand = CreateEventSourceMappingCommand;
exports.CreateFunctionCommand = CreateFunctionCommand;
exports.CreateFunctionRequestFilterSensitiveLog =
  CreateFunctionRequestFilterSensitiveLog;
exports.CreateFunctionUrlConfigCommand = CreateFunctionUrlConfigCommand;
exports.DeleteAliasCommand = DeleteAliasCommand;
exports.DeleteCodeSigningConfigCommand = DeleteCodeSigningConfigCommand;
exports.DeleteEventSourceMappingCommand = DeleteEventSourceMappingCommand;
exports.DeleteFunctionCodeSigningConfigCommand =
  DeleteFunctionCodeSigningConfigCommand;
exports.DeleteFunctionCommand = DeleteFunctionCommand;
exports.DeleteFunctionConcurrencyCommand = DeleteFunctionConcurrencyCommand;
exports.DeleteFunctionEventInvokeConfigCommand =
  DeleteFunctionEventInvokeConfigCommand;
exports.DeleteFunctionUrlConfigCommand = DeleteFunctionUrlConfigCommand;
exports.DeleteLayerVersionCommand = DeleteLayerVersionCommand;
exports.DeleteProvisionedConcurrencyConfigCommand =
  DeleteProvisionedConcurrencyConfigCommand;
exports.DurableExecutionAlreadyStartedException =
  DurableExecutionAlreadyStartedException;
exports.EC2AccessDeniedException = EC2AccessDeniedException;
exports.EC2ThrottledException = EC2ThrottledException;
exports.EC2UnexpectedException = EC2UnexpectedException;
exports.EFSIOException = EFSIOException;
exports.EFSMountConnectivityException = EFSMountConnectivityException;
exports.EFSMountFailureException = EFSMountFailureException;
exports.EFSMountTimeoutException = EFSMountTimeoutException;
exports.ENILimitReachedException = ENILimitReachedException;
exports.EndPointType = EndPointType;
exports.EnvironmentErrorFilterSensitiveLog = EnvironmentErrorFilterSensitiveLog;
exports.EnvironmentFilterSensitiveLog = EnvironmentFilterSensitiveLog;
exports.EnvironmentResponseFilterSensitiveLog =
  EnvironmentResponseFilterSensitiveLog;
exports.ErrorObjectFilterSensitiveLog = ErrorObjectFilterSensitiveLog;
exports.EventErrorFilterSensitiveLog = EventErrorFilterSensitiveLog;
exports.EventFilterSensitiveLog = EventFilterSensitiveLog;
exports.EventInputFilterSensitiveLog = EventInputFilterSensitiveLog;
exports.EventResultFilterSensitiveLog = EventResultFilterSensitiveLog;
exports.EventSourceMappingMetric = EventSourceMappingMetric;
exports.EventSourcePosition = EventSourcePosition;
exports.EventType = EventType;
exports.ExecutionDetailsFilterSensitiveLog = ExecutionDetailsFilterSensitiveLog;
exports.ExecutionFailedDetailsFilterSensitiveLog =
  ExecutionFailedDetailsFilterSensitiveLog;
exports.ExecutionStartedDetailsFilterSensitiveLog =
  ExecutionStartedDetailsFilterSensitiveLog;
exports.ExecutionStatus = ExecutionStatus;
exports.ExecutionStoppedDetailsFilterSensitiveLog =
  ExecutionStoppedDetailsFilterSensitiveLog;
exports.ExecutionSucceededDetailsFilterSensitiveLog =
  ExecutionSucceededDetailsFilterSensitiveLog;
exports.ExecutionTimedOutDetailsFilterSensitiveLog =
  ExecutionTimedOutDetailsFilterSensitiveLog;
exports.FullDocument = FullDocument;
exports.FunctionCodeFilterSensitiveLog = FunctionCodeFilterSensitiveLog;
exports.FunctionConfigurationFilterSensitiveLog =
  FunctionConfigurationFilterSensitiveLog;
exports.FunctionResponseType = FunctionResponseType;
exports.FunctionUrlAuthType = FunctionUrlAuthType;
exports.FunctionVersion = FunctionVersion;
exports.GetAccountSettingsCommand = GetAccountSettingsCommand;
exports.GetAliasCommand = GetAliasCommand;
exports.GetCodeSigningConfigCommand = GetCodeSigningConfigCommand;
exports.GetDurableExecutionCommand = GetDurableExecutionCommand;
exports.GetDurableExecutionHistoryCommand = GetDurableExecutionHistoryCommand;
exports.GetDurableExecutionHistoryResponseFilterSensitiveLog =
  GetDurableExecutionHistoryResponseFilterSensitiveLog;
exports.GetDurableExecutionResponseFilterSensitiveLog =
  GetDurableExecutionResponseFilterSensitiveLog;
exports.GetDurableExecutionStateCommand = GetDurableExecutionStateCommand;
exports.GetDurableExecutionStateResponseFilterSensitiveLog =
  GetDurableExecutionStateResponseFilterSensitiveLog;
exports.GetEventSourceMappingCommand = GetEventSourceMappingCommand;
exports.GetFunctionCodeSigningConfigCommand =
  GetFunctionCodeSigningConfigCommand;
exports.GetFunctionCommand = GetFunctionCommand;
exports.GetFunctionConcurrencyCommand = GetFunctionConcurrencyCommand;
exports.GetFunctionConfigurationCommand = GetFunctionConfigurationCommand;
exports.GetFunctionEventInvokeConfigCommand =
  GetFunctionEventInvokeConfigCommand;
exports.GetFunctionRecursionConfigCommand = GetFunctionRecursionConfigCommand;
exports.GetFunctionResponseFilterSensitiveLog =
  GetFunctionResponseFilterSensitiveLog;
exports.GetFunctionUrlConfigCommand = GetFunctionUrlConfigCommand;
exports.GetLayerVersionByArnCommand = GetLayerVersionByArnCommand;
exports.GetLayerVersionCommand = GetLayerVersionCommand;
exports.GetLayerVersionPolicyCommand = GetLayerVersionPolicyCommand;
exports.GetPolicyCommand = GetPolicyCommand;
exports.GetProvisionedConcurrencyConfigCommand =
  GetProvisionedConcurrencyConfigCommand;
exports.GetRuntimeManagementConfigCommand = GetRuntimeManagementConfigCommand;
exports.ImageConfigErrorFilterSensitiveLog = ImageConfigErrorFilterSensitiveLog;
exports.ImageConfigResponseFilterSensitiveLog =
  ImageConfigResponseFilterSensitiveLog;
exports.InvalidCodeSignatureException = InvalidCodeSignatureException;
exports.InvalidParameterValueException = InvalidParameterValueException;
exports.InvalidRequestContentException = InvalidRequestContentException;
exports.InvalidRuntimeException = InvalidRuntimeException;
exports.InvalidSecurityGroupIDException = InvalidSecurityGroupIDException;
exports.InvalidSubnetIDException = InvalidSubnetIDException;
exports.InvalidZipFileException = InvalidZipFileException;
exports.InvocationCompletedDetailsFilterSensitiveLog =
  InvocationCompletedDetailsFilterSensitiveLog;
exports.InvocationRequestFilterSensitiveLog =
  InvocationRequestFilterSensitiveLog;
exports.InvocationResponseFilterSensitiveLog =
  InvocationResponseFilterSensitiveLog;
exports.InvocationType = InvocationType;
exports.InvokeAsyncCommand = InvokeAsyncCommand;
exports.InvokeAsyncRequestFilterSensitiveLog =
  InvokeAsyncRequestFilterSensitiveLog;
exports.InvokeCommand = InvokeCommand;
exports.InvokeMode = InvokeMode;
exports.InvokeResponseStreamUpdateFilterSensitiveLog =
  InvokeResponseStreamUpdateFilterSensitiveLog;
exports.InvokeWithResponseStreamCommand = InvokeWithResponseStreamCommand;
exports.InvokeWithResponseStreamRequestFilterSensitiveLog =
  InvokeWithResponseStreamRequestFilterSensitiveLog;
exports.InvokeWithResponseStreamResponseEventFilterSensitiveLog =
  InvokeWithResponseStreamResponseEventFilterSensitiveLog;
exports.InvokeWithResponseStreamResponseFilterSensitiveLog =
  InvokeWithResponseStreamResponseFilterSensitiveLog;
exports.KMSAccessDeniedException = KMSAccessDeniedException;
exports.KMSDisabledException = KMSDisabledException;
exports.KMSInvalidStateException = KMSInvalidStateException;
exports.KMSNotFoundException = KMSNotFoundException;
exports.KafkaSchemaRegistryAuthType = KafkaSchemaRegistryAuthType;
exports.KafkaSchemaValidationAttribute = KafkaSchemaValidationAttribute;
exports.Lambda = Lambda;
exports.LambdaClient = LambdaClient;
exports.LambdaServiceException = LambdaServiceException;
exports.LastUpdateStatus = LastUpdateStatus;
exports.LastUpdateStatusReasonCode = LastUpdateStatusReasonCode;
exports.LayerVersionContentInputFilterSensitiveLog =
  LayerVersionContentInputFilterSensitiveLog;
exports.ListAliasesCommand = ListAliasesCommand;
exports.ListCodeSigningConfigsCommand = ListCodeSigningConfigsCommand;
exports.ListDurableExecutionsByFunctionCommand =
  ListDurableExecutionsByFunctionCommand;
exports.ListEventSourceMappingsCommand = ListEventSourceMappingsCommand;
exports.ListFunctionEventInvokeConfigsCommand =
  ListFunctionEventInvokeConfigsCommand;
exports.ListFunctionUrlConfigsCommand = ListFunctionUrlConfigsCommand;
exports.ListFunctionsByCodeSigningConfigCommand =
  ListFunctionsByCodeSigningConfigCommand;
exports.ListFunctionsCommand = ListFunctionsCommand;
exports.ListFunctionsResponseFilterSensitiveLog =
  ListFunctionsResponseFilterSensitiveLog;
exports.ListLayerVersionsCommand = ListLayerVersionsCommand;
exports.ListLayersCommand = ListLayersCommand;
exports.ListProvisionedConcurrencyConfigsCommand =
  ListProvisionedConcurrencyConfigsCommand;
exports.ListTagsCommand = ListTagsCommand;
exports.ListVersionsByFunctionCommand = ListVersionsByFunctionCommand;
exports.ListVersionsByFunctionResponseFilterSensitiveLog =
  ListVersionsByFunctionResponseFilterSensitiveLog;
exports.LogFormat = LogFormat;
exports.LogType = LogType;
exports.OperationAction = OperationAction;
exports.OperationFilterSensitiveLog = OperationFilterSensitiveLog;
exports.OperationStatus = OperationStatus;
exports.OperationType = OperationType;
exports.OperationUpdateFilterSensitiveLog = OperationUpdateFilterSensitiveLog;
exports.PackageType = PackageType;
exports.PolicyLengthExceededException = PolicyLengthExceededException;
exports.PreconditionFailedException = PreconditionFailedException;
exports.ProvisionedConcurrencyConfigNotFoundException =
  ProvisionedConcurrencyConfigNotFoundException;
exports.ProvisionedConcurrencyStatusEnum = ProvisionedConcurrencyStatusEnum;
exports.PublishLayerVersionCommand = PublishLayerVersionCommand;
exports.PublishLayerVersionRequestFilterSensitiveLog =
  PublishLayerVersionRequestFilterSensitiveLog;
exports.PublishVersionCommand = PublishVersionCommand;
exports.PutFunctionCodeSigningConfigCommand =
  PutFunctionCodeSigningConfigCommand;
exports.PutFunctionConcurrencyCommand = PutFunctionConcurrencyCommand;
exports.PutFunctionEventInvokeConfigCommand =
  PutFunctionEventInvokeConfigCommand;
exports.PutFunctionRecursionConfigCommand = PutFunctionRecursionConfigCommand;
exports.PutProvisionedConcurrencyConfigCommand =
  PutProvisionedConcurrencyConfigCommand;
exports.PutRuntimeManagementConfigCommand = PutRuntimeManagementConfigCommand;
exports.RecursiveInvocationException = RecursiveInvocationException;
exports.RecursiveLoop = RecursiveLoop;
exports.RemoveLayerVersionPermissionCommand =
  RemoveLayerVersionPermissionCommand;
exports.RemovePermissionCommand = RemovePermissionCommand;
exports.RequestTooLargeException = RequestTooLargeException;
exports.ResourceConflictException = ResourceConflictException;
exports.ResourceInUseException = ResourceInUseException;
exports.ResourceNotFoundException = ResourceNotFoundException;
exports.ResourceNotReadyException = ResourceNotReadyException;
exports.ResponseStreamingInvocationType = ResponseStreamingInvocationType;
exports.Runtime = Runtime;
exports.RuntimeVersionConfigFilterSensitiveLog =
  RuntimeVersionConfigFilterSensitiveLog;
exports.RuntimeVersionErrorFilterSensitiveLog =
  RuntimeVersionErrorFilterSensitiveLog;
exports.SchemaRegistryEventRecordFormat = SchemaRegistryEventRecordFormat;
exports.SendDurableExecutionCallbackFailureCommand =
  SendDurableExecutionCallbackFailureCommand;
exports.SendDurableExecutionCallbackFailureRequestFilterSensitiveLog =
  SendDurableExecutionCallbackFailureRequestFilterSensitiveLog;
exports.SendDurableExecutionCallbackHeartbeatCommand =
  SendDurableExecutionCallbackHeartbeatCommand;
exports.SendDurableExecutionCallbackSuccessCommand =
  SendDurableExecutionCallbackSuccessCommand;
exports.SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog =
  SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog;
exports.ServiceException = ServiceException;
exports.SnapStartApplyOn = SnapStartApplyOn;
exports.SnapStartException = SnapStartException;
exports.SnapStartNotReadyException = SnapStartNotReadyException;
exports.SnapStartOptimizationStatus = SnapStartOptimizationStatus;
exports.SnapStartTimeoutException = SnapStartTimeoutException;
exports.SourceAccessType = SourceAccessType;
exports.State = State;
exports.StateReasonCode = StateReasonCode;
exports.StepDetailsFilterSensitiveLog = StepDetailsFilterSensitiveLog;
exports.StepFailedDetailsFilterSensitiveLog =
  StepFailedDetailsFilterSensitiveLog;
exports.StepSucceededDetailsFilterSensitiveLog =
  StepSucceededDetailsFilterSensitiveLog;
exports.StopDurableExecutionCommand = StopDurableExecutionCommand;
exports.StopDurableExecutionRequestFilterSensitiveLog =
  StopDurableExecutionRequestFilterSensitiveLog;
exports.SubnetIPAddressLimitReachedException =
  SubnetIPAddressLimitReachedException;
exports.SystemLogLevel = SystemLogLevel;
exports.TagResourceCommand = TagResourceCommand;
exports.ThrottleReason = ThrottleReason;
exports.TooManyRequestsException = TooManyRequestsException;
exports.TracingMode = TracingMode;
exports.UnsupportedMediaTypeException = UnsupportedMediaTypeException;
exports.UntagResourceCommand = UntagResourceCommand;
exports.UpdateAliasCommand = UpdateAliasCommand;
exports.UpdateCodeSigningConfigCommand = UpdateCodeSigningConfigCommand;
exports.UpdateEventSourceMappingCommand = UpdateEventSourceMappingCommand;
exports.UpdateFunctionCodeCommand = UpdateFunctionCodeCommand;
exports.UpdateFunctionCodeRequestFilterSensitiveLog =
  UpdateFunctionCodeRequestFilterSensitiveLog;
exports.UpdateFunctionConfigurationCommand = UpdateFunctionConfigurationCommand;
exports.UpdateFunctionConfigurationRequestFilterSensitiveLog =
  UpdateFunctionConfigurationRequestFilterSensitiveLog;
exports.UpdateFunctionEventInvokeConfigCommand =
  UpdateFunctionEventInvokeConfigCommand;
exports.UpdateFunctionUrlConfigCommand = UpdateFunctionUrlConfigCommand;
exports.UpdateRuntimeOn = UpdateRuntimeOn;
exports.WaitCancelledDetailsFilterSensitiveLog =
  WaitCancelledDetailsFilterSensitiveLog;
exports.paginateGetDurableExecutionHistory = paginateGetDurableExecutionHistory;
exports.paginateGetDurableExecutionState = paginateGetDurableExecutionState;
exports.paginateListAliases = paginateListAliases;
exports.paginateListCodeSigningConfigs = paginateListCodeSigningConfigs;
exports.paginateListDurableExecutionsByFunction =
  paginateListDurableExecutionsByFunction;
exports.paginateListEventSourceMappings = paginateListEventSourceMappings;
exports.paginateListFunctionEventInvokeConfigs =
  paginateListFunctionEventInvokeConfigs;
exports.paginateListFunctionUrlConfigs = paginateListFunctionUrlConfigs;
exports.paginateListFunctions = paginateListFunctions;
exports.paginateListFunctionsByCodeSigningConfig =
  paginateListFunctionsByCodeSigningConfig;
exports.paginateListLayerVersions = paginateListLayerVersions;
exports.paginateListLayers = paginateListLayers;
exports.paginateListProvisionedConcurrencyConfigs =
  paginateListProvisionedConcurrencyConfigs;
exports.paginateListVersionsByFunction = paginateListVersionsByFunction;
exports.waitForFunctionActive = waitForFunctionActive;
exports.waitForFunctionActiveV2 = waitForFunctionActiveV2;
exports.waitForFunctionExists = waitForFunctionExists;
exports.waitForFunctionUpdated = waitForFunctionUpdated;
exports.waitForFunctionUpdatedV2 = waitForFunctionUpdatedV2;
exports.waitForPublishedVersionActive = waitForPublishedVersionActive;
exports.waitUntilFunctionActive = waitUntilFunctionActive;
exports.waitUntilFunctionActiveV2 = waitUntilFunctionActiveV2;
exports.waitUntilFunctionExists = waitUntilFunctionExists;
exports.waitUntilFunctionUpdated = waitUntilFunctionUpdated;
exports.waitUntilFunctionUpdatedV2 = waitUntilFunctionUpdatedV2;
exports.waitUntilPublishedVersionActive = waitUntilPublishedVersionActive;
