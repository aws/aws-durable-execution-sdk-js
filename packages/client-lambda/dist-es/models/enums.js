export const ThrottleReason = {
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
export const FunctionUrlAuthType = {
  AWS_IAM: "AWS_IAM",
  NONE: "NONE",
};
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
export const OperationType = {
  CALLBACK: "CALLBACK",
  CHAINED_INVOKE: "CHAINED_INVOKE",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  STEP: "STEP",
  WAIT: "WAIT",
};
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
export const Runtime = {
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
export const SnapStartApplyOn = {
  None: "None",
  PublishedVersions: "PublishedVersions",
};
export const TracingMode = {
  Active: "Active",
  PassThrough: "PassThrough",
};
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
  Failed: "Failed",
  Inactive: "Inactive",
  Pending: "Pending",
};
export const StateReasonCode = {
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
export const InvokeMode = {
  BUFFERED: "BUFFERED",
  RESPONSE_STREAM: "RESPONSE_STREAM",
};
export const RecursiveLoop = {
  Allow: "Allow",
  Terminate: "Terminate",
};
export const UpdateRuntimeOn = {
  Auto: "Auto",
  FunctionUpdate: "FunctionUpdate",
  Manual: "Manual",
};
export const InvocationType = {
  DryRun: "DryRun",
  Event: "Event",
  RequestResponse: "RequestResponse",
};
export const LogType = {
  None: "None",
  Tail: "Tail",
};
export const ResponseStreamingInvocationType = {
  DryRun: "DryRun",
  RequestResponse: "RequestResponse",
};
export const FunctionVersion = {
  ALL: "ALL",
};
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
export const EventType = {
  CallbackFailed: "CallbackFailed",
  CallbackStarted: "CallbackStarted",
  CallbackSucceeded: "CallbackSucceeded",
  CallbackTimedOut: "CallbackTimedOut",
  ChainedInvokeFailed: "ChainedInvokeFailed",
  ChainedInvokeStarted: "ChainedInvokeStarted",
  ChainedInvokeStopped: "ChainedInvokeStopped",
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
