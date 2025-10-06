"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AddLayerVersionPermissionCommand: () => AddLayerVersionPermissionCommand,
  AddPermissionCommand: () => AddPermissionCommand,
  ApplicationLogLevel: () => ApplicationLogLevel,
  Architecture: () => Architecture,
  CallbackDetailsFilterSensitiveLog: () => CallbackDetailsFilterSensitiveLog,
  CallbackFailedDetailsFilterSensitiveLog: () =>
    CallbackFailedDetailsFilterSensitiveLog,
  CallbackSucceededDetailsFilterSensitiveLog: () =>
    CallbackSucceededDetailsFilterSensitiveLog,
  CallbackTimedOutDetailsFilterSensitiveLog: () =>
    CallbackTimedOutDetailsFilterSensitiveLog,
  CallbackTimeoutException: () => CallbackTimeoutException,
  ChainedInvokeDetailsFilterSensitiveLog: () =>
    ChainedInvokeDetailsFilterSensitiveLog,
  ChainedInvokeFailedDetailsFilterSensitiveLog: () =>
    ChainedInvokeFailedDetailsFilterSensitiveLog,
  ChainedInvokePendingDetailsFilterSensitiveLog: () =>
    ChainedInvokePendingDetailsFilterSensitiveLog,
  ChainedInvokeStoppedDetailsFilterSensitiveLog: () =>
    ChainedInvokeStoppedDetailsFilterSensitiveLog,
  ChainedInvokeSucceededDetailsFilterSensitiveLog: () =>
    ChainedInvokeSucceededDetailsFilterSensitiveLog,
  ChainedInvokeTimedOutDetailsFilterSensitiveLog: () =>
    ChainedInvokeTimedOutDetailsFilterSensitiveLog,
  CheckpointDurableExecutionCommand: () => CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequestFilterSensitiveLog: () =>
    CheckpointDurableExecutionRequestFilterSensitiveLog,
  CheckpointDurableExecutionResponseFilterSensitiveLog: () =>
    CheckpointDurableExecutionResponseFilterSensitiveLog,
  CheckpointUpdatedExecutionStateFilterSensitiveLog: () =>
    CheckpointUpdatedExecutionStateFilterSensitiveLog,
  CodeSigningConfigNotFoundException: () => CodeSigningConfigNotFoundException,
  CodeSigningPolicy: () => CodeSigningPolicy,
  CodeStorageExceededException: () => CodeStorageExceededException,
  CodeVerificationFailedException: () => CodeVerificationFailedException,
  ContextDetailsFilterSensitiveLog: () => ContextDetailsFilterSensitiveLog,
  ContextFailedDetailsFilterSensitiveLog: () =>
    ContextFailedDetailsFilterSensitiveLog,
  ContextSucceededDetailsFilterSensitiveLog: () =>
    ContextSucceededDetailsFilterSensitiveLog,
  CreateAliasCommand: () => CreateAliasCommand,
  CreateCodeSigningConfigCommand: () => CreateCodeSigningConfigCommand,
  CreateEventSourceMappingCommand: () => CreateEventSourceMappingCommand,
  CreateFunctionCommand: () => CreateFunctionCommand,
  CreateFunctionRequestFilterSensitiveLog: () =>
    CreateFunctionRequestFilterSensitiveLog,
  CreateFunctionUrlConfigCommand: () => CreateFunctionUrlConfigCommand,
  DeleteAliasCommand: () => DeleteAliasCommand,
  DeleteCodeSigningConfigCommand: () => DeleteCodeSigningConfigCommand,
  DeleteEventSourceMappingCommand: () => DeleteEventSourceMappingCommand,
  DeleteFunctionCodeSigningConfigCommand: () =>
    DeleteFunctionCodeSigningConfigCommand,
  DeleteFunctionCommand: () => DeleteFunctionCommand,
  DeleteFunctionConcurrencyCommand: () => DeleteFunctionConcurrencyCommand,
  DeleteFunctionEventInvokeConfigCommand: () =>
    DeleteFunctionEventInvokeConfigCommand,
  DeleteFunctionUrlConfigCommand: () => DeleteFunctionUrlConfigCommand,
  DeleteLayerVersionCommand: () => DeleteLayerVersionCommand,
  DeleteProvisionedConcurrencyConfigCommand: () =>
    DeleteProvisionedConcurrencyConfigCommand,
  DurableExecutionAlreadyStartedException: () =>
    DurableExecutionAlreadyStartedException,
  EC2AccessDeniedException: () => EC2AccessDeniedException,
  EC2ThrottledException: () => EC2ThrottledException,
  EC2UnexpectedException: () => EC2UnexpectedException,
  EFSIOException: () => EFSIOException,
  EFSMountConnectivityException: () => EFSMountConnectivityException,
  EFSMountFailureException: () => EFSMountFailureException,
  EFSMountTimeoutException: () => EFSMountTimeoutException,
  ENILimitReachedException: () => ENILimitReachedException,
  EndPointType: () => EndPointType,
  EnvironmentErrorFilterSensitiveLog: () => EnvironmentErrorFilterSensitiveLog,
  EnvironmentFilterSensitiveLog: () => EnvironmentFilterSensitiveLog,
  EnvironmentResponseFilterSensitiveLog: () =>
    EnvironmentResponseFilterSensitiveLog,
  ErrorObjectFilterSensitiveLog: () => ErrorObjectFilterSensitiveLog,
  EventErrorFilterSensitiveLog: () => EventErrorFilterSensitiveLog,
  EventFilterSensitiveLog: () => EventFilterSensitiveLog,
  EventInputFilterSensitiveLog: () => EventInputFilterSensitiveLog,
  EventResultFilterSensitiveLog: () => EventResultFilterSensitiveLog,
  EventSourceMappingMetric: () => EventSourceMappingMetric,
  EventSourcePosition: () => EventSourcePosition,
  EventType: () => EventType,
  ExecutionDetailsFilterSensitiveLog: () => ExecutionDetailsFilterSensitiveLog,
  ExecutionFailedDetailsFilterSensitiveLog: () =>
    ExecutionFailedDetailsFilterSensitiveLog,
  ExecutionStartedDetailsFilterSensitiveLog: () =>
    ExecutionStartedDetailsFilterSensitiveLog,
  ExecutionStatus: () => ExecutionStatus,
  ExecutionStoppedDetailsFilterSensitiveLog: () =>
    ExecutionStoppedDetailsFilterSensitiveLog,
  ExecutionSucceededDetailsFilterSensitiveLog: () =>
    ExecutionSucceededDetailsFilterSensitiveLog,
  ExecutionTimedOutDetailsFilterSensitiveLog: () =>
    ExecutionTimedOutDetailsFilterSensitiveLog,
  FullDocument: () => FullDocument,
  FunctionCodeFilterSensitiveLog: () => FunctionCodeFilterSensitiveLog,
  FunctionConfigurationFilterSensitiveLog: () =>
    FunctionConfigurationFilterSensitiveLog,
  FunctionResponseType: () => FunctionResponseType,
  FunctionUrlAuthType: () => FunctionUrlAuthType,
  FunctionVersion: () => FunctionVersion,
  GetAccountSettingsCommand: () => GetAccountSettingsCommand,
  GetAliasCommand: () => GetAliasCommand,
  GetCodeSigningConfigCommand: () => GetCodeSigningConfigCommand,
  GetDurableExecutionCommand: () => GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand: () => GetDurableExecutionHistoryCommand,
  GetDurableExecutionHistoryResponseFilterSensitiveLog: () =>
    GetDurableExecutionHistoryResponseFilterSensitiveLog,
  GetDurableExecutionResponseFilterSensitiveLog: () =>
    GetDurableExecutionResponseFilterSensitiveLog,
  GetDurableExecutionStateCommand: () => GetDurableExecutionStateCommand,
  GetDurableExecutionStateResponseFilterSensitiveLog: () =>
    GetDurableExecutionStateResponseFilterSensitiveLog,
  GetEventSourceMappingCommand: () => GetEventSourceMappingCommand,
  GetFunctionCodeSigningConfigCommand: () =>
    GetFunctionCodeSigningConfigCommand,
  GetFunctionCommand: () => GetFunctionCommand,
  GetFunctionConcurrencyCommand: () => GetFunctionConcurrencyCommand,
  GetFunctionConfigurationCommand: () => GetFunctionConfigurationCommand,
  GetFunctionEventInvokeConfigCommand: () =>
    GetFunctionEventInvokeConfigCommand,
  GetFunctionRecursionConfigCommand: () => GetFunctionRecursionConfigCommand,
  GetFunctionResponseFilterSensitiveLog: () =>
    GetFunctionResponseFilterSensitiveLog,
  GetFunctionUrlConfigCommand: () => GetFunctionUrlConfigCommand,
  GetLayerVersionByArnCommand: () => GetLayerVersionByArnCommand,
  GetLayerVersionCommand: () => GetLayerVersionCommand,
  GetLayerVersionPolicyCommand: () => GetLayerVersionPolicyCommand,
  GetPolicyCommand: () => GetPolicyCommand,
  GetProvisionedConcurrencyConfigCommand: () =>
    GetProvisionedConcurrencyConfigCommand,
  GetRuntimeManagementConfigCommand: () => GetRuntimeManagementConfigCommand,
  ImageConfigErrorFilterSensitiveLog: () => ImageConfigErrorFilterSensitiveLog,
  ImageConfigResponseFilterSensitiveLog: () =>
    ImageConfigResponseFilterSensitiveLog,
  InvalidCodeSignatureException: () => InvalidCodeSignatureException,
  InvalidParameterValueException: () => InvalidParameterValueException,
  InvalidRequestContentException: () => InvalidRequestContentException,
  InvalidRuntimeException: () => InvalidRuntimeException,
  InvalidSecurityGroupIDException: () => InvalidSecurityGroupIDException,
  InvalidSubnetIDException: () => InvalidSubnetIDException,
  InvalidZipFileException: () => InvalidZipFileException,
  InvocationCompletedDetailsFilterSensitiveLog: () =>
    InvocationCompletedDetailsFilterSensitiveLog,
  InvocationRequestFilterSensitiveLog: () =>
    InvocationRequestFilterSensitiveLog,
  InvocationResponseFilterSensitiveLog: () =>
    InvocationResponseFilterSensitiveLog,
  InvocationType: () => InvocationType,
  InvokeAsyncCommand: () => InvokeAsyncCommand,
  InvokeAsyncRequestFilterSensitiveLog: () =>
    InvokeAsyncRequestFilterSensitiveLog,
  InvokeCommand: () => InvokeCommand,
  InvokeMode: () => InvokeMode,
  InvokeResponseStreamUpdateFilterSensitiveLog: () =>
    InvokeResponseStreamUpdateFilterSensitiveLog,
  InvokeWithResponseStreamCommand: () => InvokeWithResponseStreamCommand,
  InvokeWithResponseStreamRequestFilterSensitiveLog: () =>
    InvokeWithResponseStreamRequestFilterSensitiveLog,
  InvokeWithResponseStreamResponseEvent: () =>
    InvokeWithResponseStreamResponseEvent,
  InvokeWithResponseStreamResponseEventFilterSensitiveLog: () =>
    InvokeWithResponseStreamResponseEventFilterSensitiveLog,
  InvokeWithResponseStreamResponseFilterSensitiveLog: () =>
    InvokeWithResponseStreamResponseFilterSensitiveLog,
  KMSAccessDeniedException: () => KMSAccessDeniedException,
  KMSDisabledException: () => KMSDisabledException,
  KMSInvalidStateException: () => KMSInvalidStateException,
  KMSNotFoundException: () => KMSNotFoundException,
  KafkaSchemaRegistryAuthType: () => KafkaSchemaRegistryAuthType,
  KafkaSchemaValidationAttribute: () => KafkaSchemaValidationAttribute,
  Lambda: () => Lambda,
  LambdaClient: () => LambdaClient,
  LambdaServiceException: () => LambdaServiceException,
  LastUpdateStatus: () => LastUpdateStatus,
  LastUpdateStatusReasonCode: () => LastUpdateStatusReasonCode,
  LayerVersionContentInputFilterSensitiveLog: () =>
    LayerVersionContentInputFilterSensitiveLog,
  ListAliasesCommand: () => ListAliasesCommand,
  ListCodeSigningConfigsCommand: () => ListCodeSigningConfigsCommand,
  ListDurableExecutionsByFunctionCommand: () =>
    ListDurableExecutionsByFunctionCommand,
  ListEventSourceMappingsCommand: () => ListEventSourceMappingsCommand,
  ListFunctionEventInvokeConfigsCommand: () =>
    ListFunctionEventInvokeConfigsCommand,
  ListFunctionUrlConfigsCommand: () => ListFunctionUrlConfigsCommand,
  ListFunctionsByCodeSigningConfigCommand: () =>
    ListFunctionsByCodeSigningConfigCommand,
  ListFunctionsCommand: () => ListFunctionsCommand,
  ListFunctionsResponseFilterSensitiveLog: () =>
    ListFunctionsResponseFilterSensitiveLog,
  ListLayerVersionsCommand: () => ListLayerVersionsCommand,
  ListLayersCommand: () => ListLayersCommand,
  ListProvisionedConcurrencyConfigsCommand: () =>
    ListProvisionedConcurrencyConfigsCommand,
  ListTagsCommand: () => ListTagsCommand,
  ListVersionsByFunctionCommand: () => ListVersionsByFunctionCommand,
  ListVersionsByFunctionResponseFilterSensitiveLog: () =>
    ListVersionsByFunctionResponseFilterSensitiveLog,
  LogFormat: () => LogFormat,
  LogType: () => LogType,
  OperationAction: () => OperationAction,
  OperationFilterSensitiveLog: () => OperationFilterSensitiveLog,
  OperationStatus: () => OperationStatus,
  OperationType: () => OperationType,
  OperationUpdateFilterSensitiveLog: () => OperationUpdateFilterSensitiveLog,
  PackageType: () => PackageType,
  PolicyLengthExceededException: () => PolicyLengthExceededException,
  PreconditionFailedException: () => PreconditionFailedException,
  ProvisionedConcurrencyConfigNotFoundException: () =>
    ProvisionedConcurrencyConfigNotFoundException,
  ProvisionedConcurrencyStatusEnum: () => ProvisionedConcurrencyStatusEnum,
  PublishLayerVersionCommand: () => PublishLayerVersionCommand,
  PublishLayerVersionRequestFilterSensitiveLog: () =>
    PublishLayerVersionRequestFilterSensitiveLog,
  PublishVersionCommand: () => PublishVersionCommand,
  PutFunctionCodeSigningConfigCommand: () =>
    PutFunctionCodeSigningConfigCommand,
  PutFunctionConcurrencyCommand: () => PutFunctionConcurrencyCommand,
  PutFunctionEventInvokeConfigCommand: () =>
    PutFunctionEventInvokeConfigCommand,
  PutFunctionRecursionConfigCommand: () => PutFunctionRecursionConfigCommand,
  PutProvisionedConcurrencyConfigCommand: () =>
    PutProvisionedConcurrencyConfigCommand,
  PutRuntimeManagementConfigCommand: () => PutRuntimeManagementConfigCommand,
  RecursiveInvocationException: () => RecursiveInvocationException,
  RecursiveLoop: () => RecursiveLoop,
  RemoveLayerVersionPermissionCommand: () =>
    RemoveLayerVersionPermissionCommand,
  RemovePermissionCommand: () => RemovePermissionCommand,
  RequestTooLargeException: () => RequestTooLargeException,
  ResourceConflictException: () => ResourceConflictException,
  ResourceInUseException: () => ResourceInUseException,
  ResourceNotFoundException: () => ResourceNotFoundException,
  ResourceNotReadyException: () => ResourceNotReadyException,
  ResponseStreamingInvocationType: () => ResponseStreamingInvocationType,
  Runtime: () => Runtime,
  RuntimeVersionConfigFilterSensitiveLog: () =>
    RuntimeVersionConfigFilterSensitiveLog,
  RuntimeVersionErrorFilterSensitiveLog: () =>
    RuntimeVersionErrorFilterSensitiveLog,
  SchemaRegistryEventRecordFormat: () => SchemaRegistryEventRecordFormat,
  SendDurableExecutionCallbackFailureCommand: () =>
    SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackFailureRequestFilterSensitiveLog: () =>
    SendDurableExecutionCallbackFailureRequestFilterSensitiveLog,
  SendDurableExecutionCallbackHeartbeatCommand: () =>
    SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand: () =>
    SendDurableExecutionCallbackSuccessCommand,
  SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog: () =>
    SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog,
  ServiceException: () => ServiceException,
  SnapStartApplyOn: () => SnapStartApplyOn,
  SnapStartException: () => SnapStartException,
  SnapStartNotReadyException: () => SnapStartNotReadyException,
  SnapStartOptimizationStatus: () => SnapStartOptimizationStatus,
  SnapStartTimeoutException: () => SnapStartTimeoutException,
  SourceAccessType: () => SourceAccessType,
  State: () => State,
  StateReasonCode: () => StateReasonCode,
  StepDetailsFilterSensitiveLog: () => StepDetailsFilterSensitiveLog,
  StepFailedDetailsFilterSensitiveLog: () =>
    StepFailedDetailsFilterSensitiveLog,
  StepSucceededDetailsFilterSensitiveLog: () =>
    StepSucceededDetailsFilterSensitiveLog,
  StopDurableExecutionCommand: () => StopDurableExecutionCommand,
  StopDurableExecutionRequestFilterSensitiveLog: () =>
    StopDurableExecutionRequestFilterSensitiveLog,
  SubnetIPAddressLimitReachedException: () =>
    SubnetIPAddressLimitReachedException,
  SystemLogLevel: () => SystemLogLevel,
  TagResourceCommand: () => TagResourceCommand,
  ThrottleReason: () => ThrottleReason,
  TooManyRequestsException: () => TooManyRequestsException,
  TracingMode: () => TracingMode,
  UnsupportedMediaTypeException: () => UnsupportedMediaTypeException,
  UntagResourceCommand: () => UntagResourceCommand,
  UpdateAliasCommand: () => UpdateAliasCommand,
  UpdateCodeSigningConfigCommand: () => UpdateCodeSigningConfigCommand,
  UpdateEventSourceMappingCommand: () => UpdateEventSourceMappingCommand,
  UpdateFunctionCodeCommand: () => UpdateFunctionCodeCommand,
  UpdateFunctionCodeRequestFilterSensitiveLog: () =>
    UpdateFunctionCodeRequestFilterSensitiveLog,
  UpdateFunctionConfigurationCommand: () => UpdateFunctionConfigurationCommand,
  UpdateFunctionConfigurationRequestFilterSensitiveLog: () =>
    UpdateFunctionConfigurationRequestFilterSensitiveLog,
  UpdateFunctionEventInvokeConfigCommand: () =>
    UpdateFunctionEventInvokeConfigCommand,
  UpdateFunctionUrlConfigCommand: () => UpdateFunctionUrlConfigCommand,
  UpdateRuntimeOn: () => UpdateRuntimeOn,
  WaitCancelledDetailsFilterSensitiveLog: () =>
    WaitCancelledDetailsFilterSensitiveLog,
  __Client: () => import_smithy_client.Client,
  paginateGetDurableExecutionHistory: () => paginateGetDurableExecutionHistory,
  paginateGetDurableExecutionState: () => paginateGetDurableExecutionState,
  paginateListAliases: () => paginateListAliases,
  paginateListCodeSigningConfigs: () => paginateListCodeSigningConfigs,
  paginateListDurableExecutionsByFunction: () =>
    paginateListDurableExecutionsByFunction,
  paginateListEventSourceMappings: () => paginateListEventSourceMappings,
  paginateListFunctionEventInvokeConfigs: () =>
    paginateListFunctionEventInvokeConfigs,
  paginateListFunctionUrlConfigs: () => paginateListFunctionUrlConfigs,
  paginateListFunctions: () => paginateListFunctions,
  paginateListFunctionsByCodeSigningConfig: () =>
    paginateListFunctionsByCodeSigningConfig,
  paginateListLayerVersions: () => paginateListLayerVersions,
  paginateListLayers: () => paginateListLayers,
  paginateListProvisionedConcurrencyConfigs: () =>
    paginateListProvisionedConcurrencyConfigs,
  paginateListVersionsByFunction: () => paginateListVersionsByFunction,
  waitForFunctionActive: () => waitForFunctionActive,
  waitForFunctionActiveV2: () => waitForFunctionActiveV2,
  waitForFunctionExists: () => waitForFunctionExists,
  waitForFunctionUpdated: () => waitForFunctionUpdated,
  waitForFunctionUpdatedV2: () => waitForFunctionUpdatedV2,
  waitForPublishedVersionActive: () => waitForPublishedVersionActive,
  waitUntilFunctionActive: () => waitUntilFunctionActive,
  waitUntilFunctionActiveV2: () => waitUntilFunctionActiveV2,
  waitUntilFunctionExists: () => waitUntilFunctionExists,
  waitUntilFunctionUpdated: () => waitUntilFunctionUpdated,
  waitUntilFunctionUpdatedV2: () => waitUntilFunctionUpdatedV2,
  waitUntilPublishedVersionActive: () => waitUntilPublishedVersionActive,
});
module.exports = __toCommonJS(index_exports);

// src/LambdaClient.ts
var import_middleware_host_header = require("@aws-sdk/middleware-host-header");
var import_middleware_logger = require("@aws-sdk/middleware-logger");
var import_middleware_recursion_detection = require("@aws-sdk/middleware-recursion-detection");
var import_middleware_user_agent = require("@aws-sdk/middleware-user-agent");
var import_config_resolver = require("@smithy/config-resolver");
var import_core = require("@smithy/core");
var import_eventstream_serde_config_resolver = require("@smithy/eventstream-serde-config-resolver");
var import_middleware_content_length = require("@smithy/middleware-content-length");
var import_middleware_endpoint = require("@smithy/middleware-endpoint");
var import_middleware_retry = require("@smithy/middleware-retry");

var import_httpAuthSchemeProvider = require("./auth/httpAuthSchemeProvider");

// src/endpoint/EndpointParameters.ts
var resolveClientEndpointParameters = /* @__PURE__ */ __name((options) => {
  return Object.assign(options, {
    useDualstackEndpoint: options.useDualstackEndpoint ?? false,
    useFipsEndpoint: options.useFipsEndpoint ?? false,
    defaultSigningName: "lambda",
  });
}, "resolveClientEndpointParameters");
var commonParams = {
  UseFIPS: { type: "builtInParams", name: "useFipsEndpoint" },
  Endpoint: { type: "builtInParams", name: "endpoint" },
  Region: { type: "builtInParams", name: "region" },
  UseDualStack: { type: "builtInParams", name: "useDualstackEndpoint" },
};

// src/LambdaClient.ts
var import_runtimeConfig = require("././runtimeConfig");

// src/runtimeExtensions.ts
var import_region_config_resolver = require("@aws-sdk/region-config-resolver");
var import_protocol_http = require("@smithy/protocol-http");
var import_smithy_client = require("@smithy/smithy-client");

// src/auth/httpAuthExtensionConfiguration.ts
var getHttpAuthExtensionConfiguration = /* @__PURE__ */ __name(
  (runtimeConfig) => {
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
  },
  "getHttpAuthExtensionConfiguration",
);
var resolveHttpAuthRuntimeConfig = /* @__PURE__ */ __name((config) => {
  return {
    httpAuthSchemes: config.httpAuthSchemes(),
    httpAuthSchemeProvider: config.httpAuthSchemeProvider(),
    credentials: config.credentials(),
  };
}, "resolveHttpAuthRuntimeConfig");

// src/runtimeExtensions.ts
var resolveRuntimeExtensions = /* @__PURE__ */ __name(
  (runtimeConfig, extensions) => {
    const extensionConfiguration = Object.assign(
      (0, import_region_config_resolver.getAwsRegionExtensionConfiguration)(
        runtimeConfig,
      ),
      (0, import_smithy_client.getDefaultExtensionConfiguration)(runtimeConfig),
      (0, import_protocol_http.getHttpHandlerExtensionConfiguration)(
        runtimeConfig,
      ),
      getHttpAuthExtensionConfiguration(runtimeConfig),
    );
    extensions.forEach((extension) =>
      extension.configure(extensionConfiguration),
    );
    return Object.assign(
      runtimeConfig,
      (0, import_region_config_resolver.resolveAwsRegionExtensionConfiguration)(
        extensionConfiguration,
      ),
      (0, import_smithy_client.resolveDefaultRuntimeConfig)(
        extensionConfiguration,
      ),
      (0, import_protocol_http.resolveHttpHandlerRuntimeConfig)(
        extensionConfiguration,
      ),
      resolveHttpAuthRuntimeConfig(extensionConfiguration),
    );
  },
  "resolveRuntimeExtensions",
);

// src/LambdaClient.ts
var LambdaClient = class extends import_smithy_client.Client {
  static {
    __name(this, "LambdaClient");
  }
  /**
   * The resolved configuration of LambdaClient class. This is resolved and normalized from the {@link LambdaClientConfig | constructor configuration interface}.
   */
  config;
  constructor(...[configuration]) {
    const _config_0 = (0, import_runtimeConfig.getRuntimeConfig)(
      configuration || {},
    );
    super(_config_0);
    this.initConfig = _config_0;
    const _config_1 = resolveClientEndpointParameters(_config_0);
    const _config_2 = (0, import_middleware_user_agent.resolveUserAgentConfig)(
      _config_1,
    );
    const _config_3 = (0, import_middleware_retry.resolveRetryConfig)(
      _config_2,
    );
    const _config_4 = (0, import_config_resolver.resolveRegionConfig)(
      _config_3,
    );
    const _config_5 = (0,
    import_middleware_host_header.resolveHostHeaderConfig)(_config_4);
    const _config_6 = (0, import_middleware_endpoint.resolveEndpointConfig)(
      _config_5,
    );
    const _config_7 = (0,
    import_eventstream_serde_config_resolver.resolveEventStreamSerdeConfig)(
      _config_6,
    );
    const _config_8 = (0,
    import_httpAuthSchemeProvider.resolveHttpAuthSchemeConfig)(_config_7);
    const _config_9 = resolveRuntimeExtensions(
      _config_8,
      configuration?.extensions || [],
    );
    this.config = _config_9;
    this.middlewareStack.use(
      (0, import_middleware_user_agent.getUserAgentPlugin)(this.config),
    );
    this.middlewareStack.use(
      (0, import_middleware_retry.getRetryPlugin)(this.config),
    );
    this.middlewareStack.use(
      (0, import_middleware_content_length.getContentLengthPlugin)(this.config),
    );
    this.middlewareStack.use(
      (0, import_middleware_host_header.getHostHeaderPlugin)(this.config),
    );
    this.middlewareStack.use(
      (0, import_middleware_logger.getLoggerPlugin)(this.config),
    );
    this.middlewareStack.use(
      (0, import_middleware_recursion_detection.getRecursionDetectionPlugin)(
        this.config,
      ),
    );
    this.middlewareStack.use(
      (0, import_core.getHttpAuthSchemeEndpointRuleSetPlugin)(this.config, {
        httpAuthSchemeParametersProvider:
          import_httpAuthSchemeProvider.defaultLambdaHttpAuthSchemeParametersProvider,
        identityProviderConfigProvider: /* @__PURE__ */ __name(
          async (config) =>
            new import_core.DefaultIdentityProviderConfig({
              "aws.auth#sigv4": config.credentials,
            }),
          "identityProviderConfigProvider",
        ),
      }),
    );
    this.middlewareStack.use(
      (0, import_core.getHttpSigningPlugin)(this.config),
    );
  }
  /**
   * Destroy underlying resources, like sockets. It's usually not necessary to do this.
   * However in Node.js, it's best to explicitly shut down the client's agent when it is no longer needed.
   * Otherwise, sockets might stay open for quite a long time before the server terminates them.
   */
  destroy() {
    super.destroy();
  }
};

// src/Lambda.ts

// src/commands/AddLayerVersionPermissionCommand.ts

var import_middleware_serde = require("@smithy/middleware-serde");

// src/protocols/Aws_restJson1.ts
var import_core2 = require("@aws-sdk/core");

// src/models/LambdaServiceException.ts

var LambdaServiceException = class _LambdaServiceException extends import_smithy_client.ServiceException {
  static {
    __name(this, "LambdaServiceException");
  }
  /**
   * @internal
   */
  constructor(options) {
    super(options);
    Object.setPrototypeOf(this, _LambdaServiceException.prototype);
  }
};

// src/models/models_0.ts

var InvalidParameterValueException = class _InvalidParameterValueException extends LambdaServiceException {
  static {
    __name(this, "InvalidParameterValueException");
  }
  name = "InvalidParameterValueException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidParameterValueException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidParameterValueException.prototype);
    this.Type = opts.Type;
  }
};
var PolicyLengthExceededException = class _PolicyLengthExceededException extends LambdaServiceException {
  static {
    __name(this, "PolicyLengthExceededException");
  }
  name = "PolicyLengthExceededException";
  $fault = "client";
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "PolicyLengthExceededException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _PolicyLengthExceededException.prototype);
    this.Type = opts.Type;
  }
};
var PreconditionFailedException = class _PreconditionFailedException extends LambdaServiceException {
  static {
    __name(this, "PreconditionFailedException");
  }
  name = "PreconditionFailedException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "PreconditionFailedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _PreconditionFailedException.prototype);
    this.Type = opts.Type;
  }
};
var ResourceConflictException = class _ResourceConflictException extends LambdaServiceException {
  static {
    __name(this, "ResourceConflictException");
  }
  name = "ResourceConflictException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ResourceConflictException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _ResourceConflictException.prototype);
    this.Type = opts.Type;
  }
};
var ResourceNotFoundException = class _ResourceNotFoundException extends LambdaServiceException {
  static {
    __name(this, "ResourceNotFoundException");
  }
  name = "ResourceNotFoundException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ResourceNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _ResourceNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var ServiceException = class _ServiceException extends LambdaServiceException {
  static {
    __name(this, "ServiceException");
  }
  name = "ServiceException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ServiceException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _ServiceException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var ThrottleReason = {
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
var TooManyRequestsException = class _TooManyRequestsException extends LambdaServiceException {
  static {
    __name(this, "TooManyRequestsException");
  }
  name = "TooManyRequestsException";
  $fault = "client";
  /**
   * <p>The number of seconds the caller should wait before retrying.</p>
   * @public
   */
  retryAfterSeconds;
  Type;
  Reason;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "TooManyRequestsException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _TooManyRequestsException.prototype);
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.Type = opts.Type;
    this.Reason = opts.Reason;
  }
};
var FunctionUrlAuthType = {
  AWS_IAM: "AWS_IAM",
  NONE: "NONE",
};
var KafkaSchemaRegistryAuthType = {
  BASIC_AUTH: "BASIC_AUTH",
  CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
  SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
};
var SchemaRegistryEventRecordFormat = {
  JSON: "JSON",
  SOURCE: "SOURCE",
};
var KafkaSchemaValidationAttribute = {
  KEY: "KEY",
  VALUE: "VALUE",
};
var ApplicationLogLevel = {
  Debug: "DEBUG",
  Error: "ERROR",
  Fatal: "FATAL",
  Info: "INFO",
  Trace: "TRACE",
  Warn: "WARN",
};
var Architecture = {
  arm64: "arm64",
  x86_64: "x86_64",
};
var OperationAction = {
  CANCEL: "CANCEL",
  FAIL: "FAIL",
  RETRY: "RETRY",
  START: "START",
  SUCCEED: "SUCCEED",
};
var OperationType = {
  CALLBACK: "CALLBACK",
  CHAINED_INVOKE: "CHAINED_INVOKE",
  CONTEXT: "CONTEXT",
  EXECUTION: "EXECUTION",
  STEP: "STEP",
  WAIT: "WAIT",
};
var OperationStatus = {
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  PENDING: "PENDING",
  READY: "READY",
  STARTED: "STARTED",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
var CodeSigningPolicy = {
  Enforce: "Enforce",
  Warn: "Warn",
};
var FullDocument = {
  Default: "Default",
  UpdateLookup: "UpdateLookup",
};
var FunctionResponseType = {
  ReportBatchItemFailures: "ReportBatchItemFailures",
};
var EventSourceMappingMetric = {
  EventCount: "EventCount",
};
var EndPointType = {
  KAFKA_BOOTSTRAP_SERVERS: "KAFKA_BOOTSTRAP_SERVERS",
};
var SourceAccessType = {
  BASIC_AUTH: "BASIC_AUTH",
  CLIENT_CERTIFICATE_TLS_AUTH: "CLIENT_CERTIFICATE_TLS_AUTH",
  SASL_SCRAM_256_AUTH: "SASL_SCRAM_256_AUTH",
  SASL_SCRAM_512_AUTH: "SASL_SCRAM_512_AUTH",
  SERVER_ROOT_CA_CERTIFICATE: "SERVER_ROOT_CA_CERTIFICATE",
  VIRTUAL_HOST: "VIRTUAL_HOST",
  VPC_SECURITY_GROUP: "VPC_SECURITY_GROUP",
  VPC_SUBNET: "VPC_SUBNET",
};
var EventSourcePosition = {
  AT_TIMESTAMP: "AT_TIMESTAMP",
  LATEST: "LATEST",
  TRIM_HORIZON: "TRIM_HORIZON",
};
var ResourceInUseException = class _ResourceInUseException extends LambdaServiceException {
  static {
    __name(this, "ResourceInUseException");
  }
  name = "ResourceInUseException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ResourceInUseException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _ResourceInUseException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var CodeSigningConfigNotFoundException = class _CodeSigningConfigNotFoundException extends LambdaServiceException {
  static {
    __name(this, "CodeSigningConfigNotFoundException");
  }
  name = "CodeSigningConfigNotFoundException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "CodeSigningConfigNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _CodeSigningConfigNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var CodeStorageExceededException = class _CodeStorageExceededException extends LambdaServiceException {
  static {
    __name(this, "CodeStorageExceededException");
  }
  name = "CodeStorageExceededException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "CodeStorageExceededException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _CodeStorageExceededException.prototype);
    this.Type = opts.Type;
  }
};
var CodeVerificationFailedException = class _CodeVerificationFailedException extends LambdaServiceException {
  static {
    __name(this, "CodeVerificationFailedException");
  }
  name = "CodeVerificationFailedException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "CodeVerificationFailedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _CodeVerificationFailedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var LogFormat = {
  Json: "JSON",
  Text: "Text",
};
var SystemLogLevel = {
  Debug: "DEBUG",
  Info: "INFO",
  Warn: "WARN",
};
var PackageType = {
  Image: "Image",
  Zip: "Zip",
};
var Runtime = {
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
var SnapStartApplyOn = {
  None: "None",
  PublishedVersions: "PublishedVersions",
};
var TracingMode = {
  Active: "Active",
  PassThrough: "PassThrough",
};
var LastUpdateStatus = {
  Failed: "Failed",
  InProgress: "InProgress",
  Successful: "Successful",
};
var LastUpdateStatusReasonCode = {
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
var SnapStartOptimizationStatus = {
  Off: "Off",
  On: "On",
};
var State = {
  Active: "Active",
  Failed: "Failed",
  Inactive: "Inactive",
  Pending: "Pending",
};
var StateReasonCode = {
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
var InvalidCodeSignatureException = class _InvalidCodeSignatureException extends LambdaServiceException {
  static {
    __name(this, "InvalidCodeSignatureException");
  }
  name = "InvalidCodeSignatureException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidCodeSignatureException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidCodeSignatureException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvokeMode = {
  BUFFERED: "BUFFERED",
  RESPONSE_STREAM: "RESPONSE_STREAM",
};
var RecursiveLoop = {
  Allow: "Allow",
  Terminate: "Terminate",
};
var UpdateRuntimeOn = {
  Auto: "Auto",
  FunctionUpdate: "FunctionUpdate",
  Manual: "Manual",
};
var DurableExecutionAlreadyStartedException = class _DurableExecutionAlreadyStartedException extends LambdaServiceException {
  static {
    __name(this, "DurableExecutionAlreadyStartedException");
  }
  name = "DurableExecutionAlreadyStartedException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "DurableExecutionAlreadyStartedException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(
      this,
      _DurableExecutionAlreadyStartedException.prototype,
    );
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EC2AccessDeniedException = class _EC2AccessDeniedException extends LambdaServiceException {
  static {
    __name(this, "EC2AccessDeniedException");
  }
  name = "EC2AccessDeniedException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EC2AccessDeniedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _EC2AccessDeniedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EC2ThrottledException = class _EC2ThrottledException extends LambdaServiceException {
  static {
    __name(this, "EC2ThrottledException");
  }
  name = "EC2ThrottledException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EC2ThrottledException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _EC2ThrottledException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EC2UnexpectedException = class _EC2UnexpectedException extends LambdaServiceException {
  static {
    __name(this, "EC2UnexpectedException");
  }
  name = "EC2UnexpectedException";
  $fault = "server";
  Type;
  Message;
  EC2ErrorCode;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EC2UnexpectedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _EC2UnexpectedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
    this.EC2ErrorCode = opts.EC2ErrorCode;
  }
};
var EFSIOException = class _EFSIOException extends LambdaServiceException {
  static {
    __name(this, "EFSIOException");
  }
  name = "EFSIOException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EFSIOException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _EFSIOException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EFSMountConnectivityException = class _EFSMountConnectivityException extends LambdaServiceException {
  static {
    __name(this, "EFSMountConnectivityException");
  }
  name = "EFSMountConnectivityException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EFSMountConnectivityException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _EFSMountConnectivityException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EFSMountFailureException = class _EFSMountFailureException extends LambdaServiceException {
  static {
    __name(this, "EFSMountFailureException");
  }
  name = "EFSMountFailureException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EFSMountFailureException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _EFSMountFailureException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var EFSMountTimeoutException = class _EFSMountTimeoutException extends LambdaServiceException {
  static {
    __name(this, "EFSMountTimeoutException");
  }
  name = "EFSMountTimeoutException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "EFSMountTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _EFSMountTimeoutException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var ENILimitReachedException = class _ENILimitReachedException extends LambdaServiceException {
  static {
    __name(this, "ENILimitReachedException");
  }
  name = "ENILimitReachedException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ENILimitReachedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _ENILimitReachedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvalidRequestContentException = class _InvalidRequestContentException extends LambdaServiceException {
  static {
    __name(this, "InvalidRequestContentException");
  }
  name = "InvalidRequestContentException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidRequestContentException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidRequestContentException.prototype);
    this.Type = opts.Type;
  }
};
var InvalidRuntimeException = class _InvalidRuntimeException extends LambdaServiceException {
  static {
    __name(this, "InvalidRuntimeException");
  }
  name = "InvalidRuntimeException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidRuntimeException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidRuntimeException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvalidSecurityGroupIDException = class _InvalidSecurityGroupIDException extends LambdaServiceException {
  static {
    __name(this, "InvalidSecurityGroupIDException");
  }
  name = "InvalidSecurityGroupIDException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidSecurityGroupIDException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidSecurityGroupIDException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvalidSubnetIDException = class _InvalidSubnetIDException extends LambdaServiceException {
  static {
    __name(this, "InvalidSubnetIDException");
  }
  name = "InvalidSubnetIDException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidSubnetIDException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidSubnetIDException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvalidZipFileException = class _InvalidZipFileException extends LambdaServiceException {
  static {
    __name(this, "InvalidZipFileException");
  }
  name = "InvalidZipFileException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "InvalidZipFileException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _InvalidZipFileException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var InvocationType = {
  DryRun: "DryRun",
  Event: "Event",
  RequestResponse: "RequestResponse",
};
var LogType = {
  None: "None",
  Tail: "Tail",
};
var KMSAccessDeniedException = class _KMSAccessDeniedException extends LambdaServiceException {
  static {
    __name(this, "KMSAccessDeniedException");
  }
  name = "KMSAccessDeniedException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "KMSAccessDeniedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _KMSAccessDeniedException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var KMSDisabledException = class _KMSDisabledException extends LambdaServiceException {
  static {
    __name(this, "KMSDisabledException");
  }
  name = "KMSDisabledException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "KMSDisabledException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _KMSDisabledException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var KMSInvalidStateException = class _KMSInvalidStateException extends LambdaServiceException {
  static {
    __name(this, "KMSInvalidStateException");
  }
  name = "KMSInvalidStateException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "KMSInvalidStateException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _KMSInvalidStateException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var KMSNotFoundException = class _KMSNotFoundException extends LambdaServiceException {
  static {
    __name(this, "KMSNotFoundException");
  }
  name = "KMSNotFoundException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "KMSNotFoundException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _KMSNotFoundException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var RecursiveInvocationException = class _RecursiveInvocationException extends LambdaServiceException {
  static {
    __name(this, "RecursiveInvocationException");
  }
  name = "RecursiveInvocationException";
  $fault = "client";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * <p>The exception message.</p>
   * @public
   */
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "RecursiveInvocationException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _RecursiveInvocationException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var RequestTooLargeException = class _RequestTooLargeException extends LambdaServiceException {
  static {
    __name(this, "RequestTooLargeException");
  }
  name = "RequestTooLargeException";
  $fault = "client";
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "RequestTooLargeException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _RequestTooLargeException.prototype);
    this.Type = opts.Type;
  }
};
var ResourceNotReadyException = class _ResourceNotReadyException extends LambdaServiceException {
  static {
    __name(this, "ResourceNotReadyException");
  }
  name = "ResourceNotReadyException";
  $fault = "server";
  /**
   * <p>The exception type.</p>
   * @public
   */
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ResourceNotReadyException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, _ResourceNotReadyException.prototype);
    this.Type = opts.Type;
  }
};
var SnapStartException = class _SnapStartException extends LambdaServiceException {
  static {
    __name(this, "SnapStartException");
  }
  name = "SnapStartException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "SnapStartException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _SnapStartException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var SnapStartNotReadyException = class _SnapStartNotReadyException extends LambdaServiceException {
  static {
    __name(this, "SnapStartNotReadyException");
  }
  name = "SnapStartNotReadyException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "SnapStartNotReadyException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _SnapStartNotReadyException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var SnapStartTimeoutException = class _SnapStartTimeoutException extends LambdaServiceException {
  static {
    __name(this, "SnapStartTimeoutException");
  }
  name = "SnapStartTimeoutException";
  $fault = "client";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "SnapStartTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _SnapStartTimeoutException.prototype);
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var SubnetIPAddressLimitReachedException = class _SubnetIPAddressLimitReachedException extends LambdaServiceException {
  static {
    __name(this, "SubnetIPAddressLimitReachedException");
  }
  name = "SubnetIPAddressLimitReachedException";
  $fault = "server";
  Type;
  Message;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "SubnetIPAddressLimitReachedException",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(
      this,
      _SubnetIPAddressLimitReachedException.prototype,
    );
    this.Type = opts.Type;
    this.Message = opts.Message;
  }
};
var UnsupportedMediaTypeException = class _UnsupportedMediaTypeException extends LambdaServiceException {
  static {
    __name(this, "UnsupportedMediaTypeException");
  }
  name = "UnsupportedMediaTypeException";
  $fault = "client";
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "UnsupportedMediaTypeException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _UnsupportedMediaTypeException.prototype);
    this.Type = opts.Type;
  }
};
var ResponseStreamingInvocationType = {
  DryRun: "DryRun",
  RequestResponse: "RequestResponse",
};
var InvokeWithResponseStreamResponseEvent;
((InvokeWithResponseStreamResponseEvent3) => {
  InvokeWithResponseStreamResponseEvent3.visit = /* @__PURE__ */ __name(
    (value, visitor) => {
      if (value.PayloadChunk !== void 0)
        return visitor.PayloadChunk(value.PayloadChunk);
      if (value.InvokeComplete !== void 0)
        return visitor.InvokeComplete(value.InvokeComplete);
      return visitor._(value.$unknown[0], value.$unknown[1]);
    },
    "visit",
  );
})(
  InvokeWithResponseStreamResponseEvent ||
    (InvokeWithResponseStreamResponseEvent = {}),
);
var FunctionVersion = {
  ALL: "ALL",
};
var ProvisionedConcurrencyStatusEnum = {
  FAILED: "FAILED",
  IN_PROGRESS: "IN_PROGRESS",
  READY: "READY",
};
var ExecutionStatus = {
  FAILED: "FAILED",
  RUNNING: "RUNNING",
  STOPPED: "STOPPED",
  SUCCEEDED: "SUCCEEDED",
  TIMED_OUT: "TIMED_OUT",
};
var EventType = {
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
var ProvisionedConcurrencyConfigNotFoundException = class _ProvisionedConcurrencyConfigNotFoundException extends LambdaServiceException {
  static {
    __name(this, "ProvisionedConcurrencyConfigNotFoundException");
  }
  name = "ProvisionedConcurrencyConfigNotFoundException";
  $fault = "client";
  Type;
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "ProvisionedConcurrencyConfigNotFoundException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(
      this,
      _ProvisionedConcurrencyConfigNotFoundException.prototype,
    );
    this.Type = opts.Type;
  }
};
var CallbackTimeoutException = class _CallbackTimeoutException extends LambdaServiceException {
  static {
    __name(this, "CallbackTimeoutException");
  }
  name = "CallbackTimeoutException";
  $fault = "client";
  /**
   * @internal
   */
  constructor(opts) {
    super({
      name: "CallbackTimeoutException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, _CallbackTimeoutException.prototype);
  }
};
var ErrorObjectFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.ErrorMessage && {
      ErrorMessage: import_smithy_client.SENSITIVE_STRING,
    }),
    ...(obj.ErrorType && { ErrorType: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.ErrorData && { ErrorData: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.StackTrace && {
      StackTrace: import_smithy_client.SENSITIVE_STRING,
    }),
  }),
  "ErrorObjectFilterSensitiveLog",
);
var OperationUpdateFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "OperationUpdateFilterSensitiveLog",
);
var CheckpointDurableExecutionRequestFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.Updates && {
        Updates: obj.Updates.map((item) =>
          OperationUpdateFilterSensitiveLog(item),
        ),
      }),
    }),
    "CheckpointDurableExecutionRequestFilterSensitiveLog",
  );
var CallbackDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "CallbackDetailsFilterSensitiveLog",
);
var ChainedInvokeDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "ChainedInvokeDetailsFilterSensitiveLog",
);
var ContextDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "ContextDetailsFilterSensitiveLog",
);
var ExecutionDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.InputPayload && {
      InputPayload: import_smithy_client.SENSITIVE_STRING,
    }),
  }),
  "ExecutionDetailsFilterSensitiveLog",
);
var StepDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "StepDetailsFilterSensitiveLog",
);
var OperationFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.ExecutionDetails && {
      ExecutionDetails: ExecutionDetailsFilterSensitiveLog(
        obj.ExecutionDetails,
      ),
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
  }),
  "OperationFilterSensitiveLog",
);
var CheckpointUpdatedExecutionStateFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Operations && {
      Operations: obj.Operations.map((item) =>
        OperationFilterSensitiveLog(item),
      ),
    }),
  }),
  "CheckpointUpdatedExecutionStateFilterSensitiveLog",
);
var CheckpointDurableExecutionResponseFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.NewExecutionState && {
        NewExecutionState: CheckpointUpdatedExecutionStateFilterSensitiveLog(
          obj.NewExecutionState,
        ),
      }),
    }),
    "CheckpointDurableExecutionResponseFilterSensitiveLog",
  );
var FunctionCodeFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: import_smithy_client.SENSITIVE_STRING }),
  }),
  "FunctionCodeFilterSensitiveLog",
);
var EnvironmentFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: import_smithy_client.SENSITIVE_STRING }),
  }),
  "EnvironmentFilterSensitiveLog",
);
var CreateFunctionRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Code && { Code: FunctionCodeFilterSensitiveLog(obj.Code) }),
    ...(obj.Environment && {
      Environment: EnvironmentFilterSensitiveLog(obj.Environment),
    }),
  }),
  "CreateFunctionRequestFilterSensitiveLog",
);
var EnvironmentErrorFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Message && { Message: import_smithy_client.SENSITIVE_STRING }),
  }),
  "EnvironmentErrorFilterSensitiveLog",
);
var EnvironmentResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Variables && { Variables: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: EnvironmentErrorFilterSensitiveLog(obj.Error) }),
  }),
  "EnvironmentResponseFilterSensitiveLog",
);
var ImageConfigErrorFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Message && { Message: import_smithy_client.SENSITIVE_STRING }),
  }),
  "ImageConfigErrorFilterSensitiveLog",
);
var ImageConfigResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: ImageConfigErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ImageConfigResponseFilterSensitiveLog",
);
var RuntimeVersionErrorFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Message && { Message: import_smithy_client.SENSITIVE_STRING }),
  }),
  "RuntimeVersionErrorFilterSensitiveLog",
);
var RuntimeVersionConfigFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && {
      Error: RuntimeVersionErrorFilterSensitiveLog(obj.Error),
    }),
  }),
  "RuntimeVersionConfigFilterSensitiveLog",
);
var FunctionConfigurationFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
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
  }),
  "FunctionConfigurationFilterSensitiveLog",
);
var GetFunctionResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Configuration && {
      Configuration: FunctionConfigurationFilterSensitiveLog(obj.Configuration),
    }),
  }),
  "GetFunctionResponseFilterSensitiveLog",
);
var InvocationRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "InvocationRequestFilterSensitiveLog",
);
var InvocationResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "InvocationResponseFilterSensitiveLog",
);
var InvokeAsyncRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
  }),
  "InvokeAsyncRequestFilterSensitiveLog",
);
var InvokeWithResponseStreamRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "InvokeWithResponseStreamRequestFilterSensitiveLog",
);
var InvokeResponseStreamUpdateFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "InvokeResponseStreamUpdateFilterSensitiveLog",
);
var InvokeWithResponseStreamResponseEventFilterSensitiveLog =
  /* @__PURE__ */ __name((obj) => {
    if (obj.PayloadChunk !== void 0)
      return {
        PayloadChunk: InvokeResponseStreamUpdateFilterSensitiveLog(
          obj.PayloadChunk,
        ),
      };
    if (obj.InvokeComplete !== void 0)
      return { InvokeComplete: obj.InvokeComplete };
    if (obj.$unknown !== void 0) return { [obj.$unknown[0]]: "UNKNOWN" };
  }, "InvokeWithResponseStreamResponseEventFilterSensitiveLog");
var InvokeWithResponseStreamResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.EventStream && { EventStream: "STREAMING_CONTENT" }),
  }),
  "InvokeWithResponseStreamResponseFilterSensitiveLog",
);
var ListFunctionsResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Functions && {
      Functions: obj.Functions.map((item) =>
        FunctionConfigurationFilterSensitiveLog(item),
      ),
    }),
  }),
  "ListFunctionsResponseFilterSensitiveLog",
);
var UpdateFunctionCodeRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: import_smithy_client.SENSITIVE_STRING }),
  }),
  "UpdateFunctionCodeRequestFilterSensitiveLog",
);
var UpdateFunctionConfigurationRequestFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.Environment && {
        Environment: EnvironmentFilterSensitiveLog(obj.Environment),
      }),
    }),
    "UpdateFunctionConfigurationRequestFilterSensitiveLog",
  );
var ListVersionsByFunctionResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Versions && {
      Versions: obj.Versions.map((item) =>
        FunctionConfigurationFilterSensitiveLog(item),
      ),
    }),
  }),
  "ListVersionsByFunctionResponseFilterSensitiveLog",
);
var GetDurableExecutionResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.InputPayload && {
      InputPayload: import_smithy_client.SENSITIVE_STRING,
    }),
    ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "GetDurableExecutionResponseFilterSensitiveLog",
);
var EventErrorFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: ErrorObjectFilterSensitiveLog(obj.Payload) }),
  }),
  "EventErrorFilterSensitiveLog",
);
var CallbackFailedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "CallbackFailedDetailsFilterSensitiveLog",
);
var EventResultFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "EventResultFilterSensitiveLog",
);
var CallbackSucceededDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
  }),
  "CallbackSucceededDetailsFilterSensitiveLog",
);
var CallbackTimedOutDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "CallbackTimedOutDetailsFilterSensitiveLog",
);
var ChainedInvokeFailedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ChainedInvokeFailedDetailsFilterSensitiveLog",
);
var EventInputFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Payload && { Payload: import_smithy_client.SENSITIVE_STRING }),
  }),
  "EventInputFilterSensitiveLog",
);
var ChainedInvokePendingDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
  }),
  "ChainedInvokePendingDetailsFilterSensitiveLog",
);
var ChainedInvokeStoppedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ChainedInvokeStoppedDetailsFilterSensitiveLog",
);
var ChainedInvokeSucceededDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
  }),
  "ChainedInvokeSucceededDetailsFilterSensitiveLog",
);
var ChainedInvokeTimedOutDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ChainedInvokeTimedOutDetailsFilterSensitiveLog",
);
var ContextFailedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ContextFailedDetailsFilterSensitiveLog",
);
var ContextSucceededDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
  }),
  "ContextSucceededDetailsFilterSensitiveLog",
);
var ExecutionFailedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ExecutionFailedDetailsFilterSensitiveLog",
);
var ExecutionStartedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Input && { Input: EventInputFilterSensitiveLog(obj.Input) }),
  }),
  "ExecutionStartedDetailsFilterSensitiveLog",
);
var ExecutionStoppedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ExecutionStoppedDetailsFilterSensitiveLog",
);
var ExecutionSucceededDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
  }),
  "ExecutionSucceededDetailsFilterSensitiveLog",
);
var ExecutionTimedOutDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "ExecutionTimedOutDetailsFilterSensitiveLog",
);
var InvocationCompletedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "InvocationCompletedDetailsFilterSensitiveLog",
);
var StepFailedDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "StepFailedDetailsFilterSensitiveLog",
);
var StepSucceededDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Result && { Result: EventResultFilterSensitiveLog(obj.Result) }),
  }),
  "StepSucceededDetailsFilterSensitiveLog",
);
var WaitCancelledDetailsFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: EventErrorFilterSensitiveLog(obj.Error) }),
  }),
  "WaitCancelledDetailsFilterSensitiveLog",
);
var EventFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
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
      ChainedInvokePendingDetails:
        ChainedInvokePendingDetailsFilterSensitiveLog(
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
      ChainedInvokeStoppedDetails:
        ChainedInvokeStoppedDetailsFilterSensitiveLog(
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
  }),
  "EventFilterSensitiveLog",
);
var GetDurableExecutionHistoryResponseFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.Events && {
        Events: obj.Events.map((item) => EventFilterSensitiveLog(item)),
      }),
    }),
    "GetDurableExecutionHistoryResponseFilterSensitiveLog",
  );
var GetDurableExecutionStateResponseFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Operations && {
      Operations: obj.Operations.map((item) =>
        OperationFilterSensitiveLog(item),
      ),
    }),
  }),
  "GetDurableExecutionStateResponseFilterSensitiveLog",
);
var LayerVersionContentInputFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.ZipFile && { ZipFile: import_smithy_client.SENSITIVE_STRING }),
  }),
  "LayerVersionContentInputFilterSensitiveLog",
);
var PublishLayerVersionRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Content && {
      Content: LayerVersionContentInputFilterSensitiveLog(obj.Content),
    }),
  }),
  "PublishLayerVersionRequestFilterSensitiveLog",
);

// src/protocols/Aws_restJson1.ts
var se_AddLayerVersionPermissionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
    const query = (0, import_smithy_client.map)({
      [_RI]: [, input[_RI]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        Action: [],
        OrganizationId: [],
        Principal: [],
        StatementId: [],
      }),
    );
    b.m("POST").h(headers).q(query).b(body);
    return b.build();
  },
  "se_AddLayerVersionPermissionCommand",
);
var se_AddPermissionCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/policy");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = (0, import_smithy_client.map)({
    [_Q]: [, input[_Q]],
  });
  let body;
  body = JSON.stringify(
    (0, import_smithy_client.take)(input, {
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
}, "se_AddPermissionCommand");
var se_CheckpointDurableExecutionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
      (0, import_smithy_client.take)(input, {
        CheckpointToken: [],
        ClientToken: [],
        Updates: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Updates",
        ),
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_CheckpointDurableExecutionCommand",
);
var se_CreateAliasCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/aliases");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  body = JSON.stringify(
    (0, import_smithy_client.take)(input, {
      Description: [],
      FunctionVersion: [],
      Name: [],
      RoutingConfig: /* @__PURE__ */ __name(
        (_) => se_AliasRoutingConfiguration(_, context),
        "RoutingConfig",
      ),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
}, "se_CreateAliasCommand");
var se_CreateCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2020-04-22/code-signing-configs");
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        AllowedPublishers: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "AllowedPublishers",
        ),
        CodeSigningPolicies: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "CodeSigningPolicies",
        ),
        Description: [],
        Tags: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Tags",
        ),
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_CreateCodeSigningConfigCommand",
);
var se_CreateEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/event-source-mappings");
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        AmazonManagedKafkaEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "AmazonManagedKafkaEventSourceConfig",
        ),
        BatchSize: [],
        BisectBatchOnFunctionError: [],
        DestinationConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DestinationConfig",
        ),
        DocumentDBEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DocumentDBEventSourceConfig",
        ),
        Enabled: [],
        EventSourceArn: [],
        FilterCriteria: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FilterCriteria",
        ),
        FunctionName: [],
        FunctionResponseTypes: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FunctionResponseTypes",
        ),
        KMSKeyArn: [],
        MaximumBatchingWindowInSeconds: [],
        MaximumRecordAgeInSeconds: [],
        MaximumRetryAttempts: [],
        MetricsConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "MetricsConfig",
        ),
        ParallelizationFactor: [],
        ProvisionedPollerConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ProvisionedPollerConfig",
        ),
        Queues: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Queues",
        ),
        ScalingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ScalingConfig",
        ),
        SelfManagedEventSource: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SelfManagedEventSource",
        ),
        SelfManagedKafkaEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SelfManagedKafkaEventSourceConfig",
        ),
        SourceAccessConfigurations: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SourceAccessConfigurations",
        ),
        StartingPosition: [],
        StartingPositionTimestamp: /* @__PURE__ */ __name(
          (_) => _.getTime() / 1e3,
          "StartingPositionTimestamp",
        ),
        Tags: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Tags",
        ),
        Topics: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Topics",
        ),
        TumblingWindowInSeconds: [],
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_CreateEventSourceMappingCommand",
);
var se_CreateFunctionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/functions");
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        Architectures: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Architectures",
        ),
        Code: /* @__PURE__ */ __name(
          (_) => se_FunctionCode(_, context),
          "Code",
        ),
        CodeSigningConfigArn: [],
        DeadLetterConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DeadLetterConfig",
        ),
        Description: [],
        DurableConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DurableConfig",
        ),
        Environment: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Environment",
        ),
        EphemeralStorage: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "EphemeralStorage",
        ),
        FileSystemConfigs: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FileSystemConfigs",
        ),
        FunctionName: [],
        Handler: [],
        ImageConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ImageConfig",
        ),
        KMSKeyArn: [],
        Layers: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Layers",
        ),
        LoggingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "LoggingConfig",
        ),
        MemorySize: [],
        PackageType: [],
        Publish: [],
        Role: [],
        Runtime: [],
        SnapStart: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SnapStart",
        ),
        Tags: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Tags",
        ),
        Timeout: [],
        TracingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "TracingConfig",
        ),
        VpcConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "VpcConfig",
        ),
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_CreateFunctionCommand",
);
var se_CreateFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        AuthType: [],
        Cors: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Cors",
        ),
        InvokeMode: [],
      }),
    );
    b.m("POST").h(headers).q(query).b(body);
    return b.build();
  },
  "se_CreateFunctionUrlConfigCommand",
);
var se_DeleteAliasCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  b.m("DELETE").h(headers).b(body);
  return b.build();
}, "se_DeleteAliasCommand");
var se_DeleteCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_DeleteCodeSigningConfigCommand",
);
var se_DeleteEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p("UUID", () => input.UUID, "{UUID}", false);
    let body;
    b.m("DELETE").h(headers).b(body);
    return b.build();
  },
  "se_DeleteEventSourceMappingCommand",
);
var se_DeleteFunctionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_DeleteFunctionCommand",
);
var se_DeleteFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    b.m("DELETE").h(headers).b(body);
    return b.build();
  },
  "se_DeleteFunctionCodeSigningConfigCommand",
);
var se_DeleteFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    b.m("DELETE").h(headers).b(body);
    return b.build();
  },
  "se_DeleteFunctionConcurrencyCommand",
);
var se_DeleteFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_DeleteFunctionEventInvokeConfigCommand",
);
var se_DeleteFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_DeleteFunctionUrlConfigCommand",
);
var se_DeleteLayerVersionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_DeleteLayerVersionCommand",
);
var se_DeleteProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, (0, import_smithy_client.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_DeleteProvisionedConcurrencyConfigCommand",
);
var se_GetAccountSettingsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2016-08-19/account-settings");
    let body;
    b.m("GET").h(headers).b(body);
    return b.build();
  },
  "se_GetAccountSettingsCommand",
);
var se_GetAliasCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
}, "se_GetAliasCommand");
var se_GetCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_GetCodeSigningConfigCommand",
);
var se_GetDurableExecutionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_GetDurableExecutionCommand",
);
var se_GetDurableExecutionHistoryCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
    b.p(
      "DurableExecutionArn",
      () => input.DurableExecutionArn,
      "{DurableExecutionArn}",
      false,
    );
    const query = (0, import_smithy_client.map)({
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
  },
  "se_GetDurableExecutionHistoryCommand",
);
var se_GetDurableExecutionStateCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/state");
    b.p(
      "DurableExecutionArn",
      () => input.DurableExecutionArn,
      "{DurableExecutionArn}",
      false,
    );
    const query = (0, import_smithy_client.map)({
      [_CT]: [
        ,
        (0, import_smithy_client.expectNonNull)(input[_CT], `CheckpointToken`),
      ],
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetDurableExecutionStateCommand",
);
var se_GetEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p("UUID", () => input.UUID, "{UUID}", false);
    let body;
    b.m("GET").h(headers).b(body);
    return b.build();
  },
  "se_GetEventSourceMappingCommand",
);
var se_GetFunctionCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = (0, import_smithy_client.map)({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
}, "se_GetFunctionCommand");
var se_GetFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    b.m("GET").h(headers).b(body);
    return b.build();
  },
  "se_GetFunctionCodeSigningConfigCommand",
);
var se_GetFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    b.m("GET").h(headers).b(body);
    return b.build();
  },
  "se_GetFunctionConcurrencyCommand",
);
var se_GetFunctionConfigurationCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetFunctionConfigurationCommand",
);
var se_GetFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetFunctionEventInvokeConfigCommand",
);
var se_GetFunctionRecursionConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    b.m("GET").h(headers).b(body);
    return b.build();
  },
  "se_GetFunctionRecursionConfigCommand",
);
var se_GetFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetFunctionUrlConfigCommand",
);
var se_GetLayerVersionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_GetLayerVersionCommand",
);
var se_GetLayerVersionByArnCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers");
    const query = (0, import_smithy_client.map)({
      [_f]: [, "LayerVersion"],
      [_A]: [, (0, import_smithy_client.expectNonNull)(input[_A], `Arn`)],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetLayerVersionByArnCommand",
);
var se_GetLayerVersionPolicyCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
  },
  "se_GetLayerVersionPolicyCommand",
);
var se_GetPolicyCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/policy");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = (0, import_smithy_client.map)({
    [_Q]: [, input[_Q]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
}, "se_GetPolicyCommand");
var se_GetProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, (0, import_smithy_client.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetProvisionedConcurrencyConfigCommand",
);
var se_GetRuntimeManagementConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_GetRuntimeManagementConfigCommand",
);
var se_InvokeCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = (0, import_smithy_client.map)(
    {},
    import_smithy_client.isSerializableHeaderValue,
    {
      "content-type": "application/octet-stream",
      [_xait]: input[_IT],
      [_xalt]: input[_LT],
      [_xacc]: input[_CC],
      [_xaden]: input[_DEN],
    },
  );
  b.bp("/2015-03-31/functions/{FunctionName}/invocations");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = (0, import_smithy_client.map)({
    [_Q]: [, input[_Q]],
  });
  let body;
  if (input.Payload !== void 0) {
    body = input.Payload;
  }
  b.m("POST").h(headers).q(query).b(body);
  return b.build();
}, "se_InvokeCommand");
var se_InvokeAsyncCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/octet-stream",
  };
  b.bp("/2014-11-13/functions/{FunctionName}/invoke-async");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  let body;
  if (input.InvokeArgs !== void 0) {
    body = input.InvokeArgs;
  }
  b.m("POST").h(headers).b(body);
  return b.build();
}, "se_InvokeAsyncCommand");
var se_InvokeWithResponseStreamCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = (0, import_smithy_client.map)(
      {},
      import_smithy_client.isSerializableHeaderValue,
      {
        "content-type": "application/octet-stream",
        [_xait]: input[_IT],
        [_xalt]: input[_LT],
        [_xacc]: input[_CC],
      },
    );
    b.bp("/2021-11-15/functions/{FunctionName}/response-streaming-invocations");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    if (input.Payload !== void 0) {
      body = input.Payload;
    }
    b.m("POST").h(headers).q(query).b(body);
    return b.build();
  },
  "se_InvokeWithResponseStreamCommand",
);
var se_ListAliasesCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions/{FunctionName}/aliases");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  const query = (0, import_smithy_client.map)({
    [_FV]: [, input[_FV]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
}, "se_ListAliasesCommand");
var se_ListCodeSigningConfigsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs");
    const query = (0, import_smithy_client.map)({
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListCodeSigningConfigsCommand",
);
var se_ListDurableExecutionsByFunctionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/functions/{FunctionName}/durable-executions");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
      [_DEN]: [, input[_DEN]],
      [_SF]: [() => input.StatusFilter !== void 0, () => input[_SF] || []],
      [_TA]: [
        () => input.TimeAfter !== void 0,
        () =>
          (0, import_smithy_client.serializeDateTime)(input[_TA]).toString(),
      ],
      [_TB]: [
        () => input.TimeBefore !== void 0,
        () =>
          (0, import_smithy_client.serializeDateTime)(input[_TB]).toString(),
      ],
      [_RO]: [() => input.ReverseOrder !== void 0, () => input[_RO].toString()],
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListDurableExecutionsByFunctionCommand",
);
var se_ListEventSourceMappingsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings");
    const query = (0, import_smithy_client.map)({
      [_ESA]: [, input[_ESA]],
      [_FN]: [, input[_FN]],
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListEventSourceMappingsCommand",
);
var se_ListFunctionEventInvokeConfigsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config/list");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListFunctionEventInvokeConfigsCommand",
);
var se_ListFunctionsCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2015-03-31/functions");
  const query = (0, import_smithy_client.map)({
    [_MR]: [, input[_MR]],
    [_FV]: [, input[_FV]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
}, "se_ListFunctionsCommand");
var se_ListFunctionsByCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}/functions");
    b.p(
      "CodeSigningConfigArn",
      () => input.CodeSigningConfigArn,
      "{CodeSigningConfigArn}",
      false,
    );
    const query = (0, import_smithy_client.map)({
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListFunctionsByCodeSigningConfigCommand",
);
var se_ListFunctionUrlConfigsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/urls");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListFunctionUrlConfigsCommand",
);
var se_ListLayersCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2018-10-31/layers");
  const query = (0, import_smithy_client.map)({
    [_CR]: [, input[_CR]],
    [_M]: [, input[_M]],
    [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    [_CA]: [, input[_CA]],
  });
  let body;
  b.m("GET").h(headers).q(query).b(body);
  return b.build();
}, "se_ListLayersCommand");
var se_ListLayerVersionsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p("LayerName", () => input.LayerName, "{LayerName}", false);
    const query = (0, import_smithy_client.map)({
      [_CR]: [, input[_CR]],
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
      [_CA]: [, input[_CA]],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListLayerVersionsCommand",
);
var se_ListProvisionedConcurrencyConfigsCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_L]: [, "ALL"],
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListProvisionedConcurrencyConfigsCommand",
);
var se_ListTagsCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  let body;
  b.m("GET").h(headers).b(body);
  return b.build();
}, "se_ListTagsCommand");
var se_ListVersionsByFunctionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_M]: [, input[_M]],
      [_MI]: [() => input.MaxItems !== void 0, () => input[_MI].toString()],
    });
    let body;
    b.m("GET").h(headers).q(query).b(body);
    return b.build();
  },
  "se_ListVersionsByFunctionCommand",
);
var se_PublishLayerVersionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p("LayerName", () => input.LayerName, "{LayerName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        CompatibleArchitectures: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "CompatibleArchitectures",
        ),
        CompatibleRuntimes: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "CompatibleRuntimes",
        ),
        Content: /* @__PURE__ */ __name(
          (_) => se_LayerVersionContentInput(_, context),
          "Content",
        ),
        Description: [],
        LicenseInfo: [],
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_PublishLayerVersionCommand",
);
var se_PublishVersionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        CodeSha256: [],
        Description: [],
        RevisionId: [],
      }),
    );
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_PublishVersionCommand",
);
var se_PutFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        CodeSigningConfigArn: [],
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_PutFunctionCodeSigningConfigCommand",
);
var se_PutFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        ReservedConcurrentExecutions: [],
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_PutFunctionConcurrencyCommand",
);
var se_PutFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        DestinationConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DestinationConfig",
        ),
        MaximumEventAgeInSeconds: [],
        MaximumRetryAttempts: [],
      }),
    );
    b.m("PUT").h(headers).q(query).b(body);
    return b.build();
  },
  "se_PutFunctionEventInvokeConfigCommand",
);
var se_PutFunctionRecursionConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        RecursiveLoop: [],
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_PutFunctionRecursionConfigCommand",
);
var se_PutProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, (0, import_smithy_client.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        ProvisionedConcurrentExecutions: [],
      }),
    );
    b.m("PUT").h(headers).q(query).b(body);
    return b.build();
  },
  "se_PutProvisionedConcurrencyConfigCommand",
);
var se_PutRuntimeManagementConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        RuntimeVersionArn: [],
        UpdateRuntimeOn: [],
      }),
    );
    b.m("PUT").h(headers).q(query).b(body);
    return b.build();
  },
  "se_PutRuntimeManagementConfigCommand",
);
var se_RemoveLayerVersionPermissionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
    const query = (0, import_smithy_client.map)({
      [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_RemoveLayerVersionPermissionCommand",
);
var se_RemovePermissionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/policy/{StatementId}");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    b.p("StatementId", () => input.StatementId, "{StatementId}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
      [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE").h(headers).q(query).b(body);
    return b.build();
  },
  "se_RemovePermissionCommand",
);
var se_SendDurableExecutionCallbackFailureCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
    b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
    let body;
    if (input.Error !== void 0) {
      body = (0, import_smithy_client._json)(input.Error);
    }
    if (body === void 0) {
      body = {};
    }
    body = JSON.stringify(body);
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_SendDurableExecutionCallbackFailureCommand",
);
var se_SendDurableExecutionCallbackHeartbeatCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
    b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
    let body;
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_SendDurableExecutionCallbackHeartbeatCommand",
);
var se_SendDurableExecutionCallbackSuccessCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/octet-stream",
    };
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/succeed");
    b.p("CallbackId", () => input.CallbackId, "{CallbackId}", false);
    let body;
    if (input.Result !== void 0) {
      body = input.Result;
    }
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_SendDurableExecutionCallbackSuccessCommand",
);
var se_StopDurableExecutionCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
    if (input.Error !== void 0) {
      body = (0, import_smithy_client._json)(input.Error);
    }
    if (body === void 0) {
      body = {};
    }
    body = JSON.stringify(body);
    b.m("POST").h(headers).b(body);
    return b.build();
  },
  "se_StopDurableExecutionCommand",
);
var se_TagResourceCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  let body;
  body = JSON.stringify(
    (0, import_smithy_client.take)(input, {
      Tags: /* @__PURE__ */ __name(
        (_) => (0, import_smithy_client._json)(_),
        "Tags",
      ),
    }),
  );
  b.m("POST").h(headers).b(body);
  return b.build();
}, "se_TagResourceCommand");
var se_UntagResourceCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {};
  b.bp("/2017-03-31/tags/{Resource}");
  b.p("Resource", () => input.Resource, "{Resource}", false);
  const query = (0, import_smithy_client.map)({
    [_tK]: [
      (0, import_smithy_client.expectNonNull)(input.TagKeys, `TagKeys`) != null,
      () => input[_TK] || [],
    ],
  });
  let body;
  b.m("DELETE").h(headers).q(query).b(body);
  return b.build();
}, "se_UntagResourceCommand");
var se_UpdateAliasCommand = /* @__PURE__ */ __name(async (input, context) => {
  const b = (0, import_core.requestBuilder)(input, context);
  const headers = {
    "content-type": "application/json",
  };
  b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
  b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
  b.p("Name", () => input.Name, "{Name}", false);
  let body;
  body = JSON.stringify(
    (0, import_smithy_client.take)(input, {
      Description: [],
      FunctionVersion: [],
      RevisionId: [],
      RoutingConfig: /* @__PURE__ */ __name(
        (_) => se_AliasRoutingConfiguration(_, context),
        "RoutingConfig",
      ),
    }),
  );
  b.m("PUT").h(headers).b(body);
  return b.build();
}, "se_UpdateAliasCommand");
var se_UpdateCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
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
      (0, import_smithy_client.take)(input, {
        AllowedPublishers: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "AllowedPublishers",
        ),
        CodeSigningPolicies: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "CodeSigningPolicies",
        ),
        Description: [],
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_UpdateCodeSigningConfigCommand",
);
var se_UpdateEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p("UUID", () => input.UUID, "{UUID}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        AmazonManagedKafkaEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "AmazonManagedKafkaEventSourceConfig",
        ),
        BatchSize: [],
        BisectBatchOnFunctionError: [],
        DestinationConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DestinationConfig",
        ),
        DocumentDBEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DocumentDBEventSourceConfig",
        ),
        Enabled: [],
        FilterCriteria: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FilterCriteria",
        ),
        FunctionName: [],
        FunctionResponseTypes: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FunctionResponseTypes",
        ),
        KMSKeyArn: [],
        MaximumBatchingWindowInSeconds: [],
        MaximumRecordAgeInSeconds: [],
        MaximumRetryAttempts: [],
        MetricsConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "MetricsConfig",
        ),
        ParallelizationFactor: [],
        ProvisionedPollerConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ProvisionedPollerConfig",
        ),
        ScalingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ScalingConfig",
        ),
        SelfManagedKafkaEventSourceConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SelfManagedKafkaEventSourceConfig",
        ),
        SourceAccessConfigurations: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SourceAccessConfigurations",
        ),
        TumblingWindowInSeconds: [],
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_UpdateEventSourceMappingCommand",
);
var se_UpdateFunctionCodeCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/functions/{FunctionName}/code");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        Architectures: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Architectures",
        ),
        DryRun: [],
        ImageUri: [],
        Publish: [],
        RevisionId: [],
        S3Bucket: [],
        S3Key: [],
        S3ObjectVersion: [],
        SourceKMSKeyArn: [],
        ZipFile: /* @__PURE__ */ __name(
          (_) => context.base64Encoder(_),
          "ZipFile",
        ),
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_UpdateFunctionCodeCommand",
);
var se_UpdateFunctionConfigurationCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        DeadLetterConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DeadLetterConfig",
        ),
        Description: [],
        DurableConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DurableConfig",
        ),
        Environment: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Environment",
        ),
        EphemeralStorage: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "EphemeralStorage",
        ),
        FileSystemConfigs: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "FileSystemConfigs",
        ),
        Handler: [],
        ImageConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "ImageConfig",
        ),
        KMSKeyArn: [],
        Layers: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Layers",
        ),
        LoggingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "LoggingConfig",
        ),
        MemorySize: [],
        RevisionId: [],
        Role: [],
        Runtime: [],
        SnapStart: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "SnapStart",
        ),
        Timeout: [],
        TracingConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "TracingConfig",
        ),
        VpcConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "VpcConfig",
        ),
      }),
    );
    b.m("PUT").h(headers).b(body);
    return b.build();
  },
  "se_UpdateFunctionConfigurationCommand",
);
var se_UpdateFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        DestinationConfig: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "DestinationConfig",
        ),
        MaximumEventAgeInSeconds: [],
        MaximumRetryAttempts: [],
      }),
    );
    b.m("POST").h(headers).q(query).b(body);
    return b.build();
  },
  "se_UpdateFunctionEventInvokeConfigCommand",
);
var se_UpdateFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (input, context) => {
    const b = (0, import_core.requestBuilder)(input, context);
    const headers = {
      "content-type": "application/json",
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p("FunctionName", () => input.FunctionName, "{FunctionName}", false);
    const query = (0, import_smithy_client.map)({
      [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(
      (0, import_smithy_client.take)(input, {
        AuthType: [],
        Cors: /* @__PURE__ */ __name(
          (_) => (0, import_smithy_client._json)(_),
          "Cors",
        ),
        InvokeMode: [],
      }),
    );
    b.m("PUT").h(headers).q(query).b(body);
    return b.build();
  },
  "se_UpdateFunctionUrlConfigCommand",
);
var de_AddLayerVersionPermissionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      RevisionId: import_smithy_client.expectString,
      Statement: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_AddLayerVersionPermissionCommand",
);
var de_AddPermissionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Statement: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_AddPermissionCommand",
);
var de_CheckpointDurableExecutionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CheckpointToken: import_smithy_client.expectString,
      NewExecutionState: /* @__PURE__ */ __name(
        (_) => de_CheckpointUpdatedExecutionState(_, context),
        "NewExecutionState",
      ),
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_CheckpointDurableExecutionCommand",
);
var de_CreateAliasCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 201 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    AliasArn: import_smithy_client.expectString,
    Description: import_smithy_client.expectString,
    FunctionVersion: import_smithy_client.expectString,
    Name: import_smithy_client.expectString,
    RevisionId: import_smithy_client.expectString,
    RoutingConfig: /* @__PURE__ */ __name(
      (_) => de_AliasRoutingConfiguration(_, context),
      "RoutingConfig",
    ),
  });
  Object.assign(contents, doc);
  return contents;
}, "de_CreateAliasCommand");
var de_CreateCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_CreateCodeSigningConfigCommand",
);
var de_CreateEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AmazonManagedKafkaEventSourceConfig: import_smithy_client._json,
      BatchSize: import_smithy_client.expectInt32,
      BisectBatchOnFunctionError: import_smithy_client.expectBoolean,
      DestinationConfig: import_smithy_client._json,
      DocumentDBEventSourceConfig: import_smithy_client._json,
      EventSourceArn: import_smithy_client.expectString,
      EventSourceMappingArn: import_smithy_client.expectString,
      FilterCriteria: import_smithy_client._json,
      FilterCriteriaError: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionResponseTypes: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      LastProcessingResult: import_smithy_client.expectString,
      MaximumBatchingWindowInSeconds: import_smithy_client.expectInt32,
      MaximumRecordAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
      MetricsConfig: import_smithy_client._json,
      ParallelizationFactor: import_smithy_client.expectInt32,
      ProvisionedPollerConfig: import_smithy_client._json,
      Queues: import_smithy_client._json,
      ScalingConfig: import_smithy_client._json,
      SelfManagedEventSource: import_smithy_client._json,
      SelfManagedKafkaEventSourceConfig: import_smithy_client._json,
      SourceAccessConfigurations: import_smithy_client._json,
      StartingPosition: import_smithy_client.expectString,
      StartingPositionTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartingPositionTimestamp",
      ),
      State: import_smithy_client.expectString,
      StateTransitionReason: import_smithy_client.expectString,
      Topics: import_smithy_client._json,
      TumblingWindowInSeconds: import_smithy_client.expectInt32,
      UUID: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_CreateEventSourceMappingCommand",
);
var de_CreateFunctionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Architectures: import_smithy_client._json,
      CodeSha256: import_smithy_client.expectString,
      CodeSize: import_smithy_client.expectLong,
      DeadLetterConfig: import_smithy_client._json,
      Description: import_smithy_client.expectString,
      DurableConfig: import_smithy_client._json,
      Environment: import_smithy_client._json,
      EphemeralStorage: import_smithy_client._json,
      FileSystemConfigs: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
      Handler: import_smithy_client.expectString,
      ImageConfigResponse: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: import_smithy_client.expectString,
      LastUpdateStatus: import_smithy_client.expectString,
      LastUpdateStatusReason: import_smithy_client.expectString,
      LastUpdateStatusReasonCode: import_smithy_client.expectString,
      Layers: import_smithy_client._json,
      LoggingConfig: import_smithy_client._json,
      MasterArn: import_smithy_client.expectString,
      MemorySize: import_smithy_client.expectInt32,
      PackageType: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
      Role: import_smithy_client.expectString,
      Runtime: import_smithy_client.expectString,
      RuntimeVersionConfig: import_smithy_client._json,
      SigningJobArn: import_smithy_client.expectString,
      SigningProfileVersionArn: import_smithy_client.expectString,
      SnapStart: import_smithy_client._json,
      State: import_smithy_client.expectString,
      StateReason: import_smithy_client.expectString,
      StateReasonCode: import_smithy_client.expectString,
      Timeout: import_smithy_client.expectInt32,
      TracingConfig: import_smithy_client._json,
      Version: import_smithy_client.expectString,
      VpcConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_CreateFunctionCommand",
);
var de_CreateFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AuthType: import_smithy_client.expectString,
      Cors: import_smithy_client._json,
      CreationTime: import_smithy_client.expectString,
      FunctionArn: import_smithy_client.expectString,
      FunctionUrl: import_smithy_client.expectString,
      InvokeMode: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_CreateFunctionUrlConfigCommand",
);
var de_DeleteAliasCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  await (0, import_smithy_client.collectBody)(output.body, context);
  return contents;
}, "de_DeleteAliasCommand");
var de_DeleteCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteCodeSigningConfigCommand",
);
var de_DeleteEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AmazonManagedKafkaEventSourceConfig: import_smithy_client._json,
      BatchSize: import_smithy_client.expectInt32,
      BisectBatchOnFunctionError: import_smithy_client.expectBoolean,
      DestinationConfig: import_smithy_client._json,
      DocumentDBEventSourceConfig: import_smithy_client._json,
      EventSourceArn: import_smithy_client.expectString,
      EventSourceMappingArn: import_smithy_client.expectString,
      FilterCriteria: import_smithy_client._json,
      FilterCriteriaError: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionResponseTypes: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      LastProcessingResult: import_smithy_client.expectString,
      MaximumBatchingWindowInSeconds: import_smithy_client.expectInt32,
      MaximumRecordAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
      MetricsConfig: import_smithy_client._json,
      ParallelizationFactor: import_smithy_client.expectInt32,
      ProvisionedPollerConfig: import_smithy_client._json,
      Queues: import_smithy_client._json,
      ScalingConfig: import_smithy_client._json,
      SelfManagedEventSource: import_smithy_client._json,
      SelfManagedKafkaEventSourceConfig: import_smithy_client._json,
      SourceAccessConfigurations: import_smithy_client._json,
      StartingPosition: import_smithy_client.expectString,
      StartingPositionTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartingPositionTimestamp",
      ),
      State: import_smithy_client.expectString,
      StateTransitionReason: import_smithy_client.expectString,
      Topics: import_smithy_client._json,
      TumblingWindowInSeconds: import_smithy_client.expectInt32,
      UUID: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_DeleteEventSourceMappingCommand",
);
var de_DeleteFunctionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteFunctionCommand",
);
var de_DeleteFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteFunctionCodeSigningConfigCommand",
);
var de_DeleteFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteFunctionConcurrencyCommand",
);
var de_DeleteFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteFunctionEventInvokeConfigCommand",
);
var de_DeleteFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteFunctionUrlConfigCommand",
);
var de_DeleteLayerVersionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteLayerVersionCommand",
);
var de_DeleteProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_DeleteProvisionedConcurrencyConfigCommand",
);
var de_GetAccountSettingsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AccountLimit: import_smithy_client._json,
      AccountUsage: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetAccountSettingsCommand",
);
var de_GetAliasCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    AliasArn: import_smithy_client.expectString,
    Description: import_smithy_client.expectString,
    FunctionVersion: import_smithy_client.expectString,
    Name: import_smithy_client.expectString,
    RevisionId: import_smithy_client.expectString,
    RoutingConfig: /* @__PURE__ */ __name(
      (_) => de_AliasRoutingConfiguration(_, context),
      "RoutingConfig",
    ),
  });
  Object.assign(contents, doc);
  return contents;
}, "de_GetAliasCommand");
var de_GetCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetCodeSigningConfigCommand",
);
var de_GetDurableExecutionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      DurableExecutionArn: import_smithy_client.expectString,
      DurableExecutionName: import_smithy_client.expectString,
      EndTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "EndTimestamp",
      ),
      Error: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      InputPayload: import_smithy_client.expectString,
      Result: import_smithy_client.expectString,
      StartTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartTimestamp",
      ),
      Status: import_smithy_client.expectString,
      Version: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetDurableExecutionCommand",
);
var de_GetDurableExecutionHistoryCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Events: /* @__PURE__ */ __name((_) => de_Events(_, context), "Events"),
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetDurableExecutionHistoryCommand",
);
var de_GetDurableExecutionStateCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      NextMarker: import_smithy_client.expectString,
      Operations: /* @__PURE__ */ __name(
        (_) => de_Operations(_, context),
        "Operations",
      ),
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetDurableExecutionStateCommand",
);
var de_GetEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AmazonManagedKafkaEventSourceConfig: import_smithy_client._json,
      BatchSize: import_smithy_client.expectInt32,
      BisectBatchOnFunctionError: import_smithy_client.expectBoolean,
      DestinationConfig: import_smithy_client._json,
      DocumentDBEventSourceConfig: import_smithy_client._json,
      EventSourceArn: import_smithy_client.expectString,
      EventSourceMappingArn: import_smithy_client.expectString,
      FilterCriteria: import_smithy_client._json,
      FilterCriteriaError: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionResponseTypes: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      LastProcessingResult: import_smithy_client.expectString,
      MaximumBatchingWindowInSeconds: import_smithy_client.expectInt32,
      MaximumRecordAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
      MetricsConfig: import_smithy_client._json,
      ParallelizationFactor: import_smithy_client.expectInt32,
      ProvisionedPollerConfig: import_smithy_client._json,
      Queues: import_smithy_client._json,
      ScalingConfig: import_smithy_client._json,
      SelfManagedEventSource: import_smithy_client._json,
      SelfManagedKafkaEventSourceConfig: import_smithy_client._json,
      SourceAccessConfigurations: import_smithy_client._json,
      StartingPosition: import_smithy_client.expectString,
      StartingPositionTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartingPositionTimestamp",
      ),
      State: import_smithy_client.expectString,
      StateTransitionReason: import_smithy_client.expectString,
      Topics: import_smithy_client._json,
      TumblingWindowInSeconds: import_smithy_client.expectInt32,
      UUID: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetEventSourceMappingCommand",
);
var de_GetFunctionCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    Code: import_smithy_client._json,
    Concurrency: import_smithy_client._json,
    Configuration: import_smithy_client._json,
    Tags: import_smithy_client._json,
    TagsError: import_smithy_client._json,
  });
  Object.assign(contents, doc);
  return contents;
}, "de_GetFunctionCommand");
var de_GetFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfigArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionCodeSigningConfigCommand",
);
var de_GetFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      ReservedConcurrentExecutions: import_smithy_client.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionConcurrencyCommand",
);
var de_GetFunctionConfigurationCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Architectures: import_smithy_client._json,
      CodeSha256: import_smithy_client.expectString,
      CodeSize: import_smithy_client.expectLong,
      DeadLetterConfig: import_smithy_client._json,
      Description: import_smithy_client.expectString,
      DurableConfig: import_smithy_client._json,
      Environment: import_smithy_client._json,
      EphemeralStorage: import_smithy_client._json,
      FileSystemConfigs: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
      Handler: import_smithy_client.expectString,
      ImageConfigResponse: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: import_smithy_client.expectString,
      LastUpdateStatus: import_smithy_client.expectString,
      LastUpdateStatusReason: import_smithy_client.expectString,
      LastUpdateStatusReasonCode: import_smithy_client.expectString,
      Layers: import_smithy_client._json,
      LoggingConfig: import_smithy_client._json,
      MasterArn: import_smithy_client.expectString,
      MemorySize: import_smithy_client.expectInt32,
      PackageType: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
      Role: import_smithy_client.expectString,
      Runtime: import_smithy_client.expectString,
      RuntimeVersionConfig: import_smithy_client._json,
      SigningJobArn: import_smithy_client.expectString,
      SigningProfileVersionArn: import_smithy_client.expectString,
      SnapStart: import_smithy_client._json,
      State: import_smithy_client.expectString,
      StateReason: import_smithy_client.expectString,
      StateReasonCode: import_smithy_client.expectString,
      Timeout: import_smithy_client.expectInt32,
      TracingConfig: import_smithy_client._json,
      Version: import_smithy_client.expectString,
      VpcConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionConfigurationCommand",
);
var de_GetFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      DestinationConfig: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      MaximumEventAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionEventInvokeConfigCommand",
);
var de_GetFunctionRecursionConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      RecursiveLoop: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionRecursionConfigCommand",
);
var de_GetFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AuthType: import_smithy_client.expectString,
      Cors: import_smithy_client._json,
      CreationTime: import_smithy_client.expectString,
      FunctionArn: import_smithy_client.expectString,
      FunctionUrl: import_smithy_client.expectString,
      InvokeMode: import_smithy_client.expectString,
      LastModifiedTime: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetFunctionUrlConfigCommand",
);
var de_GetLayerVersionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CompatibleArchitectures: import_smithy_client._json,
      CompatibleRuntimes: import_smithy_client._json,
      Content: import_smithy_client._json,
      CreatedDate: import_smithy_client.expectString,
      Description: import_smithy_client.expectString,
      LayerArn: import_smithy_client.expectString,
      LayerVersionArn: import_smithy_client.expectString,
      LicenseInfo: import_smithy_client.expectString,
      Version: import_smithy_client.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetLayerVersionCommand",
);
var de_GetLayerVersionByArnCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CompatibleArchitectures: import_smithy_client._json,
      CompatibleRuntimes: import_smithy_client._json,
      Content: import_smithy_client._json,
      CreatedDate: import_smithy_client.expectString,
      Description: import_smithy_client.expectString,
      LayerArn: import_smithy_client.expectString,
      LayerVersionArn: import_smithy_client.expectString,
      LicenseInfo: import_smithy_client.expectString,
      Version: import_smithy_client.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetLayerVersionByArnCommand",
);
var de_GetLayerVersionPolicyCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Policy: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetLayerVersionPolicyCommand",
);
var de_GetPolicyCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    Policy: import_smithy_client.expectString,
    RevisionId: import_smithy_client.expectString,
  });
  Object.assign(contents, doc);
  return contents;
}, "de_GetPolicyCommand");
var de_GetProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AllocatedProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      AvailableProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      LastModified: import_smithy_client.expectString,
      RequestedProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      Status: import_smithy_client.expectString,
      StatusReason: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetProvisionedConcurrencyConfigCommand",
);
var de_GetRuntimeManagementConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      FunctionArn: import_smithy_client.expectString,
      RuntimeVersionArn: import_smithy_client.expectString,
      UpdateRuntimeOn: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_GetRuntimeManagementConfigCommand",
);
var de_InvokeCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
    [_FE]: [, output.headers[_xafe]],
    [_LR]: [, output.headers[_xalr]],
    [_EV]: [, output.headers[_xaev]],
    [_DEA]: [, output.headers[_xadea]],
  });
  const data = await (0, import_smithy_client.collectBody)(
    output.body,
    context,
  );
  contents.Payload = data;
  (0, import_smithy_client.map)(contents, {
    StatusCode: [, output.statusCode],
  });
  return contents;
}, "de_InvokeCommand");
var de_InvokeAsyncCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 202 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  (0, import_smithy_client.map)(contents, {
    Status: [, output.statusCode],
  });
  await (0, import_smithy_client.collectBody)(output.body, context);
  return contents;
}, "de_InvokeAsyncCommand");
var de_InvokeWithResponseStreamCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
      [_EV]: [, output.headers[_xaev]],
      [_RSCT]: [, output.headers[_ct]],
    });
    const data = output.body;
    contents.EventStream = de_InvokeWithResponseStreamResponseEvent(
      data,
      context,
    );
    (0, import_smithy_client.map)(contents, {
      StatusCode: [, output.statusCode],
    });
    return contents;
  },
  "de_InvokeWithResponseStreamCommand",
);
var de_ListAliasesCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    Aliases: /* @__PURE__ */ __name((_) => de_AliasList(_, context), "Aliases"),
    NextMarker: import_smithy_client.expectString,
  });
  Object.assign(contents, doc);
  return contents;
}, "de_ListAliasesCommand");
var de_ListCodeSigningConfigsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfigs: import_smithy_client._json,
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListCodeSigningConfigsCommand",
);
var de_ListDurableExecutionsByFunctionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      DurableExecutions: /* @__PURE__ */ __name(
        (_) => de_DurableExecutions(_, context),
        "DurableExecutions",
      ),
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListDurableExecutionsByFunctionCommand",
);
var de_ListEventSourceMappingsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      EventSourceMappings: /* @__PURE__ */ __name(
        (_) => de_EventSourceMappingsList(_, context),
        "EventSourceMappings",
      ),
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListEventSourceMappingsCommand",
);
var de_ListFunctionEventInvokeConfigsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      FunctionEventInvokeConfigs: /* @__PURE__ */ __name(
        (_) => de_FunctionEventInvokeConfigList(_, context),
        "FunctionEventInvokeConfigs",
      ),
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListFunctionEventInvokeConfigsCommand",
);
var de_ListFunctionsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Functions: import_smithy_client._json,
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListFunctionsCommand",
);
var de_ListFunctionsByCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      FunctionArns: import_smithy_client._json,
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListFunctionsByCodeSigningConfigCommand",
);
var de_ListFunctionUrlConfigsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      FunctionUrlConfigs: import_smithy_client._json,
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListFunctionUrlConfigsCommand",
);
var de_ListLayersCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    Layers: import_smithy_client._json,
    NextMarker: import_smithy_client.expectString,
  });
  Object.assign(contents, doc);
  return contents;
}, "de_ListLayersCommand");
var de_ListLayerVersionsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      LayerVersions: import_smithy_client._json,
      NextMarker: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListLayerVersionsCommand",
);
var de_ListProvisionedConcurrencyConfigsCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      NextMarker: import_smithy_client.expectString,
      ProvisionedConcurrencyConfigs: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListProvisionedConcurrencyConfigsCommand",
);
var de_ListTagsCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    Tags: import_smithy_client._json,
  });
  Object.assign(contents, doc);
  return contents;
}, "de_ListTagsCommand");
var de_ListVersionsByFunctionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      NextMarker: import_smithy_client.expectString,
      Versions: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_ListVersionsByFunctionCommand",
);
var de_PublishLayerVersionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CompatibleArchitectures: import_smithy_client._json,
      CompatibleRuntimes: import_smithy_client._json,
      Content: import_smithy_client._json,
      CreatedDate: import_smithy_client.expectString,
      Description: import_smithy_client.expectString,
      LayerArn: import_smithy_client.expectString,
      LayerVersionArn: import_smithy_client.expectString,
      LicenseInfo: import_smithy_client.expectString,
      Version: import_smithy_client.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PublishLayerVersionCommand",
);
var de_PublishVersionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Architectures: import_smithy_client._json,
      CodeSha256: import_smithy_client.expectString,
      CodeSize: import_smithy_client.expectLong,
      DeadLetterConfig: import_smithy_client._json,
      Description: import_smithy_client.expectString,
      DurableConfig: import_smithy_client._json,
      Environment: import_smithy_client._json,
      EphemeralStorage: import_smithy_client._json,
      FileSystemConfigs: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
      Handler: import_smithy_client.expectString,
      ImageConfigResponse: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: import_smithy_client.expectString,
      LastUpdateStatus: import_smithy_client.expectString,
      LastUpdateStatusReason: import_smithy_client.expectString,
      LastUpdateStatusReasonCode: import_smithy_client.expectString,
      Layers: import_smithy_client._json,
      LoggingConfig: import_smithy_client._json,
      MasterArn: import_smithy_client.expectString,
      MemorySize: import_smithy_client.expectInt32,
      PackageType: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
      Role: import_smithy_client.expectString,
      Runtime: import_smithy_client.expectString,
      RuntimeVersionConfig: import_smithy_client._json,
      SigningJobArn: import_smithy_client.expectString,
      SigningProfileVersionArn: import_smithy_client.expectString,
      SnapStart: import_smithy_client._json,
      State: import_smithy_client.expectString,
      StateReason: import_smithy_client.expectString,
      StateReasonCode: import_smithy_client.expectString,
      Timeout: import_smithy_client.expectInt32,
      TracingConfig: import_smithy_client._json,
      Version: import_smithy_client.expectString,
      VpcConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PublishVersionCommand",
);
var de_PutFunctionCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfigArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutFunctionCodeSigningConfigCommand",
);
var de_PutFunctionConcurrencyCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      ReservedConcurrentExecutions: import_smithy_client.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutFunctionConcurrencyCommand",
);
var de_PutFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      DestinationConfig: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      MaximumEventAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutFunctionEventInvokeConfigCommand",
);
var de_PutFunctionRecursionConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      RecursiveLoop: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutFunctionRecursionConfigCommand",
);
var de_PutProvisionedConcurrencyConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AllocatedProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      AvailableProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      LastModified: import_smithy_client.expectString,
      RequestedProvisionedConcurrentExecutions:
        import_smithy_client.expectInt32,
      Status: import_smithy_client.expectString,
      StatusReason: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutProvisionedConcurrencyConfigCommand",
);
var de_PutRuntimeManagementConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      FunctionArn: import_smithy_client.expectString,
      RuntimeVersionArn: import_smithy_client.expectString,
      UpdateRuntimeOn: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_PutRuntimeManagementConfigCommand",
);
var de_RemoveLayerVersionPermissionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_RemoveLayerVersionPermissionCommand",
);
var de_RemovePermissionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_RemovePermissionCommand",
);
var de_SendDurableExecutionCallbackFailureCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_SendDurableExecutionCallbackFailureCommand",
);
var de_SendDurableExecutionCallbackHeartbeatCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_SendDurableExecutionCallbackHeartbeatCommand",
);
var de_SendDurableExecutionCallbackSuccessCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_SendDurableExecutionCallbackSuccessCommand",
);
var de_StopDurableExecutionCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      StopDate: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StopDate",
      ),
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_StopDurableExecutionCommand",
);
var de_TagResourceCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 204 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  await (0, import_smithy_client.collectBody)(output.body, context);
  return contents;
}, "de_TagResourceCommand");
var de_UntagResourceCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    await (0, import_smithy_client.collectBody)(output.body, context);
    return contents;
  },
  "de_UntagResourceCommand",
);
var de_UpdateAliasCommand = /* @__PURE__ */ __name(async (output, context) => {
  if (output.statusCode !== 200 && output.statusCode >= 300) {
    return de_CommandError(output, context);
  }
  const contents = (0, import_smithy_client.map)({
    $metadata: deserializeMetadata(output),
  });
  const data = (0, import_smithy_client.expectNonNull)(
    (0, import_smithy_client.expectObject)(
      await (0, import_core2.parseJsonBody)(output.body, context),
    ),
    "body",
  );
  const doc = (0, import_smithy_client.take)(data, {
    AliasArn: import_smithy_client.expectString,
    Description: import_smithy_client.expectString,
    FunctionVersion: import_smithy_client.expectString,
    Name: import_smithy_client.expectString,
    RevisionId: import_smithy_client.expectString,
    RoutingConfig: /* @__PURE__ */ __name(
      (_) => de_AliasRoutingConfiguration(_, context),
      "RoutingConfig",
    ),
  });
  Object.assign(contents, doc);
  return contents;
}, "de_UpdateAliasCommand");
var de_UpdateCodeSigningConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      CodeSigningConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateCodeSigningConfigCommand",
);
var de_UpdateEventSourceMappingCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AmazonManagedKafkaEventSourceConfig: import_smithy_client._json,
      BatchSize: import_smithy_client.expectInt32,
      BisectBatchOnFunctionError: import_smithy_client.expectBoolean,
      DestinationConfig: import_smithy_client._json,
      DocumentDBEventSourceConfig: import_smithy_client._json,
      EventSourceArn: import_smithy_client.expectString,
      EventSourceMappingArn: import_smithy_client.expectString,
      FilterCriteria: import_smithy_client._json,
      FilterCriteriaError: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionResponseTypes: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      LastProcessingResult: import_smithy_client.expectString,
      MaximumBatchingWindowInSeconds: import_smithy_client.expectInt32,
      MaximumRecordAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
      MetricsConfig: import_smithy_client._json,
      ParallelizationFactor: import_smithy_client.expectInt32,
      ProvisionedPollerConfig: import_smithy_client._json,
      Queues: import_smithy_client._json,
      ScalingConfig: import_smithy_client._json,
      SelfManagedEventSource: import_smithy_client._json,
      SelfManagedKafkaEventSourceConfig: import_smithy_client._json,
      SourceAccessConfigurations: import_smithy_client._json,
      StartingPosition: import_smithy_client.expectString,
      StartingPositionTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartingPositionTimestamp",
      ),
      State: import_smithy_client.expectString,
      StateTransitionReason: import_smithy_client.expectString,
      Topics: import_smithy_client._json,
      TumblingWindowInSeconds: import_smithy_client.expectInt32,
      UUID: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateEventSourceMappingCommand",
);
var de_UpdateFunctionCodeCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Architectures: import_smithy_client._json,
      CodeSha256: import_smithy_client.expectString,
      CodeSize: import_smithy_client.expectLong,
      DeadLetterConfig: import_smithy_client._json,
      Description: import_smithy_client.expectString,
      DurableConfig: import_smithy_client._json,
      Environment: import_smithy_client._json,
      EphemeralStorage: import_smithy_client._json,
      FileSystemConfigs: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
      Handler: import_smithy_client.expectString,
      ImageConfigResponse: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: import_smithy_client.expectString,
      LastUpdateStatus: import_smithy_client.expectString,
      LastUpdateStatusReason: import_smithy_client.expectString,
      LastUpdateStatusReasonCode: import_smithy_client.expectString,
      Layers: import_smithy_client._json,
      LoggingConfig: import_smithy_client._json,
      MasterArn: import_smithy_client.expectString,
      MemorySize: import_smithy_client.expectInt32,
      PackageType: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
      Role: import_smithy_client.expectString,
      Runtime: import_smithy_client.expectString,
      RuntimeVersionConfig: import_smithy_client._json,
      SigningJobArn: import_smithy_client.expectString,
      SigningProfileVersionArn: import_smithy_client.expectString,
      SnapStart: import_smithy_client._json,
      State: import_smithy_client.expectString,
      StateReason: import_smithy_client.expectString,
      StateReasonCode: import_smithy_client.expectString,
      Timeout: import_smithy_client.expectInt32,
      TracingConfig: import_smithy_client._json,
      Version: import_smithy_client.expectString,
      VpcConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateFunctionCodeCommand",
);
var de_UpdateFunctionConfigurationCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      Architectures: import_smithy_client._json,
      CodeSha256: import_smithy_client.expectString,
      CodeSize: import_smithy_client.expectLong,
      DeadLetterConfig: import_smithy_client._json,
      Description: import_smithy_client.expectString,
      DurableConfig: import_smithy_client._json,
      Environment: import_smithy_client._json,
      EphemeralStorage: import_smithy_client._json,
      FileSystemConfigs: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionName: import_smithy_client.expectString,
      Handler: import_smithy_client.expectString,
      ImageConfigResponse: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: import_smithy_client.expectString,
      LastUpdateStatus: import_smithy_client.expectString,
      LastUpdateStatusReason: import_smithy_client.expectString,
      LastUpdateStatusReasonCode: import_smithy_client.expectString,
      Layers: import_smithy_client._json,
      LoggingConfig: import_smithy_client._json,
      MasterArn: import_smithy_client.expectString,
      MemorySize: import_smithy_client.expectInt32,
      PackageType: import_smithy_client.expectString,
      RevisionId: import_smithy_client.expectString,
      Role: import_smithy_client.expectString,
      Runtime: import_smithy_client.expectString,
      RuntimeVersionConfig: import_smithy_client._json,
      SigningJobArn: import_smithy_client.expectString,
      SigningProfileVersionArn: import_smithy_client.expectString,
      SnapStart: import_smithy_client._json,
      State: import_smithy_client.expectString,
      StateReason: import_smithy_client.expectString,
      StateReasonCode: import_smithy_client.expectString,
      Timeout: import_smithy_client.expectInt32,
      TracingConfig: import_smithy_client._json,
      Version: import_smithy_client.expectString,
      VpcConfig: import_smithy_client._json,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateFunctionConfigurationCommand",
);
var de_UpdateFunctionEventInvokeConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      DestinationConfig: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      MaximumEventAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateFunctionEventInvokeConfigCommand",
);
var de_UpdateFunctionUrlConfigCommand = /* @__PURE__ */ __name(
  async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
      return de_CommandError(output, context);
    }
    const contents = (0, import_smithy_client.map)({
      $metadata: deserializeMetadata(output),
    });
    const data = (0, import_smithy_client.expectNonNull)(
      (0, import_smithy_client.expectObject)(
        await (0, import_core2.parseJsonBody)(output.body, context),
      ),
      "body",
    );
    const doc = (0, import_smithy_client.take)(data, {
      AuthType: import_smithy_client.expectString,
      Cors: import_smithy_client._json,
      CreationTime: import_smithy_client.expectString,
      FunctionArn: import_smithy_client.expectString,
      FunctionUrl: import_smithy_client.expectString,
      InvokeMode: import_smithy_client.expectString,
      LastModifiedTime: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    return contents;
  },
  "de_UpdateFunctionUrlConfigCommand",
);
var de_CommandError = /* @__PURE__ */ __name(async (output, context) => {
  const parsedOutput = {
    ...output,
    body: await (0, import_core2.parseJsonErrorBody)(output.body, context),
  };
  const errorCode = (0, import_core2.loadRestJsonErrorCode)(
    output,
    parsedOutput.body,
  );
  switch (errorCode) {
    case "InvalidParameterValueException":
    case "com.amazonaws.lambda#InvalidParameterValueException":
      throw await de_InvalidParameterValueExceptionRes(parsedOutput, context);
    case "PolicyLengthExceededException":
    case "com.amazonaws.lambda#PolicyLengthExceededException":
      throw await de_PolicyLengthExceededExceptionRes(parsedOutput, context);
    case "PreconditionFailedException":
    case "com.amazonaws.lambda#PreconditionFailedException":
      throw await de_PreconditionFailedExceptionRes(parsedOutput, context);
    case "ResourceConflictException":
    case "com.amazonaws.lambda#ResourceConflictException":
      throw await de_ResourceConflictExceptionRes(parsedOutput, context);
    case "ResourceNotFoundException":
    case "com.amazonaws.lambda#ResourceNotFoundException":
      throw await de_ResourceNotFoundExceptionRes(parsedOutput, context);
    case "ServiceException":
    case "com.amazonaws.lambda#ServiceException":
      throw await de_ServiceExceptionRes(parsedOutput, context);
    case "TooManyRequestsException":
    case "com.amazonaws.lambda#TooManyRequestsException":
      throw await de_TooManyRequestsExceptionRes(parsedOutput, context);
    case "CodeSigningConfigNotFoundException":
    case "com.amazonaws.lambda#CodeSigningConfigNotFoundException":
      throw await de_CodeSigningConfigNotFoundExceptionRes(
        parsedOutput,
        context,
      );
    case "CodeStorageExceededException":
    case "com.amazonaws.lambda#CodeStorageExceededException":
      throw await de_CodeStorageExceededExceptionRes(parsedOutput, context);
    case "CodeVerificationFailedException":
    case "com.amazonaws.lambda#CodeVerificationFailedException":
      throw await de_CodeVerificationFailedExceptionRes(parsedOutput, context);
    case "InvalidCodeSignatureException":
    case "com.amazonaws.lambda#InvalidCodeSignatureException":
      throw await de_InvalidCodeSignatureExceptionRes(parsedOutput, context);
    case "ResourceInUseException":
    case "com.amazonaws.lambda#ResourceInUseException":
      throw await de_ResourceInUseExceptionRes(parsedOutput, context);
    case "ProvisionedConcurrencyConfigNotFoundException":
    case "com.amazonaws.lambda#ProvisionedConcurrencyConfigNotFoundException":
      throw await de_ProvisionedConcurrencyConfigNotFoundExceptionRes(
        parsedOutput,
        context,
      );
    case "DurableExecutionAlreadyStartedException":
    case "com.amazonaws.lambda#DurableExecutionAlreadyStartedException":
      throw await de_DurableExecutionAlreadyStartedExceptionRes(
        parsedOutput,
        context,
      );
    case "EC2AccessDeniedException":
    case "com.amazonaws.lambda#EC2AccessDeniedException":
      throw await de_EC2AccessDeniedExceptionRes(parsedOutput, context);
    case "EC2ThrottledException":
    case "com.amazonaws.lambda#EC2ThrottledException":
      throw await de_EC2ThrottledExceptionRes(parsedOutput, context);
    case "EC2UnexpectedException":
    case "com.amazonaws.lambda#EC2UnexpectedException":
      throw await de_EC2UnexpectedExceptionRes(parsedOutput, context);
    case "EFSIOException":
    case "com.amazonaws.lambda#EFSIOException":
      throw await de_EFSIOExceptionRes(parsedOutput, context);
    case "EFSMountConnectivityException":
    case "com.amazonaws.lambda#EFSMountConnectivityException":
      throw await de_EFSMountConnectivityExceptionRes(parsedOutput, context);
    case "EFSMountFailureException":
    case "com.amazonaws.lambda#EFSMountFailureException":
      throw await de_EFSMountFailureExceptionRes(parsedOutput, context);
    case "EFSMountTimeoutException":
    case "com.amazonaws.lambda#EFSMountTimeoutException":
      throw await de_EFSMountTimeoutExceptionRes(parsedOutput, context);
    case "ENILimitReachedException":
    case "com.amazonaws.lambda#ENILimitReachedException":
      throw await de_ENILimitReachedExceptionRes(parsedOutput, context);
    case "InvalidRequestContentException":
    case "com.amazonaws.lambda#InvalidRequestContentException":
      throw await de_InvalidRequestContentExceptionRes(parsedOutput, context);
    case "InvalidRuntimeException":
    case "com.amazonaws.lambda#InvalidRuntimeException":
      throw await de_InvalidRuntimeExceptionRes(parsedOutput, context);
    case "InvalidSecurityGroupIDException":
    case "com.amazonaws.lambda#InvalidSecurityGroupIDException":
      throw await de_InvalidSecurityGroupIDExceptionRes(parsedOutput, context);
    case "InvalidSubnetIDException":
    case "com.amazonaws.lambda#InvalidSubnetIDException":
      throw await de_InvalidSubnetIDExceptionRes(parsedOutput, context);
    case "InvalidZipFileException":
    case "com.amazonaws.lambda#InvalidZipFileException":
      throw await de_InvalidZipFileExceptionRes(parsedOutput, context);
    case "KMSAccessDeniedException":
    case "com.amazonaws.lambda#KMSAccessDeniedException":
      throw await de_KMSAccessDeniedExceptionRes(parsedOutput, context);
    case "KMSDisabledException":
    case "com.amazonaws.lambda#KMSDisabledException":
      throw await de_KMSDisabledExceptionRes(parsedOutput, context);
    case "KMSInvalidStateException":
    case "com.amazonaws.lambda#KMSInvalidStateException":
      throw await de_KMSInvalidStateExceptionRes(parsedOutput, context);
    case "KMSNotFoundException":
    case "com.amazonaws.lambda#KMSNotFoundException":
      throw await de_KMSNotFoundExceptionRes(parsedOutput, context);
    case "RecursiveInvocationException":
    case "com.amazonaws.lambda#RecursiveInvocationException":
      throw await de_RecursiveInvocationExceptionRes(parsedOutput, context);
    case "RequestTooLargeException":
    case "com.amazonaws.lambda#RequestTooLargeException":
      throw await de_RequestTooLargeExceptionRes(parsedOutput, context);
    case "ResourceNotReadyException":
    case "com.amazonaws.lambda#ResourceNotReadyException":
      throw await de_ResourceNotReadyExceptionRes(parsedOutput, context);
    case "SnapStartException":
    case "com.amazonaws.lambda#SnapStartException":
      throw await de_SnapStartExceptionRes(parsedOutput, context);
    case "SnapStartNotReadyException":
    case "com.amazonaws.lambda#SnapStartNotReadyException":
      throw await de_SnapStartNotReadyExceptionRes(parsedOutput, context);
    case "SnapStartTimeoutException":
    case "com.amazonaws.lambda#SnapStartTimeoutException":
      throw await de_SnapStartTimeoutExceptionRes(parsedOutput, context);
    case "SubnetIPAddressLimitReachedException":
    case "com.amazonaws.lambda#SubnetIPAddressLimitReachedException":
      throw await de_SubnetIPAddressLimitReachedExceptionRes(
        parsedOutput,
        context,
      );
    case "UnsupportedMediaTypeException":
    case "com.amazonaws.lambda#UnsupportedMediaTypeException":
      throw await de_UnsupportedMediaTypeExceptionRes(parsedOutput, context);
    case "CallbackTimeoutException":
    case "com.amazonaws.lambda#CallbackTimeoutException":
      throw await de_CallbackTimeoutExceptionRes(parsedOutput, context);
    default:
      const parsedBody = parsedOutput.body;
      return throwDefaultError({
        output,
        parsedBody,
        errorCode,
      });
  }
}, "de_CommandError");
var throwDefaultError = (0, import_smithy_client.withBaseException)(
  LambdaServiceException,
);
var de_CallbackTimeoutExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new CallbackTimeoutException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_CallbackTimeoutExceptionRes",
);
var de_CodeSigningConfigNotFoundExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeSigningConfigNotFoundException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_CodeSigningConfigNotFoundExceptionRes",
);
var de_CodeStorageExceededExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeStorageExceededException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_CodeStorageExceededExceptionRes",
);
var de_CodeVerificationFailedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeVerificationFailedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_CodeVerificationFailedExceptionRes",
);
var de_DurableExecutionAlreadyStartedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new DurableExecutionAlreadyStartedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_DurableExecutionAlreadyStartedExceptionRes",
);
var de_EC2AccessDeniedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2AccessDeniedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EC2AccessDeniedExceptionRes",
);
var de_EC2ThrottledExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2ThrottledException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EC2ThrottledExceptionRes",
);
var de_EC2UnexpectedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      EC2ErrorCode: import_smithy_client.expectString,
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2UnexpectedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EC2UnexpectedExceptionRes",
);
var de_EFSIOExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSIOException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EFSIOExceptionRes",
);
var de_EFSMountConnectivityExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountConnectivityException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EFSMountConnectivityExceptionRes",
);
var de_EFSMountFailureExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountFailureException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EFSMountFailureExceptionRes",
);
var de_EFSMountTimeoutExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountTimeoutException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_EFSMountTimeoutExceptionRes",
);
var de_ENILimitReachedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ENILimitReachedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ENILimitReachedExceptionRes",
);
var de_InvalidCodeSignatureExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidCodeSignatureException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidCodeSignatureExceptionRes",
);
var de_InvalidParameterValueExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidParameterValueException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidParameterValueExceptionRes",
);
var de_InvalidRequestContentExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidRequestContentException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidRequestContentExceptionRes",
);
var de_InvalidRuntimeExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidRuntimeException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidRuntimeExceptionRes",
);
var de_InvalidSecurityGroupIDExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidSecurityGroupIDException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidSecurityGroupIDExceptionRes",
);
var de_InvalidSubnetIDExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidSubnetIDException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidSubnetIDExceptionRes",
);
var de_InvalidZipFileExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidZipFileException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_InvalidZipFileExceptionRes",
);
var de_KMSAccessDeniedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSAccessDeniedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_KMSAccessDeniedExceptionRes",
);
var de_KMSDisabledExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSDisabledException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_KMSDisabledExceptionRes",
);
var de_KMSInvalidStateExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSInvalidStateException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_KMSInvalidStateExceptionRes",
);
var de_KMSNotFoundExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSNotFoundException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_KMSNotFoundExceptionRes",
);
var de_PolicyLengthExceededExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new PolicyLengthExceededException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_PolicyLengthExceededExceptionRes",
);
var de_PreconditionFailedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new PreconditionFailedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_PreconditionFailedExceptionRes",
);
var de_ProvisionedConcurrencyConfigNotFoundExceptionRes =
  /* @__PURE__ */ __name(async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ProvisionedConcurrencyConfigNotFoundException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  }, "de_ProvisionedConcurrencyConfigNotFoundExceptionRes");
var de_RecursiveInvocationExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new RecursiveInvocationException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_RecursiveInvocationExceptionRes",
);
var de_RequestTooLargeExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new RequestTooLargeException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_RequestTooLargeExceptionRes",
);
var de_ResourceConflictExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceConflictException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ResourceConflictExceptionRes",
);
var de_ResourceInUseExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceInUseException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ResourceInUseExceptionRes",
);
var de_ResourceNotFoundExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceNotFoundException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ResourceNotFoundExceptionRes",
);
var de_ResourceNotReadyExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceNotReadyException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ResourceNotReadyExceptionRes",
);
var de_ServiceExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new ServiceException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_ServiceExceptionRes",
);
var de_SnapStartExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_SnapStartExceptionRes",
);
var de_SnapStartNotReadyExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartNotReadyException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_SnapStartNotReadyExceptionRes",
);
var de_SnapStartTimeoutExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartTimeoutException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_SnapStartTimeoutExceptionRes",
);
var de_SubnetIPAddressLimitReachedExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Message: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new SubnetIPAddressLimitReachedException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_SubnetIPAddressLimitReachedExceptionRes",
);
var de_TooManyRequestsExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({
      [_rAS]: [, parsedOutput.headers[_ra]],
    });
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Reason: import_smithy_client.expectString,
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new TooManyRequestsException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_TooManyRequestsExceptionRes",
);
var de_UnsupportedMediaTypeExceptionRes = /* @__PURE__ */ __name(
  async (parsedOutput, context) => {
    const contents = (0, import_smithy_client.map)({});
    const data = parsedOutput.body;
    const doc = (0, import_smithy_client.take)(data, {
      Type: import_smithy_client.expectString,
      message: import_smithy_client.expectString,
    });
    Object.assign(contents, doc);
    const exception = new UnsupportedMediaTypeException({
      $metadata: deserializeMetadata(parsedOutput),
      ...contents,
    });
    return (0, import_smithy_client.decorateServiceException)(
      exception,
      parsedOutput.body,
    );
  },
  "de_UnsupportedMediaTypeExceptionRes",
);
var de_InvokeWithResponseStreamResponseEvent = /* @__PURE__ */ __name(
  (output, context) => {
    return context.eventStreamMarshaller.deserialize(output, async (event) => {
      if (event["PayloadChunk"] != null) {
        return {
          PayloadChunk: await de_InvokeResponseStreamUpdate_event(
            event["PayloadChunk"],
            context,
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
  },
  "de_InvokeWithResponseStreamResponseEvent",
);
var de_InvokeResponseStreamUpdate_event = /* @__PURE__ */ __name(
  async (output, context) => {
    const contents = {};
    contents.Payload = output.body;
    return contents;
  },
  "de_InvokeResponseStreamUpdate_event",
);
var de_InvokeWithResponseStreamCompleteEvent_event = /* @__PURE__ */ __name(
  async (output, context) => {
    const contents = {};
    const data = await (0, import_core2.parseJsonBody)(output.body, context);
    Object.assign(contents, (0, import_smithy_client._json)(data));
    return contents;
  },
  "de_InvokeWithResponseStreamCompleteEvent_event",
);
var se_AdditionalVersionWeights = /* @__PURE__ */ __name((input, context) => {
  return Object.entries(input).reduce((acc, [key, value]) => {
    if (value === null) {
      return acc;
    }
    acc[key] = (0, import_smithy_client.serializeFloat)(value);
    return acc;
  }, {});
}, "se_AdditionalVersionWeights");
var se_AliasRoutingConfiguration = /* @__PURE__ */ __name((input, context) => {
  return (0, import_smithy_client.take)(input, {
    AdditionalVersionWeights: /* @__PURE__ */ __name(
      (_) => se_AdditionalVersionWeights(_, context),
      "AdditionalVersionWeights",
    ),
  });
}, "se_AliasRoutingConfiguration");
var se_FunctionCode = /* @__PURE__ */ __name((input, context) => {
  return (0, import_smithy_client.take)(input, {
    ImageUri: [],
    S3Bucket: [],
    S3Key: [],
    S3ObjectVersion: [],
    SourceKMSKeyArn: [],
    ZipFile: context.base64Encoder,
  });
}, "se_FunctionCode");
var se_LayerVersionContentInput = /* @__PURE__ */ __name((input, context) => {
  return (0, import_smithy_client.take)(input, {
    S3Bucket: [],
    S3Key: [],
    S3ObjectVersion: [],
    ZipFile: context.base64Encoder,
  });
}, "se_LayerVersionContentInput");
var de_AdditionalVersionWeights = /* @__PURE__ */ __name((output, context) => {
  return Object.entries(output).reduce((acc, [key, value]) => {
    if (value === null) {
      return acc;
    }
    acc[key] = (0, import_smithy_client.limitedParseDouble)(value);
    return acc;
  }, {});
}, "de_AdditionalVersionWeights");
var de_AliasConfiguration = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    AliasArn: import_smithy_client.expectString,
    Description: import_smithy_client.expectString,
    FunctionVersion: import_smithy_client.expectString,
    Name: import_smithy_client.expectString,
    RevisionId: import_smithy_client.expectString,
    RoutingConfig: /* @__PURE__ */ __name(
      (_) => de_AliasRoutingConfiguration(_, context),
      "RoutingConfig",
    ),
  });
}, "de_AliasConfiguration");
var de_AliasList = /* @__PURE__ */ __name((output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_AliasConfiguration(entry, context);
    });
  return retVal;
}, "de_AliasList");
var de_AliasRoutingConfiguration = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    AdditionalVersionWeights: /* @__PURE__ */ __name(
      (_) => de_AdditionalVersionWeights(_, context),
      "AdditionalVersionWeights",
    ),
  });
}, "de_AliasRoutingConfiguration");
var de_CheckpointUpdatedExecutionState = /* @__PURE__ */ __name(
  (output, context) => {
    return (0, import_smithy_client.take)(output, {
      NextMarker: import_smithy_client.expectString,
      Operations: /* @__PURE__ */ __name(
        (_) => de_Operations(_, context),
        "Operations",
      ),
    });
  },
  "de_CheckpointUpdatedExecutionState",
);
var de_DurableExecutions = /* @__PURE__ */ __name((output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Execution(entry, context);
    });
  return retVal;
}, "de_DurableExecutions");
var de_Event = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    CallbackFailedDetails: import_smithy_client._json,
    CallbackStartedDetails: import_smithy_client._json,
    CallbackSucceededDetails: import_smithy_client._json,
    CallbackTimedOutDetails: import_smithy_client._json,
    ChainedInvokeFailedDetails: import_smithy_client._json,
    ChainedInvokePendingDetails: import_smithy_client._json,
    ChainedInvokeStartedDetails: import_smithy_client._json,
    ChainedInvokeStoppedDetails: import_smithy_client._json,
    ChainedInvokeSucceededDetails: import_smithy_client._json,
    ChainedInvokeTimedOutDetails: import_smithy_client._json,
    ContextFailedDetails: import_smithy_client._json,
    ContextStartedDetails: import_smithy_client._json,
    ContextSucceededDetails: import_smithy_client._json,
    EventId: import_smithy_client.expectInt32,
    EventTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "EventTimestamp",
    ),
    EventType: import_smithy_client.expectString,
    ExecutionFailedDetails: import_smithy_client._json,
    ExecutionStartedDetails: import_smithy_client._json,
    ExecutionStoppedDetails: import_smithy_client._json,
    ExecutionSucceededDetails: import_smithy_client._json,
    ExecutionTimedOutDetails: import_smithy_client._json,
    Id: import_smithy_client.expectString,
    InvocationCompletedDetails: /* @__PURE__ */ __name(
      (_) => de_InvocationCompletedDetails(_, context),
      "InvocationCompletedDetails",
    ),
    Name: import_smithy_client.expectString,
    ParentId: import_smithy_client.expectString,
    StepFailedDetails: import_smithy_client._json,
    StepStartedDetails: import_smithy_client._json,
    StepSucceededDetails: import_smithy_client._json,
    SubType: import_smithy_client.expectString,
    WaitCancelledDetails: import_smithy_client._json,
    WaitStartedDetails: /* @__PURE__ */ __name(
      (_) => de_WaitStartedDetails(_, context),
      "WaitStartedDetails",
    ),
    WaitSucceededDetails: import_smithy_client._json,
  });
}, "de_Event");
var de_Events = /* @__PURE__ */ __name((output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Event(entry, context);
    });
  return retVal;
}, "de_Events");
var de_EventSourceMappingConfiguration = /* @__PURE__ */ __name(
  (output, context) => {
    return (0, import_smithy_client.take)(output, {
      AmazonManagedKafkaEventSourceConfig: import_smithy_client._json,
      BatchSize: import_smithy_client.expectInt32,
      BisectBatchOnFunctionError: import_smithy_client.expectBoolean,
      DestinationConfig: import_smithy_client._json,
      DocumentDBEventSourceConfig: import_smithy_client._json,
      EventSourceArn: import_smithy_client.expectString,
      EventSourceMappingArn: import_smithy_client.expectString,
      FilterCriteria: import_smithy_client._json,
      FilterCriteriaError: import_smithy_client._json,
      FunctionArn: import_smithy_client.expectString,
      FunctionResponseTypes: import_smithy_client._json,
      KMSKeyArn: import_smithy_client.expectString,
      LastModified: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "LastModified",
      ),
      LastProcessingResult: import_smithy_client.expectString,
      MaximumBatchingWindowInSeconds: import_smithy_client.expectInt32,
      MaximumRecordAgeInSeconds: import_smithy_client.expectInt32,
      MaximumRetryAttempts: import_smithy_client.expectInt32,
      MetricsConfig: import_smithy_client._json,
      ParallelizationFactor: import_smithy_client.expectInt32,
      ProvisionedPollerConfig: import_smithy_client._json,
      Queues: import_smithy_client._json,
      ScalingConfig: import_smithy_client._json,
      SelfManagedEventSource: import_smithy_client._json,
      SelfManagedKafkaEventSourceConfig: import_smithy_client._json,
      SourceAccessConfigurations: import_smithy_client._json,
      StartingPosition: import_smithy_client.expectString,
      StartingPositionTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartingPositionTimestamp",
      ),
      State: import_smithy_client.expectString,
      StateTransitionReason: import_smithy_client.expectString,
      Topics: import_smithy_client._json,
      TumblingWindowInSeconds: import_smithy_client.expectInt32,
      UUID: import_smithy_client.expectString,
    });
  },
  "de_EventSourceMappingConfiguration",
);
var de_EventSourceMappingsList = /* @__PURE__ */ __name((output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_EventSourceMappingConfiguration(entry, context);
    });
  return retVal;
}, "de_EventSourceMappingsList");
var de_Execution = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    DurableExecutionArn: import_smithy_client.expectString,
    DurableExecutionName: import_smithy_client.expectString,
    EndTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "EndTimestamp",
    ),
    FunctionArn: import_smithy_client.expectString,
    StartTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "StartTimestamp",
    ),
    Status: import_smithy_client.expectString,
  });
}, "de_Execution");
var de_FunctionEventInvokeConfig = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    DestinationConfig: import_smithy_client._json,
    FunctionArn: import_smithy_client.expectString,
    LastModified: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "LastModified",
    ),
    MaximumEventAgeInSeconds: import_smithy_client.expectInt32,
    MaximumRetryAttempts: import_smithy_client.expectInt32,
  });
}, "de_FunctionEventInvokeConfig");
var de_FunctionEventInvokeConfigList = /* @__PURE__ */ __name(
  (output, context) => {
    const retVal = (output || [])
      .filter((e) => e != null)
      .map((entry) => {
        return de_FunctionEventInvokeConfig(entry, context);
      });
    return retVal;
  },
  "de_FunctionEventInvokeConfigList",
);
var de_InvocationCompletedDetails = /* @__PURE__ */ __name(
  (output, context) => {
    return (0, import_smithy_client.take)(output, {
      EndTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "EndTimestamp",
      ),
      Error: import_smithy_client._json,
      RequestId: import_smithy_client.expectString,
      StartTimestamp: /* @__PURE__ */ __name(
        (_) =>
          (0, import_smithy_client.expectNonNull)(
            (0, import_smithy_client.parseEpochTimestamp)(
              (0, import_smithy_client.expectNumber)(_),
            ),
          ),
        "StartTimestamp",
      ),
    });
  },
  "de_InvocationCompletedDetails",
);
var de_Operation = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    CallbackDetails: import_smithy_client._json,
    ChainedInvokeDetails: import_smithy_client._json,
    ContextDetails: import_smithy_client._json,
    EndTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "EndTimestamp",
    ),
    ExecutionDetails: import_smithy_client._json,
    Id: import_smithy_client.expectString,
    Name: import_smithy_client.expectString,
    ParentId: import_smithy_client.expectString,
    StartTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "StartTimestamp",
    ),
    Status: import_smithy_client.expectString,
    StepDetails: /* @__PURE__ */ __name(
      (_) => de_StepDetails(_, context),
      "StepDetails",
    ),
    SubType: import_smithy_client.expectString,
    Type: import_smithy_client.expectString,
    WaitDetails: /* @__PURE__ */ __name(
      (_) => de_WaitDetails(_, context),
      "WaitDetails",
    ),
  });
}, "de_Operation");
var de_Operations = /* @__PURE__ */ __name((output, context) => {
  const retVal = (output || [])
    .filter((e) => e != null)
    .map((entry) => {
      return de_Operation(entry, context);
    });
  return retVal;
}, "de_Operations");
var de_StepDetails = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    Attempt: import_smithy_client.expectInt32,
    Error: import_smithy_client._json,
    NextAttemptTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "NextAttemptTimestamp",
    ),
    Result: import_smithy_client.expectString,
  });
}, "de_StepDetails");
var de_WaitDetails = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    ScheduledTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "ScheduledTimestamp",
    ),
  });
}, "de_WaitDetails");
var de_WaitStartedDetails = /* @__PURE__ */ __name((output, context) => {
  return (0, import_smithy_client.take)(output, {
    Duration: import_smithy_client.expectInt32,
    ScheduledEndTimestamp: /* @__PURE__ */ __name(
      (_) =>
        (0, import_smithy_client.expectNonNull)(
          (0, import_smithy_client.parseEpochTimestamp)(
            (0, import_smithy_client.expectNumber)(_),
          ),
        ),
      "ScheduledEndTimestamp",
    ),
  });
}, "de_WaitStartedDetails");
var deserializeMetadata = /* @__PURE__ */ __name(
  (output) => ({
    httpStatusCode: output.statusCode,
    requestId:
      output.headers["x-amzn-requestid"] ??
      output.headers["x-amzn-request-id"] ??
      output.headers["x-amz-request-id"],
    extendedRequestId: output.headers["x-amz-id-2"],
    cfId: output.headers["x-amz-cf-id"],
  }),
  "deserializeMetadata",
);
var _A = "Arn";
var _CA = "CompatibleArchitecture";
var _CC = "ClientContext";
var _CR = "CompatibleRuntime";
var _CT = "CheckpointToken";
var _DEA = "DurableExecutionArn";
var _DEN = "DurableExecutionName";
var _ESA = "EventSourceArn";
var _EV = "ExecutedVersion";
var _FE = "FunctionError";
var _FN = "FunctionName";
var _FV = "FunctionVersion";
var _IED = "IncludeExecutionData";
var _IT = "InvocationType";
var _L = "List";
var _LR = "LogResult";
var _LT = "LogType";
var _M = "Marker";
var _MI = "MaxItems";
var _MR = "MasterRegion";
var _Q = "Qualifier";
var _RI = "RevisionId";
var _RO = "ReverseOrder";
var _RSCT = "ResponseStreamContentType";
var _SF = "StatusFilter";
var _TA = "TimeAfter";
var _TB = "TimeBefore";
var _TK = "TagKeys";
var _ct = "content-type";
var _f = "find";
var _rAS = "retryAfterSeconds";
var _ra = "retry-after";
var _tK = "tagKeys";
var _xacc = "x-amz-client-context";
var _xadea = "x-amz-durable-execution-arn";
var _xaden = "x-amz-durable-execution-name";
var _xaev = "x-amz-executed-version";
var _xafe = "x-amz-function-error";
var _xait = "x-amz-invocation-type";
var _xalr = "x-amz-log-result";
var _xalt = "x-amz-log-type";

// src/commands/AddLayerVersionPermissionCommand.ts
var AddLayerVersionPermissionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "AddLayerVersionPermissionCommand");
  }
};

// src/commands/AddPermissionCommand.ts

var AddPermissionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "AddPermissionCommand");
  }
};

// src/commands/CheckpointDurableExecutionCommand.ts

var CheckpointDurableExecutionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CheckpointDurableExecutionCommand");
  }
};

// src/commands/CreateAliasCommand.ts

var CreateAliasCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CreateAliasCommand");
  }
};

// src/commands/CreateCodeSigningConfigCommand.ts

var CreateCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CreateCodeSigningConfigCommand");
  }
};

// src/commands/CreateEventSourceMappingCommand.ts

var CreateEventSourceMappingCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CreateEventSourceMappingCommand");
  }
};

// src/commands/CreateFunctionCommand.ts

var CreateFunctionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CreateFunctionCommand");
  }
};

// src/commands/CreateFunctionUrlConfigCommand.ts

var CreateFunctionUrlConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "CreateFunctionUrlConfigCommand");
  }
};

// src/commands/DeleteAliasCommand.ts

var DeleteAliasCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteAliasCommand");
  }
};

// src/commands/DeleteCodeSigningConfigCommand.ts

var DeleteCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteCodeSigningConfigCommand");
  }
};

// src/commands/DeleteEventSourceMappingCommand.ts

var DeleteEventSourceMappingCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteEventSourceMappingCommand");
  }
};

// src/commands/DeleteFunctionCodeSigningConfigCommand.ts

var DeleteFunctionCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteFunctionCodeSigningConfigCommand");
  }
};

// src/commands/DeleteFunctionCommand.ts

var DeleteFunctionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteFunctionCommand");
  }
};

// src/commands/DeleteFunctionConcurrencyCommand.ts

var DeleteFunctionConcurrencyCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteFunctionConcurrencyCommand");
  }
};

// src/commands/DeleteFunctionEventInvokeConfigCommand.ts

var DeleteFunctionEventInvokeConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteFunctionEventInvokeConfigCommand");
  }
};

// src/commands/DeleteFunctionUrlConfigCommand.ts

var DeleteFunctionUrlConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteFunctionUrlConfigCommand");
  }
};

// src/commands/DeleteLayerVersionCommand.ts

var DeleteLayerVersionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteLayerVersionCommand");
  }
};

// src/commands/DeleteProvisionedConcurrencyConfigCommand.ts

var DeleteProvisionedConcurrencyConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "DeleteProvisionedConcurrencyConfigCommand");
  }
};

// src/commands/GetAccountSettingsCommand.ts

var GetAccountSettingsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetAccountSettingsCommand");
  }
};

// src/commands/GetAliasCommand.ts

var GetAliasCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetAliasCommand");
  }
};

// src/commands/GetCodeSigningConfigCommand.ts

var GetCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetCodeSigningConfigCommand");
  }
};

// src/commands/GetDurableExecutionCommand.ts

var GetDurableExecutionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetDurableExecutionCommand");
  }
};

// src/commands/GetDurableExecutionHistoryCommand.ts

var GetDurableExecutionHistoryCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetDurableExecutionHistoryCommand");
  }
};

// src/commands/GetDurableExecutionStateCommand.ts

var GetDurableExecutionStateCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetDurableExecutionStateCommand");
  }
};

// src/commands/GetEventSourceMappingCommand.ts

var GetEventSourceMappingCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetEventSourceMappingCommand");
  }
};

// src/commands/GetFunctionCodeSigningConfigCommand.ts

var GetFunctionCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionCodeSigningConfigCommand");
  }
};

// src/commands/GetFunctionCommand.ts

var GetFunctionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionCommand");
  }
};

// src/commands/GetFunctionConcurrencyCommand.ts

var GetFunctionConcurrencyCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionConcurrencyCommand");
  }
};

// src/commands/GetFunctionConfigurationCommand.ts

var GetFunctionConfigurationCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionConfigurationCommand");
  }
};

// src/commands/GetFunctionEventInvokeConfigCommand.ts

var GetFunctionEventInvokeConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionEventInvokeConfigCommand");
  }
};

// src/commands/GetFunctionRecursionConfigCommand.ts

var GetFunctionRecursionConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionRecursionConfigCommand");
  }
};

// src/commands/GetFunctionUrlConfigCommand.ts

var GetFunctionUrlConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetFunctionUrlConfigCommand");
  }
};

// src/commands/GetLayerVersionByArnCommand.ts

var GetLayerVersionByArnCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetLayerVersionByArnCommand");
  }
};

// src/commands/GetLayerVersionCommand.ts

var GetLayerVersionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetLayerVersionCommand");
  }
};

// src/commands/GetLayerVersionPolicyCommand.ts

var GetLayerVersionPolicyCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetLayerVersionPolicyCommand");
  }
};

// src/commands/GetPolicyCommand.ts

var GetPolicyCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetPolicyCommand");
  }
};

// src/commands/GetProvisionedConcurrencyConfigCommand.ts

var GetProvisionedConcurrencyConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetProvisionedConcurrencyConfigCommand");
  }
};

// src/commands/GetRuntimeManagementConfigCommand.ts

var GetRuntimeManagementConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "GetRuntimeManagementConfigCommand");
  }
};

// src/commands/InvokeAsyncCommand.ts

var InvokeAsyncCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "InvokeAsyncCommand");
  }
};

// src/commands/InvokeCommand.ts

var InvokeCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "InvokeCommand");
  }
};

// src/commands/InvokeWithResponseStreamCommand.ts

var InvokeWithResponseStreamCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
        config,
        Command.getEndpointParameterInstructions(),
      ),
    ];
  })
  .s("AWSGirApiService", "InvokeWithResponseStream", {
    /**
     * @internal
     */
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
  .build() {
  static {
    __name(this, "InvokeWithResponseStreamCommand");
  }
};

// src/commands/ListAliasesCommand.ts

var ListAliasesCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListAliasesCommand");
  }
};

// src/commands/ListCodeSigningConfigsCommand.ts

var ListCodeSigningConfigsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListCodeSigningConfigsCommand");
  }
};

// src/commands/ListDurableExecutionsByFunctionCommand.ts

var ListDurableExecutionsByFunctionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListDurableExecutionsByFunctionCommand");
  }
};

// src/commands/ListEventSourceMappingsCommand.ts

var ListEventSourceMappingsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListEventSourceMappingsCommand");
  }
};

// src/commands/ListFunctionEventInvokeConfigsCommand.ts

var ListFunctionEventInvokeConfigsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListFunctionEventInvokeConfigsCommand");
  }
};

// src/commands/ListFunctionsByCodeSigningConfigCommand.ts

var ListFunctionsByCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListFunctionsByCodeSigningConfigCommand");
  }
};

// src/commands/ListFunctionsCommand.ts

var ListFunctionsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListFunctionsCommand");
  }
};

// src/commands/ListFunctionUrlConfigsCommand.ts

var ListFunctionUrlConfigsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListFunctionUrlConfigsCommand");
  }
};

// src/commands/ListLayersCommand.ts

var ListLayersCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListLayersCommand");
  }
};

// src/commands/ListLayerVersionsCommand.ts

var ListLayerVersionsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListLayerVersionsCommand");
  }
};

// src/commands/ListProvisionedConcurrencyConfigsCommand.ts

var ListProvisionedConcurrencyConfigsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListProvisionedConcurrencyConfigsCommand");
  }
};

// src/commands/ListTagsCommand.ts

var ListTagsCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListTagsCommand");
  }
};

// src/commands/ListVersionsByFunctionCommand.ts

var ListVersionsByFunctionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "ListVersionsByFunctionCommand");
  }
};

// src/commands/PublishLayerVersionCommand.ts

var PublishLayerVersionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PublishLayerVersionCommand");
  }
};

// src/commands/PublishVersionCommand.ts

var PublishVersionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PublishVersionCommand");
  }
};

// src/commands/PutFunctionCodeSigningConfigCommand.ts

var PutFunctionCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutFunctionCodeSigningConfigCommand");
  }
};

// src/commands/PutFunctionConcurrencyCommand.ts

var PutFunctionConcurrencyCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutFunctionConcurrencyCommand");
  }
};

// src/commands/PutFunctionEventInvokeConfigCommand.ts

var PutFunctionEventInvokeConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutFunctionEventInvokeConfigCommand");
  }
};

// src/commands/PutFunctionRecursionConfigCommand.ts

var PutFunctionRecursionConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutFunctionRecursionConfigCommand");
  }
};

// src/commands/PutProvisionedConcurrencyConfigCommand.ts

var PutProvisionedConcurrencyConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutProvisionedConcurrencyConfigCommand");
  }
};

// src/commands/PutRuntimeManagementConfigCommand.ts

var PutRuntimeManagementConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "PutRuntimeManagementConfigCommand");
  }
};

// src/commands/RemoveLayerVersionPermissionCommand.ts

var RemoveLayerVersionPermissionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "RemoveLayerVersionPermissionCommand");
  }
};

// src/commands/RemovePermissionCommand.ts

var RemovePermissionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "RemovePermissionCommand");
  }
};

// src/commands/SendDurableExecutionCallbackFailureCommand.ts

// src/models/models_1.ts

var SendDurableExecutionCallbackFailureRequestFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
    }),
    "SendDurableExecutionCallbackFailureRequestFilterSensitiveLog",
  );
var SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog =
  /* @__PURE__ */ __name(
    (obj) => ({
      ...obj,
      ...(obj.Result && { Result: import_smithy_client.SENSITIVE_STRING }),
    }),
    "SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog",
  );
var StopDurableExecutionRequestFilterSensitiveLog = /* @__PURE__ */ __name(
  (obj) => ({
    ...obj,
    ...(obj.Error && { Error: ErrorObjectFilterSensitiveLog(obj.Error) }),
  }),
  "StopDurableExecutionRequestFilterSensitiveLog",
);

// src/commands/SendDurableExecutionCallbackFailureCommand.ts
var SendDurableExecutionCallbackFailureCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "SendDurableExecutionCallbackFailureCommand");
  }
};

// src/commands/SendDurableExecutionCallbackHeartbeatCommand.ts

var SendDurableExecutionCallbackHeartbeatCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "SendDurableExecutionCallbackHeartbeatCommand");
  }
};

// src/commands/SendDurableExecutionCallbackSuccessCommand.ts

var SendDurableExecutionCallbackSuccessCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "SendDurableExecutionCallbackSuccessCommand");
  }
};

// src/commands/StopDurableExecutionCommand.ts

var StopDurableExecutionCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "StopDurableExecutionCommand");
  }
};

// src/commands/TagResourceCommand.ts

var TagResourceCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "TagResourceCommand");
  }
};

// src/commands/UntagResourceCommand.ts

var UntagResourceCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UntagResourceCommand");
  }
};

// src/commands/UpdateAliasCommand.ts

var UpdateAliasCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateAliasCommand");
  }
};

// src/commands/UpdateCodeSigningConfigCommand.ts

var UpdateCodeSigningConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateCodeSigningConfigCommand");
  }
};

// src/commands/UpdateEventSourceMappingCommand.ts

var UpdateEventSourceMappingCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateEventSourceMappingCommand");
  }
};

// src/commands/UpdateFunctionCodeCommand.ts

var UpdateFunctionCodeCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateFunctionCodeCommand");
  }
};

// src/commands/UpdateFunctionConfigurationCommand.ts

var UpdateFunctionConfigurationCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateFunctionConfigurationCommand");
  }
};

// src/commands/UpdateFunctionEventInvokeConfigCommand.ts

var UpdateFunctionEventInvokeConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateFunctionEventInvokeConfigCommand");
  }
};

// src/commands/UpdateFunctionUrlConfigCommand.ts

var UpdateFunctionUrlConfigCommand = class extends import_smithy_client.Command.classBuilder()
  .ep(commonParams)
  .m(function (Command, cs, config, o) {
    return [
      (0, import_middleware_serde.getSerdePlugin)(
        config,
        this.serialize,
        this.deserialize,
      ),
      (0, import_middleware_endpoint.getEndpointPlugin)(
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
  .build() {
  static {
    __name(this, "UpdateFunctionUrlConfigCommand");
  }
};

// src/Lambda.ts
var commands = {
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
var Lambda = class extends LambdaClient {
  static {
    __name(this, "Lambda");
  }
};
(0, import_smithy_client.createAggregatedClient)(commands, Lambda);

// src/pagination/GetDurableExecutionHistoryPaginator.ts

var paginateGetDurableExecutionHistory = (0, import_core.createPaginator)(
  LambdaClient,
  GetDurableExecutionHistoryCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/GetDurableExecutionStatePaginator.ts

var paginateGetDurableExecutionState = (0, import_core.createPaginator)(
  LambdaClient,
  GetDurableExecutionStateCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListAliasesPaginator.ts

var paginateListAliases = (0, import_core.createPaginator)(
  LambdaClient,
  ListAliasesCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListCodeSigningConfigsPaginator.ts

var paginateListCodeSigningConfigs = (0, import_core.createPaginator)(
  LambdaClient,
  ListCodeSigningConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListDurableExecutionsByFunctionPaginator.ts

var paginateListDurableExecutionsByFunction = (0, import_core.createPaginator)(
  LambdaClient,
  ListDurableExecutionsByFunctionCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListEventSourceMappingsPaginator.ts

var paginateListEventSourceMappings = (0, import_core.createPaginator)(
  LambdaClient,
  ListEventSourceMappingsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListFunctionEventInvokeConfigsPaginator.ts

var paginateListFunctionEventInvokeConfigs = (0, import_core.createPaginator)(
  LambdaClient,
  ListFunctionEventInvokeConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListFunctionUrlConfigsPaginator.ts

var paginateListFunctionUrlConfigs = (0, import_core.createPaginator)(
  LambdaClient,
  ListFunctionUrlConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListFunctionsByCodeSigningConfigPaginator.ts

var paginateListFunctionsByCodeSigningConfig = (0, import_core.createPaginator)(
  LambdaClient,
  ListFunctionsByCodeSigningConfigCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListFunctionsPaginator.ts

var paginateListFunctions = (0, import_core.createPaginator)(
  LambdaClient,
  ListFunctionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListLayerVersionsPaginator.ts

var paginateListLayerVersions = (0, import_core.createPaginator)(
  LambdaClient,
  ListLayerVersionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListLayersPaginator.ts

var paginateListLayers = (0, import_core.createPaginator)(
  LambdaClient,
  ListLayersCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListProvisionedConcurrencyConfigsPaginator.ts

var paginateListProvisionedConcurrencyConfigs = (0,
import_core.createPaginator)(
  LambdaClient,
  ListProvisionedConcurrencyConfigsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/pagination/ListVersionsByFunctionPaginator.ts

var paginateListVersionsByFunction = (0, import_core.createPaginator)(
  LambdaClient,
  ListVersionsByFunctionCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);

// src/waiters/waitForFunctionActive.ts
var import_util_waiter = require("@smithy/util-waiter");
var checkState = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Active") {
        return { state: import_util_waiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Failed") {
        return { state: import_util_waiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Pending") {
        return { state: import_util_waiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForFunctionActive = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  return (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
}, "waitForFunctionActive");
var waitUntilFunctionActive = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  const result = await (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
  return (0, import_util_waiter.checkExceptions)(result);
}, "waitUntilFunctionActive");

// src/waiters/waitForFunctionActiveV2.ts

var checkState2 = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.State;
      }, "returnComparator");
      if (returnComparator() === "Active") {
        return { state: import_util_waiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.State;
      }, "returnComparator");
      if (returnComparator() === "Failed") {
        return { state: import_util_waiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.State;
      }, "returnComparator");
      if (returnComparator() === "Pending") {
        return { state: import_util_waiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForFunctionActiveV2 = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  return (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState2,
  );
}, "waitForFunctionActiveV2");
var waitUntilFunctionActiveV2 = /* @__PURE__ */ __name(
  async (params, input) => {
    const serviceDefaults = { minDelay: 1, maxDelay: 300 };
    const result = await (0, import_util_waiter.createWaiter)(
      { ...serviceDefaults, ...params },
      input,
      checkState2,
    );
    return (0, import_util_waiter.checkExceptions)(result);
  },
  "waitUntilFunctionActiveV2",
);

// src/waiters/waitForFunctionExists.ts

var checkState3 = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    return { state: import_util_waiter.WaiterState.SUCCESS, reason };
  } catch (exception) {
    reason = exception;
    if (exception.name && exception.name == "ResourceNotFoundException") {
      return { state: import_util_waiter.WaiterState.RETRY, reason };
    }
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForFunctionExists = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 20 };
  return (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState3,
  );
}, "waitForFunctionExists");
var waitUntilFunctionExists = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 20 };
  const result = await (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState3,
  );
  return (0, import_util_waiter.checkExceptions)(result);
}, "waitUntilFunctionExists");

// src/waiters/waitForFunctionUpdated.ts

var checkState4 = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "Successful") {
        return { state: import_util_waiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "Failed") {
        return { state: import_util_waiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "InProgress") {
        return { state: import_util_waiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForFunctionUpdated = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  return (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState4,
  );
}, "waitForFunctionUpdated");
var waitUntilFunctionUpdated = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 5, maxDelay: 300 };
  const result = await (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState4,
  );
  return (0, import_util_waiter.checkExceptions)(result);
}, "waitUntilFunctionUpdated");

// src/waiters/waitForFunctionUpdatedV2.ts

var checkState5 = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(new GetFunctionCommand(input));
    reason = result;
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "Successful") {
        return { state: import_util_waiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "Failed") {
        return { state: import_util_waiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.Configuration.LastUpdateStatus;
      }, "returnComparator");
      if (returnComparator() === "InProgress") {
        return { state: import_util_waiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForFunctionUpdatedV2 = /* @__PURE__ */ __name(async (params, input) => {
  const serviceDefaults = { minDelay: 1, maxDelay: 300 };
  return (0, import_util_waiter.createWaiter)(
    { ...serviceDefaults, ...params },
    input,
    checkState5,
  );
}, "waitForFunctionUpdatedV2");
var waitUntilFunctionUpdatedV2 = /* @__PURE__ */ __name(
  async (params, input) => {
    const serviceDefaults = { minDelay: 1, maxDelay: 300 };
    const result = await (0, import_util_waiter.createWaiter)(
      { ...serviceDefaults, ...params },
      input,
      checkState5,
    );
    return (0, import_util_waiter.checkExceptions)(result);
  },
  "waitUntilFunctionUpdatedV2",
);

// src/waiters/waitForPublishedVersionActive.ts

var checkState6 = /* @__PURE__ */ __name(async (client, input) => {
  let reason;
  try {
    const result = await client.send(
      new GetFunctionConfigurationCommand(input),
    );
    reason = result;
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Active") {
        return { state: import_util_waiter.WaiterState.SUCCESS, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Failed") {
        return { state: import_util_waiter.WaiterState.FAILURE, reason };
      }
    } catch (e) {}
    try {
      const returnComparator = /* @__PURE__ */ __name(() => {
        return result.State;
      }, "returnComparator");
      if (returnComparator() === "Pending") {
        return { state: import_util_waiter.WaiterState.RETRY, reason };
      }
    } catch (e) {}
  } catch (exception) {
    reason = exception;
  }
  return { state: import_util_waiter.WaiterState.RETRY, reason };
}, "checkState");
var waitForPublishedVersionActive = /* @__PURE__ */ __name(
  async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 1560 };
    return (0, import_util_waiter.createWaiter)(
      { ...serviceDefaults, ...params },
      input,
      checkState6,
    );
  },
  "waitForPublishedVersionActive",
);
var waitUntilPublishedVersionActive = /* @__PURE__ */ __name(
  async (params, input) => {
    const serviceDefaults = { minDelay: 5, maxDelay: 1560 };
    const result = await (0, import_util_waiter.createWaiter)(
      { ...serviceDefaults, ...params },
      input,
      checkState6,
    );
    return (0, import_util_waiter.checkExceptions)(result);
  },
  "waitUntilPublishedVersionActive",
);
// Annotate the CommonJS export names for ESM import in node:

0 &&
  (module.exports = {
    LambdaServiceException,
    __Client,
    LambdaClient,
    Lambda,
    $Command,
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
    DeleteFunctionCodeSigningConfigCommand,
    DeleteFunctionCommand,
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
    GetFunctionCodeSigningConfigCommand,
    GetFunctionCommand,
    GetFunctionConcurrencyCommand,
    GetFunctionConfigurationCommand,
    GetFunctionEventInvokeConfigCommand,
    GetFunctionRecursionConfigCommand,
    GetFunctionUrlConfigCommand,
    GetLayerVersionByArnCommand,
    GetLayerVersionCommand,
    GetLayerVersionPolicyCommand,
    GetPolicyCommand,
    GetProvisionedConcurrencyConfigCommand,
    GetRuntimeManagementConfigCommand,
    InvokeAsyncCommand,
    InvokeCommand,
    InvokeWithResponseStreamCommand,
    ListAliasesCommand,
    ListCodeSigningConfigsCommand,
    ListDurableExecutionsByFunctionCommand,
    ListEventSourceMappingsCommand,
    ListFunctionEventInvokeConfigsCommand,
    ListFunctionUrlConfigsCommand,
    ListFunctionsByCodeSigningConfigCommand,
    ListFunctionsCommand,
    ListLayerVersionsCommand,
    ListLayersCommand,
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
    paginateGetDurableExecutionHistory,
    paginateGetDurableExecutionState,
    paginateListAliases,
    paginateListCodeSigningConfigs,
    paginateListDurableExecutionsByFunction,
    paginateListEventSourceMappings,
    paginateListFunctionEventInvokeConfigs,
    paginateListFunctionUrlConfigs,
    paginateListFunctionsByCodeSigningConfig,
    paginateListFunctions,
    paginateListLayerVersions,
    paginateListLayers,
    paginateListProvisionedConcurrencyConfigs,
    paginateListVersionsByFunction,
    waitForFunctionActive,
    waitUntilFunctionActive,
    waitForFunctionActiveV2,
    waitUntilFunctionActiveV2,
    waitForFunctionExists,
    waitUntilFunctionExists,
    waitForFunctionUpdated,
    waitUntilFunctionUpdated,
    waitForFunctionUpdatedV2,
    waitUntilFunctionUpdatedV2,
    waitForPublishedVersionActive,
    waitUntilPublishedVersionActive,
    InvalidParameterValueException,
    PolicyLengthExceededException,
    PreconditionFailedException,
    ResourceConflictException,
    ResourceNotFoundException,
    ServiceException,
    ThrottleReason,
    TooManyRequestsException,
    FunctionUrlAuthType,
    KafkaSchemaRegistryAuthType,
    SchemaRegistryEventRecordFormat,
    KafkaSchemaValidationAttribute,
    ApplicationLogLevel,
    Architecture,
    OperationAction,
    OperationType,
    OperationStatus,
    CodeSigningPolicy,
    FullDocument,
    FunctionResponseType,
    EventSourceMappingMetric,
    EndPointType,
    SourceAccessType,
    EventSourcePosition,
    ResourceInUseException,
    CodeSigningConfigNotFoundException,
    CodeStorageExceededException,
    CodeVerificationFailedException,
    LogFormat,
    SystemLogLevel,
    PackageType,
    Runtime,
    SnapStartApplyOn,
    TracingMode,
    LastUpdateStatus,
    LastUpdateStatusReasonCode,
    SnapStartOptimizationStatus,
    State,
    StateReasonCode,
    InvalidCodeSignatureException,
    InvokeMode,
    RecursiveLoop,
    UpdateRuntimeOn,
    DurableExecutionAlreadyStartedException,
    EC2AccessDeniedException,
    EC2ThrottledException,
    EC2UnexpectedException,
    EFSIOException,
    EFSMountConnectivityException,
    EFSMountFailureException,
    EFSMountTimeoutException,
    ENILimitReachedException,
    InvalidRequestContentException,
    InvalidRuntimeException,
    InvalidSecurityGroupIDException,
    InvalidSubnetIDException,
    InvalidZipFileException,
    InvocationType,
    LogType,
    KMSAccessDeniedException,
    KMSDisabledException,
    KMSInvalidStateException,
    KMSNotFoundException,
    RecursiveInvocationException,
    RequestTooLargeException,
    ResourceNotReadyException,
    SnapStartException,
    SnapStartNotReadyException,
    SnapStartTimeoutException,
    SubnetIPAddressLimitReachedException,
    UnsupportedMediaTypeException,
    ResponseStreamingInvocationType,
    InvokeWithResponseStreamResponseEvent,
    FunctionVersion,
    ProvisionedConcurrencyStatusEnum,
    ExecutionStatus,
    EventType,
    ProvisionedConcurrencyConfigNotFoundException,
    CallbackTimeoutException,
    ErrorObjectFilterSensitiveLog,
    OperationUpdateFilterSensitiveLog,
    CheckpointDurableExecutionRequestFilterSensitiveLog,
    CallbackDetailsFilterSensitiveLog,
    ChainedInvokeDetailsFilterSensitiveLog,
    ContextDetailsFilterSensitiveLog,
    ExecutionDetailsFilterSensitiveLog,
    StepDetailsFilterSensitiveLog,
    OperationFilterSensitiveLog,
    CheckpointUpdatedExecutionStateFilterSensitiveLog,
    CheckpointDurableExecutionResponseFilterSensitiveLog,
    FunctionCodeFilterSensitiveLog,
    EnvironmentFilterSensitiveLog,
    CreateFunctionRequestFilterSensitiveLog,
    EnvironmentErrorFilterSensitiveLog,
    EnvironmentResponseFilterSensitiveLog,
    ImageConfigErrorFilterSensitiveLog,
    ImageConfigResponseFilterSensitiveLog,
    RuntimeVersionErrorFilterSensitiveLog,
    RuntimeVersionConfigFilterSensitiveLog,
    FunctionConfigurationFilterSensitiveLog,
    GetFunctionResponseFilterSensitiveLog,
    InvocationRequestFilterSensitiveLog,
    InvocationResponseFilterSensitiveLog,
    InvokeAsyncRequestFilterSensitiveLog,
    InvokeWithResponseStreamRequestFilterSensitiveLog,
    InvokeResponseStreamUpdateFilterSensitiveLog,
    InvokeWithResponseStreamResponseEventFilterSensitiveLog,
    InvokeWithResponseStreamResponseFilterSensitiveLog,
    ListFunctionsResponseFilterSensitiveLog,
    UpdateFunctionCodeRequestFilterSensitiveLog,
    UpdateFunctionConfigurationRequestFilterSensitiveLog,
    ListVersionsByFunctionResponseFilterSensitiveLog,
    GetDurableExecutionResponseFilterSensitiveLog,
    EventErrorFilterSensitiveLog,
    CallbackFailedDetailsFilterSensitiveLog,
    EventResultFilterSensitiveLog,
    CallbackSucceededDetailsFilterSensitiveLog,
    CallbackTimedOutDetailsFilterSensitiveLog,
    ChainedInvokeFailedDetailsFilterSensitiveLog,
    EventInputFilterSensitiveLog,
    ChainedInvokePendingDetailsFilterSensitiveLog,
    ChainedInvokeStoppedDetailsFilterSensitiveLog,
    ChainedInvokeSucceededDetailsFilterSensitiveLog,
    ChainedInvokeTimedOutDetailsFilterSensitiveLog,
    ContextFailedDetailsFilterSensitiveLog,
    ContextSucceededDetailsFilterSensitiveLog,
    ExecutionFailedDetailsFilterSensitiveLog,
    ExecutionStartedDetailsFilterSensitiveLog,
    ExecutionStoppedDetailsFilterSensitiveLog,
    ExecutionSucceededDetailsFilterSensitiveLog,
    ExecutionTimedOutDetailsFilterSensitiveLog,
    InvocationCompletedDetailsFilterSensitiveLog,
    StepFailedDetailsFilterSensitiveLog,
    StepSucceededDetailsFilterSensitiveLog,
    WaitCancelledDetailsFilterSensitiveLog,
    EventFilterSensitiveLog,
    GetDurableExecutionHistoryResponseFilterSensitiveLog,
    GetDurableExecutionStateResponseFilterSensitiveLog,
    LayerVersionContentInputFilterSensitiveLog,
    PublishLayerVersionRequestFilterSensitiveLog,
    SendDurableExecutionCallbackFailureRequestFilterSensitiveLog,
    SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog,
    StopDurableExecutionRequestFilterSensitiveLog,
  });
