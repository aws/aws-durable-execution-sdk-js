"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.se_GetDurableExecutionStateCommand = exports.se_GetDurableExecutionHistoryCommand = exports.se_GetDurableExecutionCommand = exports.se_GetCodeSigningConfigCommand = exports.se_GetAliasInternalCommand = exports.se_GetAlias20150331Command = exports.se_GetAccountSettingsInternalCommand = exports.se_GetAccountSettings20160819Command = exports.se_GetAccountSettings20150331Command = exports.se_GetAccountRiskSettingsCommand = exports.se_ExportProvisionedConcurrencyConfigCommand = exports.se_ExportLayerVersionCommand = exports.se_ExportFunctionVersionCommand = exports.se_ExportFunctionUrlConfigsCommand = exports.se_ExportAliasCommand = exports.se_ExportAccountSettingsCommand = exports.se_EnableReplication20170630v2Command = exports.se_EnableReplication20170630Command = exports.se_DisableReplication20170630Command = exports.se_DisablePublicAccessBlockConfigCommand = exports.se_DisableFunctionCommand = exports.se_DeleteResourcePolicyCommand = exports.se_DeleteProvisionedConcurrencyConfigCommand = exports.se_DeleteMigratedLayerVersionCommand = exports.se_DeleteLayerVersion20181031Command = exports.se_DeleteFunctionVersionResourcesInternalCommand = exports.se_DeleteFunctionVersionResourceMappingCommand = exports.se_DeleteFunctionUrlConfigCommand = exports.se_DeleteFunctionResourceMappingCommand = exports.se_DeleteFunctionInternalCommand = exports.se_DeleteFunctionEventInvokeConfigCommand = exports.se_DeleteFunctionConcurrency20171031Command = exports.se_DeleteFunctionCodeSigningConfigCommand = exports.se_DeleteFunctionAliasResourceMappingCommand = exports.se_DeleteFunction20150331Command = exports.se_DeleteFunctionCommand = exports.se_DeleteEventSourceMapping20150331Command = exports.se_DeleteCodeSigningConfigCommand = exports.se_DeleteAlias20150331Command = exports.se_DeleteAccountSettingsInternalCommand = exports.se_CreateFunctionUrlConfigCommand = exports.se_CreateFunction20150331Command = exports.se_CreateEventSourceMapping20150331Command = exports.se_CreateCodeSigningConfigCommand = exports.se_CreateAlias20150331Command = exports.se_CheckpointDurableExecutionCommand = exports.se_AddPermission20150331v2Command = exports.se_AddPermission20150331Command = exports.se_AddLayerVersionPermission20181031Command = exports.se_AddEventSourceCommand = void 0;
exports.se_ListFunctionCountersInternalCommand = exports.se_ListFunctionAliasResourceMappingsCommand = exports.se_ListEventSourcesCommand = exports.se_ListEventSourceMappingsInternalCommand = exports.se_ListEventSourceMappings20150331Command = exports.se_ListDurableExecutionsCommand = exports.se_ListCodeSigningConfigsCommand = exports.se_ListAliasesInternalCommand = exports.se_ListAliases20150331Command = exports.se_InvokeWithResponseStreamCommand = exports.se_InvokeAsyncCommand = exports.se_Invoke20150331Command = exports.se_InformTagrisAfterResourceCreationCommand = exports.se_ImportProvisionedConcurrencyConfigCommand = exports.se_ImportLayerVersionCommand = exports.se_ImportFunctionVersionCommand = exports.se_ImportFunctionUrlConfigsCommand = exports.se_ImportFunctionCounterCommand = exports.se_ImportAliasCommand = exports.se_ImportAccountSettingsCommand = exports.se_GetVersionSandboxSpecCommand = exports.se_GetVersionProvisionedConcurrencyStatusCommand = exports.se_GetRuntimeManagementConfigCommand = exports.se_GetResourcePolicyCommand = exports.se_GetPublicAccessBlockConfigCommand = exports.se_GetProvisionedConcurrencyConfigCommand = exports.se_GetPolicy20150331v2Command = exports.se_GetPolicy20150331Command = exports.se_GetLayerVersionPolicyInternalCommand = exports.se_GetLayerVersionPolicy20181031Command = exports.se_GetLayerVersionInternalCommand = exports.se_GetLayerVersionByArn20181031Command = exports.se_GetLayerVersion20181031Command = exports.se_GetLatestLayerVersionInfoInternalCommand = exports.se_GetFunctionUrlConfigCommand = exports.se_GetFunctionScalingConfigCommand = exports.se_GetFunctionRecursionConfigCommand = exports.se_GetFunctionInternalCommand = exports.se_GetFunctionEventInvokeConfigCommand = exports.se_GetFunctionConfiguration20150331v2Command = exports.se_GetFunctionConfiguration20150331Command = exports.se_GetFunctionConfigurationCommand = exports.se_GetFunctionConcurrencyCommand = exports.se_GetFunctionCodeSigningConfigCommand = exports.se_GetFunction20150331v2Command = exports.se_GetFunction20150331Command = exports.se_GetFunctionCommand = exports.se_GetEventSourceMappingInternalCommand = exports.se_GetEventSourceMapping20150331Command = exports.se_GetEventSourceCommand = void 0;
exports.se_TagResource20170331v2Command = exports.se_TagResource20170331Command = exports.se_StopDurableExecutionCommand = exports.se_SetAccountSettings20170430Command = exports.se_SetAccountRiskSettingsCommand = exports.se_SendDurableExecutionCallbackSuccessCommand = exports.se_SendDurableExecutionCallbackHeartbeatCommand = exports.se_SendDurableExecutionCallbackFailureCommand = exports.se_SafeDeleteProvisionedConcurrencyConfigCommand = exports.se_RollbackTagsOwnershipFromLambdaCommand = exports.se_RollbackFunctionCommand = exports.se_ResignFunctionVersionCommand = exports.se_ResignFunctionAliasCommand = exports.se_ResetFunctionFeatureInternalCommand = exports.se_RemovePermission20150331v2Command = exports.se_RemovePermission20150331Command = exports.se_RemoveLayerVersionPermission20181031Command = exports.se_RemoveEventSourceCommand = exports.se_RedriveFunctionResourceTagsCommand = exports.se_ReconcileProvisionedConcurrencyCommand = exports.se_PutRuntimeManagementConfigCommand = exports.se_PutResourcePolicyCommand = exports.se_PutPublicAccessBlockConfigCommand = exports.se_PutProvisionedConcurrencyConfigCommand = exports.se_PutFunctionVersionResourceMappingCommand = exports.se_PutFunctionScalingConfigCommand = exports.se_PutFunctionResourceMappingCommand = exports.se_PutFunctionRecursionConfigCommand = exports.se_PutFunctionEventInvokeConfigCommand = exports.se_PutFunctionConcurrency20171031Command = exports.se_PutFunctionCodeSigningConfigCommand = exports.se_PutFunctionAliasResourceMappingCommand = exports.se_PublishVersion20150331Command = exports.se_PublishLayerVersion20181031Command = exports.se_ListVersionsByFunction20150331Command = exports.se_ListTags20170331Command = exports.se_ListProvisionedConcurrencyConfigsByAccountIdCommand = exports.se_ListProvisionedConcurrencyConfigsCommand = exports.se_ListLayerVersionsInternalCommand = exports.se_ListLayerVersions20181031Command = exports.se_ListLayers20181031Command = exports.se_ListFunctionVersionsInternalCommand = exports.se_ListFunctionVersionResourceMappingsCommand = exports.se_ListFunctionUrlsInternalCommand = exports.se_ListFunctionUrlConfigsCommand = exports.se_ListFunctionsByCodeSigningConfigCommand = exports.se_ListFunctions20150331Command = exports.se_ListFunctionsCommand = exports.se_ListFunctionResourceMappingsCommand = exports.se_ListFunctionEventInvokeConfigsCommand = void 0;
exports.de_DeleteProvisionedConcurrencyConfigCommand = exports.de_DeleteMigratedLayerVersionCommand = exports.de_DeleteLayerVersion20181031Command = exports.de_DeleteFunctionVersionResourcesInternalCommand = exports.de_DeleteFunctionVersionResourceMappingCommand = exports.de_DeleteFunctionUrlConfigCommand = exports.de_DeleteFunctionResourceMappingCommand = exports.de_DeleteFunctionInternalCommand = exports.de_DeleteFunctionEventInvokeConfigCommand = exports.de_DeleteFunctionConcurrency20171031Command = exports.de_DeleteFunctionCodeSigningConfigCommand = exports.de_DeleteFunctionAliasResourceMappingCommand = exports.de_DeleteFunction20150331Command = exports.de_DeleteFunctionCommand = exports.de_DeleteEventSourceMapping20150331Command = exports.de_DeleteCodeSigningConfigCommand = exports.de_DeleteAlias20150331Command = exports.de_DeleteAccountSettingsInternalCommand = exports.de_CreateFunctionUrlConfigCommand = exports.de_CreateFunction20150331Command = exports.de_CreateEventSourceMapping20150331Command = exports.de_CreateCodeSigningConfigCommand = exports.de_CreateAlias20150331Command = exports.de_CheckpointDurableExecutionCommand = exports.de_AddPermission20150331v2Command = exports.de_AddPermission20150331Command = exports.de_AddLayerVersionPermission20181031Command = exports.de_AddEventSourceCommand = exports.se_ValidateProvisionedConcurrencyFunctionVersionCommand = exports.se_UploadFunctionCommand = exports.se_UpdateVersionProvisionedConcurrencyStatusCommand = exports.se_UpdateProvisionedConcurrencyConfigCommand = exports.se_UpdateFunctionVersionResourceMappingCommand = exports.se_UpdateFunctionUrlConfigCommand = exports.se_UpdateFunctionEventInvokeConfigCommand = exports.se_UpdateFunctionConfiguration20150331v2Command = exports.se_UpdateFunctionConfiguration20150331Command = exports.se_UpdateFunctionConfigurationCommand = exports.se_UpdateFunctionCode20150331v2Command = exports.se_UpdateFunctionCode20150331Command = exports.se_UpdateFunctionCodeCommand = exports.se_UpdateEventSourceMapping20150331Command = exports.se_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = exports.se_UpdateCodeSigningConfigCommand = exports.se_UpdateAlias20150331Command = exports.se_UpdateAccountSettingsInternalCommand = exports.se_UntagResource20170331v2Command = exports.se_UntagResource20170331Command = exports.se_TransferTagsOwnershipToLambdaCommand = exports.se_TagResourceBeforeResourceCreationCommand = void 0;
exports.de_GetRuntimeManagementConfigCommand = exports.de_GetResourcePolicyCommand = exports.de_GetPublicAccessBlockConfigCommand = exports.de_GetProvisionedConcurrencyConfigCommand = exports.de_GetPolicy20150331v2Command = exports.de_GetPolicy20150331Command = exports.de_GetLayerVersionPolicyInternalCommand = exports.de_GetLayerVersionPolicy20181031Command = exports.de_GetLayerVersionInternalCommand = exports.de_GetLayerVersionByArn20181031Command = exports.de_GetLayerVersion20181031Command = exports.de_GetLatestLayerVersionInfoInternalCommand = exports.de_GetFunctionUrlConfigCommand = exports.de_GetFunctionScalingConfigCommand = exports.de_GetFunctionRecursionConfigCommand = exports.de_GetFunctionInternalCommand = exports.de_GetFunctionEventInvokeConfigCommand = exports.de_GetFunctionConfiguration20150331v2Command = exports.de_GetFunctionConfiguration20150331Command = exports.de_GetFunctionConfigurationCommand = exports.de_GetFunctionConcurrencyCommand = exports.de_GetFunctionCodeSigningConfigCommand = exports.de_GetFunction20150331v2Command = exports.de_GetFunction20150331Command = exports.de_GetFunctionCommand = exports.de_GetEventSourceMappingInternalCommand = exports.de_GetEventSourceMapping20150331Command = exports.de_GetEventSourceCommand = exports.de_GetDurableExecutionStateCommand = exports.de_GetDurableExecutionHistoryCommand = exports.de_GetDurableExecutionCommand = exports.de_GetCodeSigningConfigCommand = exports.de_GetAliasInternalCommand = exports.de_GetAlias20150331Command = exports.de_GetAccountSettingsInternalCommand = exports.de_GetAccountSettings20160819Command = exports.de_GetAccountSettings20150331Command = exports.de_GetAccountRiskSettingsCommand = exports.de_ExportProvisionedConcurrencyConfigCommand = exports.de_ExportLayerVersionCommand = exports.de_ExportFunctionVersionCommand = exports.de_ExportFunctionUrlConfigsCommand = exports.de_ExportAliasCommand = exports.de_ExportAccountSettingsCommand = exports.de_EnableReplication20170630v2Command = exports.de_EnableReplication20170630Command = exports.de_DisableReplication20170630Command = exports.de_DisablePublicAccessBlockConfigCommand = exports.de_DisableFunctionCommand = exports.de_DeleteResourcePolicyCommand = void 0;
exports.de_PutPublicAccessBlockConfigCommand = exports.de_PutProvisionedConcurrencyConfigCommand = exports.de_PutFunctionVersionResourceMappingCommand = exports.de_PutFunctionScalingConfigCommand = exports.de_PutFunctionResourceMappingCommand = exports.de_PutFunctionRecursionConfigCommand = exports.de_PutFunctionEventInvokeConfigCommand = exports.de_PutFunctionConcurrency20171031Command = exports.de_PutFunctionCodeSigningConfigCommand = exports.de_PutFunctionAliasResourceMappingCommand = exports.de_PublishVersion20150331Command = exports.de_PublishLayerVersion20181031Command = exports.de_ListVersionsByFunction20150331Command = exports.de_ListTags20170331Command = exports.de_ListProvisionedConcurrencyConfigsByAccountIdCommand = exports.de_ListProvisionedConcurrencyConfigsCommand = exports.de_ListLayerVersionsInternalCommand = exports.de_ListLayerVersions20181031Command = exports.de_ListLayers20181031Command = exports.de_ListFunctionVersionsInternalCommand = exports.de_ListFunctionVersionResourceMappingsCommand = exports.de_ListFunctionUrlsInternalCommand = exports.de_ListFunctionUrlConfigsCommand = exports.de_ListFunctionsByCodeSigningConfigCommand = exports.de_ListFunctions20150331Command = exports.de_ListFunctionsCommand = exports.de_ListFunctionResourceMappingsCommand = exports.de_ListFunctionEventInvokeConfigsCommand = exports.de_ListFunctionCountersInternalCommand = exports.de_ListFunctionAliasResourceMappingsCommand = exports.de_ListEventSourcesCommand = exports.de_ListEventSourceMappingsInternalCommand = exports.de_ListEventSourceMappings20150331Command = exports.de_ListDurableExecutionsCommand = exports.de_ListCodeSigningConfigsCommand = exports.de_ListAliasesInternalCommand = exports.de_ListAliases20150331Command = exports.de_InvokeWithResponseStreamCommand = exports.de_InvokeAsyncCommand = exports.de_Invoke20150331Command = exports.de_InformTagrisAfterResourceCreationCommand = exports.de_ImportProvisionedConcurrencyConfigCommand = exports.de_ImportLayerVersionCommand = exports.de_ImportFunctionVersionCommand = exports.de_ImportFunctionUrlConfigsCommand = exports.de_ImportFunctionCounterCommand = exports.de_ImportAliasCommand = exports.de_ImportAccountSettingsCommand = exports.de_GetVersionSandboxSpecCommand = exports.de_GetVersionProvisionedConcurrencyStatusCommand = void 0;
exports.de_ValidateProvisionedConcurrencyFunctionVersionCommand = exports.de_UploadFunctionCommand = exports.de_UpdateVersionProvisionedConcurrencyStatusCommand = exports.de_UpdateProvisionedConcurrencyConfigCommand = exports.de_UpdateFunctionVersionResourceMappingCommand = exports.de_UpdateFunctionUrlConfigCommand = exports.de_UpdateFunctionEventInvokeConfigCommand = exports.de_UpdateFunctionConfiguration20150331v2Command = exports.de_UpdateFunctionConfiguration20150331Command = exports.de_UpdateFunctionConfigurationCommand = exports.de_UpdateFunctionCode20150331v2Command = exports.de_UpdateFunctionCode20150331Command = exports.de_UpdateFunctionCodeCommand = exports.de_UpdateEventSourceMapping20150331Command = exports.de_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = exports.de_UpdateCodeSigningConfigCommand = exports.de_UpdateAlias20150331Command = exports.de_UpdateAccountSettingsInternalCommand = exports.de_UntagResource20170331v2Command = exports.de_UntagResource20170331Command = exports.de_TransferTagsOwnershipToLambdaCommand = exports.de_TagResourceBeforeResourceCreationCommand = exports.de_TagResource20170331v2Command = exports.de_TagResource20170331Command = exports.de_StopDurableExecutionCommand = exports.de_SetAccountSettings20170430Command = exports.de_SetAccountRiskSettingsCommand = exports.de_SendDurableExecutionCallbackSuccessCommand = exports.de_SendDurableExecutionCallbackHeartbeatCommand = exports.de_SendDurableExecutionCallbackFailureCommand = exports.de_SafeDeleteProvisionedConcurrencyConfigCommand = exports.de_RollbackTagsOwnershipFromLambdaCommand = exports.de_RollbackFunctionCommand = exports.de_ResignFunctionVersionCommand = exports.de_ResignFunctionAliasCommand = exports.de_ResetFunctionFeatureInternalCommand = exports.de_RemovePermission20150331v2Command = exports.de_RemovePermission20150331Command = exports.de_RemoveLayerVersionPermission20181031Command = exports.de_RemoveEventSourceCommand = exports.de_RedriveFunctionResourceTagsCommand = exports.de_ReconcileProvisionedConcurrencyCommand = exports.de_PutRuntimeManagementConfigCommand = exports.de_PutResourcePolicyCommand = void 0;
const LambdaServiceException_1 = require("../models/LambdaServiceException");
const models_0_1 = require("../models/models_0");
const models_1_1 = require("../models/models_1");
const core_1 = require("@aws-sdk/core");
const core_2 = require("@smithy/core");
const smithy_client_1 = require("@smithy/smithy-client");
const se_AddEventSourceCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2014-11-13/event-source-mappings");
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'BatchSize': [],
        'EventSource': [],
        'FunctionName': [],
        'Parameters': _ => (0, smithy_client_1._json)(_),
        'Role': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_AddEventSourceCommand = se_AddEventSourceCommand;
const se_AddLayerVersionPermission20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    const query = (0, smithy_client_1.map)({
        [_RI]: [, input[_RI]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Action': [],
        'OrganizationId': [],
        'Principal': [],
        'StatementId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_AddLayerVersionPermission20181031Command = se_AddLayerVersionPermission20181031Command;
const se_AddPermission20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Action': [],
        'EventSourceToken': [],
        'FunctionUrlAuthType': [],
        'InvokedViaFunctionUrl': [],
        'Principal': [],
        'PrincipalOrgID': [],
        'RevisionId': [],
        'SourceAccount': [],
        'SourceArn': [],
        'StatementId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_AddPermission20150331Command = se_AddPermission20150331Command;
const se_AddPermission20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Action': [],
        'EventSourceToken': [],
        'FunctionUrlAuthType': [],
        'InvokedViaFunctionUrl': [],
        'Principal': [],
        'PrincipalOrgID': [],
        'RevisionId': [],
        'SourceAccount': [],
        'SourceArn': [],
        'StatementId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_AddPermission20150331v2Command = se_AddPermission20150331v2Command;
const se_CheckpointDurableExecutionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/checkpoint");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CheckpointToken': [],
        'ClientToken': [],
        'Updates': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_CheckpointDurableExecutionCommand = se_CheckpointDurableExecutionCommand;
const se_CreateAlias20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/aliases");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Description': [],
        'FunctionVersion': [],
        'Name': [],
        'RoutingConfig': _ => se_AliasRoutingConfiguration(_, context),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_CreateAlias20150331Command = se_CreateAlias20150331Command;
const se_CreateCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-22/code-signing-configs");
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AllowedPublishers': _ => (0, smithy_client_1._json)(_),
        'CodeSigningPolicies': _ => (0, smithy_client_1._json)(_),
        'Description': [],
        'Tags': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_CreateCodeSigningConfigCommand = se_CreateCodeSigningConfigCommand;
const se_CreateEventSourceMapping20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/event-source-mappings");
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AmazonManagedKafkaEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'BatchSize': [],
        'BisectBatchOnFunctionError': [],
        'DestinationConfig': _ => (0, smithy_client_1._json)(_),
        'DocumentDBEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'Enabled': [],
        'EventSourceArn': [],
        'FilterCriteria': _ => (0, smithy_client_1._json)(_),
        'FunctionName': [],
        'FunctionResponseTypes': _ => (0, smithy_client_1._json)(_),
        'KMSKeyArn': [],
        'MaximumBatchingWindowInSeconds': [],
        'MaximumRecordAgeInSeconds': [],
        'MaximumRetryAttempts': [],
        'MetricsConfig': _ => (0, smithy_client_1._json)(_),
        'ParallelizationFactor': [],
        'PartialBatchResponse': [],
        'ProvisionedPollerConfig': _ => (0, smithy_client_1._json)(_),
        'Queues': _ => (0, smithy_client_1._json)(_),
        'ScalingConfig': _ => (0, smithy_client_1._json)(_),
        'SelfManagedEventSource': _ => (0, smithy_client_1._json)(_),
        'SelfManagedKafkaEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'SourceAccessConfigurations': _ => (0, smithy_client_1._json)(_),
        'StartingPosition': [],
        'StartingPositionTimestamp': _ => (_.getTime() / 1_000),
        'Tags': _ => (0, smithy_client_1._json)(_),
        'Topics': _ => (0, smithy_client_1._json)(_),
        'TumblingWindowInSeconds': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_CreateEventSourceMapping20150331Command = se_CreateEventSourceMapping20150331Command;
const se_CreateFunction20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions");
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Architectures': _ => (0, smithy_client_1._json)(_),
        'Code': _ => se_FunctionCode(_, context),
        'CodeSigningConfigArn': [],
        'DeadLetterConfig': _ => (0, smithy_client_1._json)(_),
        'Description': [],
        'DurableConfig': _ => (0, smithy_client_1._json)(_),
        'Environment': _ => (0, smithy_client_1._json)(_),
        'EphemeralStorage': _ => (0, smithy_client_1._json)(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => (0, smithy_client_1._json)(_),
        'FileSystemConfigs': _ => (0, smithy_client_1._json)(_),
        'FunctionName': [],
        'Handler': [],
        'ImageConfig': _ => (0, smithy_client_1._json)(_),
        'KMSKeyArn': [],
        'Layers': _ => (0, smithy_client_1._json)(_),
        'LoggingConfig': _ => (0, smithy_client_1._json)(_),
        'MasterArn': [],
        'MemorySize': [],
        'PackageType': [],
        'PollerCustomerVpcRole': [],
        'ProgrammingModel': [],
        'Publish': [],
        'PublishTo': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => (0, smithy_client_1._json)(_),
        'Tags': _ => (0, smithy_client_1._json)(_),
        'TenancyConfig': _ => (0, smithy_client_1._json)(_),
        'Timeout': [],
        'TracingConfig': _ => (0, smithy_client_1._json)(_),
        'VpcConfig': _ => (0, smithy_client_1._json)(_),
        'WebProgrammingModelConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_CreateFunction20150331Command = se_CreateFunction20150331Command;
const se_CreateFunctionUrlConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AuthType': [],
        'Cors': _ => (0, smithy_client_1._json)(_),
        'InvokeMode': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_CreateFunctionUrlConfigCommand = se_CreateFunctionUrlConfigCommand;
const se_DeleteAccountSettingsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteAccountSettingsInternalCommand = se_DeleteAccountSettingsInternalCommand;
const se_DeleteAlias20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('Name', () => input.Name, '{Name}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteAlias20150331Command = se_DeleteAlias20150331Command;
const se_DeleteCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteCodeSigningConfigCommand = se_DeleteCodeSigningConfigCommand;
const se_DeleteEventSourceMapping20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteEventSourceMapping20150331Command = se_DeleteEventSourceMapping20150331Command;
const se_DeleteFunctionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
        [_MA]: [, input[_MA]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionCommand = se_DeleteFunctionCommand;
const se_DeleteFunction20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
        [_MA]: [, input[_MA]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunction20150331Command = se_DeleteFunction20150331Command;
const se_DeleteFunctionAliasResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/aliases/{Alias}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Alias', () => input.Alias, '{Alias}', false);
    const query = (0, smithy_client_1.map)({
        [_RT]: [, (0, smithy_client_1.expectNonNull)(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionAliasResourceMappingCommand = se_DeleteFunctionAliasResourceMappingCommand;
const se_DeleteFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionCodeSigningConfigCommand = se_DeleteFunctionCodeSigningConfigCommand;
const se_DeleteFunctionConcurrency20171031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionConcurrency20171031Command = se_DeleteFunctionConcurrency20171031Command;
const se_DeleteFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionEventInvokeConfigCommand = se_DeleteFunctionEventInvokeConfigCommand;
const se_DeleteFunctionInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
        [_MA]: [, input[_MA]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionInternalCommand = se_DeleteFunctionInternalCommand;
const se_DeleteFunctionResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_RT]: [, (0, smithy_client_1.expectNonNull)(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionResourceMappingCommand = se_DeleteFunctionResourceMappingCommand;
const se_DeleteFunctionUrlConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionUrlConfigCommand = se_DeleteFunctionUrlConfigCommand;
const se_DeleteFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    const query = (0, smithy_client_1.map)({
        [_RT]: [, (0, smithy_client_1.expectNonNull)(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionVersionResourceMappingCommand = se_DeleteFunctionVersionResourceMappingCommand;
const se_DeleteFunctionVersionResourcesInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionArn}/deleteresources");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteFunctionVersionResourcesInternalCommand = se_DeleteFunctionVersionResourcesInternalCommand;
const se_DeleteLayerVersion20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteLayerVersion20181031Command = se_DeleteLayerVersion20181031Command;
const se_DeleteMigratedLayerVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/layers/{LayerVersionArn}");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DeleteMigratedLayerVersionCommand = se_DeleteMigratedLayerVersionCommand;
const se_DeleteProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteProvisionedConcurrencyConfigCommand = se_DeleteProvisionedConcurrencyConfigCommand;
const se_DeleteResourcePolicyCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    const query = (0, smithy_client_1.map)({
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DeleteResourcePolicyCommand = se_DeleteResourcePolicyCommand;
const se_DisableFunctionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionArn}/disable");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DisableFunctionCommand = se_DisableFunctionCommand;
const se_DisablePublicAccessBlockConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionArn}/disable-public-access-block");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_DisablePublicAccessBlockConfigCommand = se_DisablePublicAccessBlockConfigCommand;
const se_DisableReplication20170630Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_DisableReplication20170630Command = se_DisableReplication20170630Command;
const se_EnableReplication20170630Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RevisionId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_EnableReplication20170630Command = se_EnableReplication20170630Command;
const se_EnableReplication20170630v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy-v2");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RevisionId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_EnableReplication20170630v2Command = se_EnableReplication20170630v2Command;
const se_ExportAccountSettingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ExportAccountSettingsCommand = se_ExportAccountSettingsCommand;
const se_ExportAliasCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/aliases/{AliasArn}/export");
    b.p('AliasArn', () => input.AliasArn, '{AliasArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ExportAliasCommand = se_ExportAliasCommand;
const se_ExportFunctionUrlConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ExportFunctionUrlConfigsCommand = se_ExportFunctionUrlConfigsCommand;
const se_ExportFunctionVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/export");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ExportFunctionVersionCommand = se_ExportFunctionVersionCommand;
const se_ExportLayerVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/layers/{LayerVersionArn}/export");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ExportLayerVersionCommand = se_ExportLayerVersionCommand;
const se_ExportProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ExportProvisionedConcurrencyConfigCommand = se_ExportProvisionedConcurrencyConfigCommand;
const se_GetAccountRiskSettingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-07/account-settings/{AccountId}/risk");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetAccountRiskSettingsCommand = se_GetAccountRiskSettingsCommand;
const se_GetAccountSettings20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/account-settings");
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetAccountSettings20150331Command = se_GetAccountSettings20150331Command;
const se_GetAccountSettings20160819Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2016-08-19/account-settings");
    const query = (0, smithy_client_1.map)({
        [_IPF]: [() => input.IncludePreviewFeatures !== void 0, () => (input[_IPF].toString())],
        [_IDFA]: [() => input.IncludeDeprecatedFeaturesAccess !== void 0, () => (input[_IDFA].toString())],
        [_IDRD]: [() => input.IncludeDeprecatedRuntimeDetails !== void 0, () => (input[_IDRD].toString())],
        [_IUCEM]: [() => input.IncludeUnreservedConcurrentExecutionsMinimum !== void 0, () => (input[_IUCEM].toString())],
        [_IBF]: [() => input.IncludeBlacklistedFeatures !== void 0, () => (input[_IBF].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetAccountSettings20160819Command = se_GetAccountSettings20160819Command;
const se_GetAccountSettingsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    const query = (0, smithy_client_1.map)({
        [_FTIIR]: [() => input.FieldsToIncludeInResponse !== void 0, () => ((input[_FTIIR] || []))],
        [_FTQFS]: [() => input.FeaturesToQueryForStatus !== void 0, () => ((input[_FTQFS] || []))],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetAccountSettingsInternalCommand = se_GetAccountSettingsInternalCommand;
const se_GetAlias20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('Name', () => input.Name, '{Name}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetAlias20150331Command = se_GetAlias20150331Command;
const se_GetAliasInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionName}/aliases/{Name}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('Name', () => input.Name, '{Name}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetAliasInternalCommand = se_GetAliasInternalCommand;
const se_GetCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetCodeSigningConfigCommand = se_GetCodeSigningConfigCommand;
const se_GetDurableExecutionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetDurableExecutionCommand = se_GetDurableExecutionCommand;
const se_GetDurableExecutionHistoryCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_IED]: [() => input.IncludeExecutionData !== void 0, () => (input[_IED].toString())],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
        [_M]: [, input[_M]],
        [_RO]: [() => input.ReverseOrder !== void 0, () => (input[_RO].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetDurableExecutionHistoryCommand = se_GetDurableExecutionHistoryCommand;
const se_GetDurableExecutionStateCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/state");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_CT]: [, (0, smithy_client_1.expectNonNull)(input[_CT], `CheckpointToken`)],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetDurableExecutionStateCommand = se_GetDurableExecutionStateCommand;
const se_GetEventSourceCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetEventSourceCommand = se_GetEventSourceCommand;
const se_GetEventSourceMapping20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetEventSourceMapping20150331Command = se_GetEventSourceMapping20150331Command;
const se_GetEventSourceMappingInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetEventSourceMappingInternalCommand = se_GetEventSourceMappingInternalCommand;
const se_GetFunctionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionCommand = se_GetFunctionCommand;
const se_GetFunction20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunction20150331Command = se_GetFunction20150331Command;
const se_GetFunction20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunction20150331v2Command = se_GetFunction20150331v2Command;
const se_GetFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetFunctionCodeSigningConfigCommand = se_GetFunctionCodeSigningConfigCommand;
const se_GetFunctionConcurrencyCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetFunctionConcurrencyCommand = se_GetFunctionConcurrencyCommand;
const se_GetFunctionConfigurationCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionConfigurationCommand = se_GetFunctionConfigurationCommand;
const se_GetFunctionConfiguration20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionConfiguration20150331Command = se_GetFunctionConfiguration20150331Command;
const se_GetFunctionConfiguration20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionConfiguration20150331v2Command = se_GetFunctionConfiguration20150331v2Command;
const se_GetFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionEventInvokeConfigCommand = se_GetFunctionEventInvokeConfigCommand;
const se_GetFunctionInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionInternalCommand = se_GetFunctionInternalCommand;
const se_GetFunctionRecursionConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetFunctionRecursionConfigCommand = se_GetFunctionRecursionConfigCommand;
const se_GetFunctionScalingConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-11-30/functions/{FunctionName}/function-scaling-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionScalingConfigCommand = se_GetFunctionScalingConfigCommand;
const se_GetFunctionUrlConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetFunctionUrlConfigCommand = se_GetFunctionUrlConfigCommand;
const se_GetLatestLayerVersionInfoInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/layer-arn/{LayerArn}");
    b.p('LayerArn', () => input.LayerArn, '{LayerArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetLatestLayerVersionInfoInternalCommand = se_GetLatestLayerVersionInfoInternalCommand;
const se_GetLayerVersion20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetLayerVersion20181031Command = se_GetLayerVersion20181031Command;
const se_GetLayerVersionByArn20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers");
    const query = (0, smithy_client_1.map)({
        [_f]: [, "LayerVersion"],
        [_A]: [, (0, smithy_client_1.expectNonNull)(input[_A], `Arn`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetLayerVersionByArn20181031Command = se_GetLayerVersionByArn20181031Command;
const se_GetLayerVersionInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/layer-version-arn/{LayerVersionArn}");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_AOPU]: [() => input.AllowOnlyPresignedUrl !== void 0, () => (input[_AOPU].toString())],
        [_FLUTS]: [, input[_FLUTS]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetLayerVersionInternalCommand = se_GetLayerVersionInternalCommand;
const se_GetLayerVersionPolicy20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetLayerVersionPolicy20181031Command = se_GetLayerVersionPolicy20181031Command;
const se_GetLayerVersionPolicyInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/layer-version-arn/{LayerVersionArn}/policy");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetLayerVersionPolicyInternalCommand = se_GetLayerVersionPolicyInternalCommand;
const se_GetPolicy20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetPolicy20150331Command = se_GetPolicy20150331Command;
const se_GetPolicy20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetPolicy20150331v2Command = se_GetPolicy20150331v2Command;
const se_GetProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetProvisionedConcurrencyConfigCommand = se_GetProvisionedConcurrencyConfigCommand;
const se_GetPublicAccessBlockConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2024-09-16/public-access-block/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetPublicAccessBlockConfigCommand = se_GetPublicAccessBlockConfigCommand;
const se_GetResourcePolicyCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetResourcePolicyCommand = se_GetResourcePolicyCommand;
const se_GetRuntimeManagementConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_GetRuntimeManagementConfigCommand = se_GetRuntimeManagementConfigCommand;
const se_GetVersionProvisionedConcurrencyStatusCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/status");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetVersionProvisionedConcurrencyStatusCommand = se_GetVersionProvisionedConcurrencyStatusCommand;
const se_GetVersionSandboxSpecCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/sandbox-spec");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_GetVersionSandboxSpecCommand = se_GetVersionSandboxSpecCommand;
const se_ImportAccountSettingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CodeStorageTableEntry': _ => (0, smithy_client_1._json)(_),
        'CustomerConfig': _ => se_CustomerConfigInternal(_, context),
        'RiskSettings': _ => se_MigrationAccountRiskSettings(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportAccountSettingsCommand = se_ImportAccountSettingsCommand;
const se_ImportAliasCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/aliases/{AliasArn}/import");
    b.p('AliasArn', () => input.AliasArn, '{AliasArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'MigrationAlias': _ => se_MigrationAlias(_, context),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportAliasCommand = se_ImportAliasCommand;
const se_ImportFunctionCounterCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/counter");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CurrentVersionNumber': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportFunctionCounterCommand = se_ImportFunctionCounterCommand;
const se_ImportFunctionUrlConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'MigrationFunctionUrlConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportFunctionUrlConfigsCommand = se_ImportFunctionUrlConfigsCommand;
const se_ImportFunctionVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/import");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'MigrationFunctionVersion': _ => se_MigrationFunctionVersion(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportFunctionVersionCommand = se_ImportFunctionVersionCommand;
const se_ImportLayerVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/layers/{LayerVersionArn}/import");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'LayerVersion': _ => se_MigrationLayerVersion(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportLayerVersionCommand = se_ImportLayerVersionCommand;
const se_ImportProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'MigrationProvisionedConcurrencyConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ImportProvisionedConcurrencyConfigCommand = se_ImportProvisionedConcurrencyConfigCommand;
const se_InformTagrisAfterResourceCreationCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/tags/{Resource}/after-resource-creation/{TagrisExpectedVersion}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    b.p('TagrisExpectedVersion', () => input.TagrisExpectedVersion.toString(), '{TagrisExpectedVersion}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_InformTagrisAfterResourceCreationCommand = se_InformTagrisAfterResourceCreationCommand;
const se_Invoke20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = (0, smithy_client_1.map)({}, smithy_client_1.isSerializableHeaderValue, {
        [_ct]: input[_CTo] || 'application/octet-stream',
        [_xait]: input[_IT],
        [_xasa]: input[_SA],
        [_xalt]: input[_LT],
        [_xacc]: input[_CC],
        [_xaden]: input[_DEN],
        [_xasa_]: input[_SAo],
        [_xaest]: input[_EST],
        [_xati]: input[_TF],
        [_xail]: input[_IL],
        [_xaoda]: input[_OSDA],
        [_xaoda_]: input[_OFDA],
        [_xati_]: input[_TI],
        [_xadi]: [() => (0, smithy_client_1.isSerializableHeaderValue)(input[_DFIE]), () => input[_DFIE].toString()],
    });
    b.bp("/2015-03-31/functions/{FunctionName}/invocations");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    if (input.Payload !== undefined) {
        body = input.Payload;
    }
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_Invoke20150331Command = se_Invoke20150331Command;
const se_InvokeAsyncCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = (0, smithy_client_1.map)({}, smithy_client_1.isSerializableHeaderValue, {
        'content-type': 'application/octet-stream',
        [_xail]: input[_IL],
        [_xadr]: [() => (0, smithy_client_1.isSerializableHeaderValue)(input[_DR]), () => input[_DR].toString()],
        [_xasa]: input[_SA],
    });
    b.bp("/2014-11-13/functions/{FunctionName}/invoke-async");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    if (input.InvokeArgs !== undefined) {
        body = input.InvokeArgs;
    }
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_InvokeAsyncCommand = se_InvokeAsyncCommand;
const se_InvokeWithResponseStreamCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = (0, smithy_client_1.map)({}, smithy_client_1.isSerializableHeaderValue, {
        [_ct]: input[_CTo] || 'application/octet-stream',
        [_xait]: input[_IT],
        [_xalt]: input[_LT],
        [_xacc]: input[_CC],
        [_xaso]: input[_SO],
        [_xasa]: input[_SA],
        [_xasa_]: input[_SAo],
        [_xaest]: input[_EST],
        [_xati]: input[_TF],
        [_xail]: input[_IL],
        [_xati_]: input[_TI],
    });
    b.bp("/2021-11-15/functions/{FunctionName}/response-streaming-invocations");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    if (input.Payload !== undefined) {
        body = input.Payload;
    }
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_InvokeWithResponseStreamCommand = se_InvokeWithResponseStreamCommand;
const se_ListAliases20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/aliases");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_FV]: [, input[_FV]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListAliases20150331Command = se_ListAliases20150331Command;
const se_ListAliasesInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/aliases");
    const query = (0, smithy_client_1.map)({
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListAliasesInternalCommand = se_ListAliasesInternalCommand;
const se_ListCodeSigningConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs");
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListCodeSigningConfigsCommand = se_ListCodeSigningConfigsCommand;
const se_ListDurableExecutionsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions");
    const query = (0, smithy_client_1.map)({
        [_FN]: [, input[_FN]],
        [_FV]: [, input[_FV]],
        [_DEN]: [, input[_DEN]],
        [_SF]: [() => input.StatusFilter !== void 0, () => ((input[_SF] || []))],
        [_TA]: [() => input.TimeAfter !== void 0, () => ((0, smithy_client_1.serializeDateTime)(input[_TA]).toString())],
        [_TB]: [() => input.TimeBefore !== void 0, () => ((0, smithy_client_1.serializeDateTime)(input[_TB]).toString())],
        [_RO]: [() => input.ReverseOrder !== void 0, () => (input[_RO].toString())],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListDurableExecutionsCommand = se_ListDurableExecutionsCommand;
const se_ListEventSourceMappings20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings");
    const query = (0, smithy_client_1.map)({
        [_ESA]: [, input[_ESA]],
        [_FN]: [, input[_FN]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListEventSourceMappings20150331Command = se_ListEventSourceMappings20150331Command;
const se_ListEventSourceMappingsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/internal/event-source-mappings");
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListEventSourceMappingsInternalCommand = se_ListEventSourceMappingsInternalCommand;
const se_ListEventSourcesCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings");
    const query = (0, smithy_client_1.map)({
        [_ES]: [, input[_ESA]],
        [_FN]: [, input[_FN]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListEventSourcesCommand = se_ListEventSourcesCommand;
const se_ListFunctionAliasResourceMappingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/aliases/{Alias}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Alias', () => input.Alias, '{Alias}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ListFunctionAliasResourceMappingsCommand = se_ListFunctionAliasResourceMappingsCommand;
const se_ListFunctionCountersInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions");
    const query = (0, smithy_client_1.map)({
        [_l]: [, "counters"],
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionCountersInternalCommand = se_ListFunctionCountersInternalCommand;
const se_ListFunctionEventInvokeConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config/list");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionEventInvokeConfigsCommand = se_ListFunctionEventInvokeConfigsCommand;
const se_ListFunctionResourceMappingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ListFunctionResourceMappingsCommand = se_ListFunctionResourceMappingsCommand;
const se_ListFunctionsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions");
    const query = (0, smithy_client_1.map)({
        [_MR]: [, input[_MR]],
        [_FV]: [, input[_FV]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionsCommand = se_ListFunctionsCommand;
const se_ListFunctions20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions");
    const query = (0, smithy_client_1.map)({
        [_MR]: [, input[_MR]],
        [_FV]: [, input[_FV]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctions20150331Command = se_ListFunctions20150331Command;
const se_ListFunctionsByCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}/functions");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionsByCodeSigningConfigCommand = se_ListFunctionsByCodeSigningConfigCommand;
const se_ListFunctionUrlConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/urls");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionUrlConfigsCommand = se_ListFunctionUrlConfigsCommand;
const se_ListFunctionUrlsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/urls");
    const query = (0, smithy_client_1.map)({
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionUrlsInternalCommand = se_ListFunctionUrlsInternalCommand;
const se_ListFunctionVersionResourceMappingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ListFunctionVersionResourceMappingsCommand = se_ListFunctionVersionResourceMappingsCommand;
const se_ListFunctionVersionsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/functions");
    const query = (0, smithy_client_1.map)({
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListFunctionVersionsInternalCommand = se_ListFunctionVersionsInternalCommand;
const se_ListLayers20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers");
    const query = (0, smithy_client_1.map)({
        [_CA]: [, input[_CA]],
        [_CR]: [, input[_CR]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListLayers20181031Command = se_ListLayers20181031Command;
const se_ListLayerVersions20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    const query = (0, smithy_client_1.map)({
        [_CA]: [, input[_CA]],
        [_CR]: [, input[_CR]],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListLayerVersions20181031Command = se_ListLayerVersions20181031Command;
const se_ListLayerVersionsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/cellmigration/layers");
    const query = (0, smithy_client_1.map)({
        [_AI]: [, (0, smithy_client_1.expectNonNull)(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListLayerVersionsInternalCommand = se_ListLayerVersionsInternalCommand;
const se_ListProvisionedConcurrencyConfigsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_L]: [, "ALL"],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListProvisionedConcurrencyConfigsCommand = se_ListProvisionedConcurrencyConfigsCommand;
const se_ListProvisionedConcurrencyConfigsByAccountIdCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/accounts/{AccountId}/provisioned-concurrency");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    const query = (0, smithy_client_1.map)({
        [_L]: [, "ALL"],
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListProvisionedConcurrencyConfigsByAccountIdCommand = se_ListProvisionedConcurrencyConfigsByAccountIdCommand;
const se_ListTags20170331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ListTags20170331Command = se_ListTags20170331Command;
const se_ListVersionsByFunction20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ListVersionsByFunction20150331Command = se_ListVersionsByFunction20150331Command;
const se_PublishLayerVersion20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CompatibleArchitectures': _ => (0, smithy_client_1._json)(_),
        'CompatibleRuntimes': _ => (0, smithy_client_1._json)(_),
        'Content': _ => se_LayerVersionContentInput20181031(_, context),
        'Description': [],
        'FasCredentials': _ => context.base64Encoder(_),
        'LicenseInfo': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PublishLayerVersion20181031Command = se_PublishLayerVersion20181031Command;
const se_PublishVersion20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CodeSha256': [],
        'Description': [],
        'PublishTo': [],
        'RevisionId': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PublishVersion20150331Command = se_PublishVersion20150331Command;
const se_PutFunctionAliasResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/aliases/{Alias}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Alias', () => input.Alias, '{Alias}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionAliasResourceMappingCommand = se_PutFunctionAliasResourceMappingCommand;
const se_PutFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CodeSigningConfigArn': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionCodeSigningConfigCommand = se_PutFunctionCodeSigningConfigCommand;
const se_PutFunctionConcurrency20171031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ReservedConcurrentExecutions': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionConcurrency20171031Command = se_PutFunctionConcurrency20171031Command;
const se_PutFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DestinationConfig': _ => (0, smithy_client_1._json)(_),
        'MaximumEventAgeInSeconds': [],
        'MaximumRetryAttempts': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_PutFunctionEventInvokeConfigCommand = se_PutFunctionEventInvokeConfigCommand;
const se_PutFunctionRecursionConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RecursiveLoop': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionRecursionConfigCommand = se_PutFunctionRecursionConfigCommand;
const se_PutFunctionResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionResourceMappingCommand = se_PutFunctionResourceMappingCommand;
const se_PutFunctionScalingConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-11-30/functions/{FunctionName}/function-scaling-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'FunctionScalingConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_PutFunctionScalingConfigCommand = se_PutFunctionScalingConfigCommand;
const se_PutFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutFunctionVersionResourceMappingCommand = se_PutFunctionVersionResourceMappingCommand;
const se_PutProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, (0, smithy_client_1.expectNonNull)(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ProvisionedConcurrentExecutions': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_PutProvisionedConcurrencyConfigCommand = se_PutProvisionedConcurrencyConfigCommand;
const se_PutPublicAccessBlockConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-09-16/public-access-block/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'PublicAccessBlockConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutPublicAccessBlockConfigCommand = se_PutPublicAccessBlockConfigCommand;
const se_PutResourcePolicyCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'BlockPublicPolicy': [],
        'Policy': [],
        'RevisionId': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_PutResourcePolicyCommand = se_PutResourcePolicyCommand;
const se_PutRuntimeManagementConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RuntimeVersionArn': [],
        'UpdateRuntimeOn': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_PutRuntimeManagementConfigCommand = se_PutRuntimeManagementConfigCommand;
const se_ReconcileProvisionedConcurrencyCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/reconcile");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_RA]: [, (0, smithy_client_1.expectNonNull)(input[_RA], `ReconciliationAction`)],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'ProvisionedConcurrencyConfig': _ => (0, smithy_client_1._json)(_),
        'ProvisionedConcurrencyFunctionVersion': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ReconcileProvisionedConcurrencyCommand = se_ReconcileProvisionedConcurrencyCommand;
const se_RedriveFunctionResourceTagsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/redrive-tags");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_RedriveFunctionResourceTagsCommand = se_RedriveFunctionResourceTagsCommand;
const se_RemoveEventSourceCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_RemoveEventSourceCommand = se_RemoveEventSourceCommand;
const se_RemoveLayerVersionPermission20181031Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy/{StatementId}");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = (0, smithy_client_1.map)({
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_RemoveLayerVersionPermission20181031Command = se_RemoveLayerVersionPermission20181031Command;
const se_RemovePermission20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy/{StatementId}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_RemovePermission20150331Command = se_RemovePermission20150331Command;
const se_RemovePermission20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/policy/{StatementId}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_RemovePermission20150331v2Command = se_RemovePermission20150331v2Command;
const se_ResetFunctionFeatureInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-07-20/internal/{FeatureGate}/functions/reset-function-feature/{FunctionArn}");
    b.p('FeatureGate', () => input.FeatureGate, '{FeatureGate}', false);
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ResetFunctionFeatureInternalCommand = se_ResetFunctionFeatureInternalCommand;
const se_ResignFunctionAliasCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2022-03-31/aliases/{FunctionArn}/resign");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_SKT]: [, (0, smithy_client_1.expectNonNull)(input[_SKT], `SigningKeyType`)],
    });
    let body;
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ResignFunctionAliasCommand = se_ResignFunctionAliasCommand;
const se_ResignFunctionVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2022-03-31/functions/{FunctionArn}/resign");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = (0, smithy_client_1.map)({
        [_SKT]: [, (0, smithy_client_1.expectNonNull)(input[_SKT], `SigningKeyType`)],
    });
    let body;
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_ResignFunctionVersionCommand = se_ResignFunctionVersionCommand;
const se_RollbackFunctionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-07-20/functions/{FunctionName}/rollback");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RuntimeUpdate': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_RollbackFunctionCommand = se_RollbackFunctionCommand;
const se_RollbackTagsOwnershipFromLambdaCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/rollback-tags-ownership-from-lambda");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_RollbackTagsOwnershipFromLambdaCommand = se_RollbackTagsOwnershipFromLambdaCommand;
const se_SafeDeleteProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_LM]: [, (0, smithy_client_1.expectNonNull)(input[_LM], `LastModified`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_SafeDeleteProvisionedConcurrencyConfigCommand = se_SafeDeleteProvisionedConcurrencyConfigCommand;
const se_SendDurableExecutionCallbackFailureCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
    b.p('CallbackId', () => input.CallbackId, '{CallbackId}', false);
    let body;
    if (input.Error !== undefined) {
        body = (0, smithy_client_1._json)(input.Error);
    }
    if (body === undefined) {
        body = {};
    }
    body = JSON.stringify(body);
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_SendDurableExecutionCallbackFailureCommand = se_SendDurableExecutionCallbackFailureCommand;
const se_SendDurableExecutionCallbackHeartbeatCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
    b.p('CallbackId', () => input.CallbackId, '{CallbackId}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_SendDurableExecutionCallbackHeartbeatCommand = se_SendDurableExecutionCallbackHeartbeatCommand;
const se_SendDurableExecutionCallbackSuccessCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/octet-stream',
    };
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/succeed");
    b.p('CallbackId', () => input.CallbackId, '{CallbackId}', false);
    let body;
    if (input.Result !== undefined) {
        body = input.Result;
    }
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_SendDurableExecutionCallbackSuccessCommand = se_SendDurableExecutionCallbackSuccessCommand;
const se_SetAccountRiskSettingsCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-07/account-settings/{AccountId}/risk");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'RiskSettings': _ => se_AccountRiskSettings(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_SetAccountRiskSettingsCommand = se_SetAccountRiskSettingsCommand;
const se_SetAccountSettings20170430Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-04-30/account-settings");
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DeprecatedFeaturesAccess': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_SetAccountSettings20170430Command = se_SetAccountSettings20170430Command;
const se_StopDurableExecutionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/stop");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    if (input.Error !== undefined) {
        body = (0, smithy_client_1._json)(input.Error);
    }
    if (body === undefined) {
        body = {};
    }
    body = JSON.stringify(body);
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_StopDurableExecutionCommand = se_StopDurableExecutionCommand;
const se_TagResource20170331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/internal/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    if (input.Tags !== undefined) {
        body = (0, smithy_client_1._json)(input.Tags);
    }
    if (body === undefined) {
        body = {};
    }
    body = JSON.stringify(body);
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_TagResource20170331Command = se_TagResource20170331Command;
const se_TagResource20170331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Tags': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_TagResource20170331v2Command = se_TagResource20170331v2Command;
const se_TagResourceBeforeResourceCreationCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/internal/tags/{Resource}/before-resource-creation");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Tags': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_TagResourceBeforeResourceCreationCommand = se_TagResourceBeforeResourceCreationCommand;
const se_TransferTagsOwnershipToLambdaCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/transfer-tags-ownership-to-lambda");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_TransferTagsOwnershipToLambdaCommand = se_TransferTagsOwnershipToLambdaCommand;
const se_UntagResource20170331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/tagging");
    const query = (0, smithy_client_1.map)({
        [_O]: [, "Untag"],
        [_R]: [, (0, smithy_client_1.expectNonNull)(input[_R], `Resource`)],
    });
    let body;
    if (input.TagKeys !== undefined) {
        body = (0, smithy_client_1._json)(input.TagKeys);
    }
    if (body === undefined) {
        body = {};
    }
    body = JSON.stringify(body);
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UntagResource20170331Command = se_UntagResource20170331Command;
const se_UntagResource20170331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    const query = (0, smithy_client_1.map)({
        [_tK]: [(0, smithy_client_1.expectNonNull)(input.TagKeys, `TagKeys`) != null, () => (input[_TK] || [])],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UntagResource20170331v2Command = se_UntagResource20170331v2Command;
const se_UpdateAccountSettingsInternalCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CustomerConfig': _ => se_CustomerConfigInternal(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateAccountSettingsInternalCommand = se_UpdateAccountSettingsInternalCommand;
const se_UpdateAlias20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('Name', () => input.Name, '{Name}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Description': [],
        'FunctionVersion': [],
        'RevisionId': [],
        'RoutingConfig': _ => se_AliasRoutingConfiguration(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateAlias20150331Command = se_UpdateAlias20150331Command;
const se_UpdateCodeSigningConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AllowedPublishers': _ => (0, smithy_client_1._json)(_),
        'CodeSigningPolicies': _ => (0, smithy_client_1._json)(_),
        'Description': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateCodeSigningConfigCommand = se_UpdateCodeSigningConfigCommand;
const se_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/update-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_CE]: [(0, smithy_client_1.expectNonNull)(input.ConcurrentExecutions, `ConcurrentExecutions`) != null, () => input[_CE].toString()],
    });
    let body;
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = se_UpdateConcurrencyInProvisionedConcurrencyConfigCommand;
const se_UpdateEventSourceMapping20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AmazonManagedKafkaEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'BatchSize': [],
        'BisectBatchOnFunctionError': [],
        'DestinationConfig': _ => (0, smithy_client_1._json)(_),
        'DocumentDBEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'Enabled': [],
        'FilterCriteria': _ => (0, smithy_client_1._json)(_),
        'FunctionName': [],
        'FunctionResponseTypes': _ => (0, smithy_client_1._json)(_),
        'KMSKeyArn': [],
        'MaximumBatchingWindowInSeconds': [],
        'MaximumRecordAgeInSeconds': [],
        'MaximumRetryAttempts': [],
        'MetricsConfig': _ => (0, smithy_client_1._json)(_),
        'ParallelizationFactor': [],
        'PartialBatchResponse': [],
        'ProvisionedPollerConfig': _ => (0, smithy_client_1._json)(_),
        'ScalingConfig': _ => (0, smithy_client_1._json)(_),
        'SelfManagedKafkaEventSourceConfig': _ => (0, smithy_client_1._json)(_),
        'SourceAccessConfigurations': _ => (0, smithy_client_1._json)(_),
        'TumblingWindowInSeconds': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateEventSourceMapping20150331Command = se_UpdateEventSourceMapping20150331Command;
const se_UpdateFunctionCodeCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/octet-stream',
    };
    b.bp("/2014-11-13/functions/{FunctionName}/code");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    if (input.FunctionZip !== undefined) {
        body = input.FunctionZip;
    }
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionCodeCommand = se_UpdateFunctionCodeCommand;
const se_UpdateFunctionCode20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/code");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Architectures': _ => (0, smithy_client_1._json)(_),
        'DryRun': [],
        'ImageUri': [],
        'Publish': [],
        'PublishTo': [],
        'RevisionId': [],
        'S3Bucket': [],
        'S3Key': [],
        'S3ObjectStorageMode': [],
        'S3ObjectVersion': [],
        'SourceKMSKeyArn': [],
        'ZipFile': _ => context.base64Encoder(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionCode20150331Command = se_UpdateFunctionCode20150331Command;
const se_UpdateFunctionCode20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/code");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'Architectures': _ => (0, smithy_client_1._json)(_),
        'DryRun': [],
        'ImageUri': [],
        'Publish': [],
        'PublishTo': [],
        'RevisionId': [],
        'S3Bucket': [],
        'S3Key': [],
        'S3ObjectStorageMode': [],
        'S3ObjectVersion': [],
        'SourceKMSKeyArn': [],
        'ZipFile': _ => context.base64Encoder(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionCode20150331v2Command = se_UpdateFunctionCode20150331v2Command;
const se_UpdateFunctionConfigurationCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Ro]: [, input[_Ro]],
        [_H]: [, input[_H]],
        [_D]: [, input[_D]],
        [_T]: [() => input.Timeout !== void 0, () => (input[_T].toString())],
        [_MS]: [() => input.MemorySize !== void 0, () => (input[_MS].toString())],
    });
    let body;
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionConfigurationCommand = se_UpdateFunctionConfigurationCommand;
const se_UpdateFunctionConfiguration20150331Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DeadLetterConfig': _ => (0, smithy_client_1._json)(_),
        'Description': [],
        'DurableConfig': _ => (0, smithy_client_1._json)(_),
        'Environment': _ => (0, smithy_client_1._json)(_),
        'EphemeralStorage': _ => (0, smithy_client_1._json)(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => (0, smithy_client_1._json)(_),
        'FileSystemConfigs': _ => (0, smithy_client_1._json)(_),
        'Handler': [],
        'ImageConfig': _ => (0, smithy_client_1._json)(_),
        'KMSKeyArn': [],
        'Layers': _ => (0, smithy_client_1._json)(_),
        'LoggingConfig': _ => (0, smithy_client_1._json)(_),
        'MemorySize': [],
        'PackageType': [],
        'ProgrammingModel': [],
        'RevisionId': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => (0, smithy_client_1._json)(_),
        'Timeout': [],
        'TracingConfig': _ => (0, smithy_client_1._json)(_),
        'VpcConfig': _ => (0, smithy_client_1._json)(_),
        'WebProgrammingModelConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionConfiguration20150331Command = se_UpdateFunctionConfiguration20150331Command;
const se_UpdateFunctionConfiguration20150331v2Command = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DeadLetterConfig': _ => (0, smithy_client_1._json)(_),
        'Description': [],
        'DurableConfig': _ => (0, smithy_client_1._json)(_),
        'Environment': _ => (0, smithy_client_1._json)(_),
        'EphemeralStorage': _ => (0, smithy_client_1._json)(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => (0, smithy_client_1._json)(_),
        'FileSystemConfigs': _ => (0, smithy_client_1._json)(_),
        'Handler': [],
        'ImageConfig': _ => (0, smithy_client_1._json)(_),
        'KMSKeyArn': [],
        'Layers': _ => (0, smithy_client_1._json)(_),
        'LoggingConfig': _ => (0, smithy_client_1._json)(_),
        'MemorySize': [],
        'PackageType': [],
        'ProgrammingModel': [],
        'RevisionId': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => (0, smithy_client_1._json)(_),
        'Timeout': [],
        'TracingConfig': _ => (0, smithy_client_1._json)(_),
        'VpcConfig': _ => (0, smithy_client_1._json)(_),
        'WebProgrammingModelConfig': _ => (0, smithy_client_1._json)(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionConfiguration20150331v2Command = se_UpdateFunctionConfiguration20150331v2Command;
const se_UpdateFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DestinationConfig': _ => (0, smithy_client_1._json)(_),
        'MaximumEventAgeInSeconds': [],
        'MaximumRetryAttempts': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionEventInvokeConfigCommand = se_UpdateFunctionEventInvokeConfigCommand;
const se_UpdateFunctionUrlConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'AuthType': [],
        'Cors': _ => (0, smithy_client_1._json)(_),
        'InvokeMode': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionUrlConfigCommand = se_UpdateFunctionUrlConfigCommand;
const se_UpdateFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings/update");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'CurrentValue': [],
        'NewValue': [],
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateFunctionVersionResourceMappingCommand = se_UpdateFunctionVersionResourceMappingCommand;
const se_UpdateProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'LastModified': [],
        'ProvisionedConcurrencyStatusReasonCode': [],
        'ProvisionedConcurrentExecutions': [],
        'Status': [],
        'StatusReason': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateProvisionedConcurrencyConfigCommand = se_UpdateProvisionedConcurrencyConfigCommand;
const se_UpdateVersionProvisionedConcurrencyStatusCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/status");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify((0, smithy_client_1.take)(input, {
        'DesiredConcurrentExecutions': [],
        'ProvisionedConcurrentExecutions': [],
        'RevisionId': [],
        'Status': [],
        'VersionStatus': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_UpdateVersionProvisionedConcurrencyStatusCommand = se_UpdateVersionProvisionedConcurrencyStatusCommand;
const se_UploadFunctionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {
        'content-type': 'application/octet-stream',
    };
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = (0, smithy_client_1.map)({
        [_Ru]: [, (0, smithy_client_1.expectNonNull)(input[_Ru], `Runtime`)],
        [_Ro]: [, (0, smithy_client_1.expectNonNull)(input[_Ro], `Role`)],
        [_H]: [, (0, smithy_client_1.expectNonNull)(input[_H], `Handler`)],
        [_Mo]: [, (0, smithy_client_1.expectNonNull)(input[_Mo], `Mode`)],
        [_D]: [, input[_D]],
        [_T]: [() => input.Timeout !== void 0, () => (input[_T].toString())],
        [_MS]: [() => input.MemorySize !== void 0, () => (input[_MS].toString())],
    });
    let body;
    if (input.FunctionZip !== undefined) {
        body = input.FunctionZip;
    }
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
exports.se_UploadFunctionCommand = se_UploadFunctionCommand;
const se_ValidateProvisionedConcurrencyFunctionVersionCommand = async (input, context) => {
    const b = (0, core_2.requestBuilder)(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/validate-provisioned-concurrency-function-version");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
exports.se_ValidateProvisionedConcurrencyFunctionVersionCommand = se_ValidateProvisionedConcurrencyFunctionVersionCommand;
const de_AddEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'BatchSize': smithy_client_1.expectInt32,
        'EventSource': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'IsActive': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'Parameters': smithy_client_1._json,
        'Role': smithy_client_1.expectString,
        'Status': smithy_client_1.expectString,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_AddEventSourceCommand = de_AddEventSourceCommand;
const de_AddLayerVersionPermission20181031Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'RevisionId': smithy_client_1.expectString,
        'Statement': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_AddLayerVersionPermission20181031Command = de_AddLayerVersionPermission20181031Command;
const de_AddPermission20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Statement': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_AddPermission20150331Command = de_AddPermission20150331Command;
const de_AddPermission20150331v2Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Statement': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_AddPermission20150331v2Command = de_AddPermission20150331v2Command;
const de_CheckpointDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CheckpointToken': smithy_client_1.expectString,
        'NewExecutionState': _ => de_CheckpointUpdatedExecutionState(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CheckpointDurableExecutionCommand = de_CheckpointDurableExecutionCommand;
const de_CreateAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AliasArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'Name': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CreateAlias20150331Command = de_CreateAlias20150331Command;
const de_CreateCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CreateCodeSigningConfigCommand = de_CreateCodeSigningConfigCommand;
const de_CreateEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CreateEventSourceMapping20150331Command = de_CreateEventSourceMapping20150331Command;
const de_CreateFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CreateFunction20150331Command = de_CreateFunction20150331Command;
const de_CreateFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AuthType': smithy_client_1.expectString,
        'Cors': smithy_client_1._json,
        'CreationTime': smithy_client_1.expectString,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionUrl': smithy_client_1.expectString,
        'InvokeMode': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_CreateFunctionUrlConfigCommand = de_CreateFunctionUrlConfigCommand;
const de_DeleteAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteAccountSettingsInternalCommand = de_DeleteAccountSettingsInternalCommand;
const de_DeleteAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteAlias20150331Command = de_DeleteAlias20150331Command;
const de_DeleteCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteCodeSigningConfigCommand = de_DeleteCodeSigningConfigCommand;
const de_DeleteEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_DeleteEventSourceMapping20150331Command = de_DeleteEventSourceMapping20150331Command;
const de_DeleteFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    (0, smithy_client_1.map)(contents, {
        StatusCode: [, output.statusCode]
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionCommand = de_DeleteFunctionCommand;
const de_DeleteFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    (0, smithy_client_1.map)(contents, {
        StatusCode: [, output.statusCode]
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunction20150331Command = de_DeleteFunction20150331Command;
const de_DeleteFunctionAliasResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionAliasResourceMappingCommand = de_DeleteFunctionAliasResourceMappingCommand;
const de_DeleteFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionCodeSigningConfigCommand = de_DeleteFunctionCodeSigningConfigCommand;
const de_DeleteFunctionConcurrency20171031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionConcurrency20171031Command = de_DeleteFunctionConcurrency20171031Command;
const de_DeleteFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionEventInvokeConfigCommand = de_DeleteFunctionEventInvokeConfigCommand;
const de_DeleteFunctionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    (0, smithy_client_1.map)(contents, {
        StatusCode: [, output.statusCode]
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionInternalCommand = de_DeleteFunctionInternalCommand;
const de_DeleteFunctionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionId': smithy_client_1.expectString,
        'FunctionSequenceNumber': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_DeleteFunctionResourceMappingCommand = de_DeleteFunctionResourceMappingCommand;
const de_DeleteFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionUrlConfigCommand = de_DeleteFunctionUrlConfigCommand;
const de_DeleteFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteFunctionVersionResourceMappingCommand = de_DeleteFunctionVersionResourceMappingCommand;
const de_DeleteFunctionVersionResourcesInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'VpcConfigResponse': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_DeleteFunctionVersionResourcesInternalCommand = de_DeleteFunctionVersionResourcesInternalCommand;
const de_DeleteLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteLayerVersion20181031Command = de_DeleteLayerVersion20181031Command;
const de_DeleteMigratedLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteMigratedLayerVersionCommand = de_DeleteMigratedLayerVersionCommand;
const de_DeleteProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteProvisionedConcurrencyConfigCommand = de_DeleteProvisionedConcurrencyConfigCommand;
const de_DeleteResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DeleteResourcePolicyCommand = de_DeleteResourcePolicyCommand;
const de_DisableFunctionCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DisableFunctionCommand = de_DisableFunctionCommand;
const de_DisablePublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Disabled': smithy_client_1.expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_DisablePublicAccessBlockConfigCommand = de_DisablePublicAccessBlockConfigCommand;
const de_DisableReplication20170630Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_DisableReplication20170630Command = de_DisableReplication20170630Command;
const de_EnableReplication20170630Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Statement': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_EnableReplication20170630Command = de_EnableReplication20170630Command;
const de_EnableReplication20170630v2Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'RevisionId': smithy_client_1.expectString,
        'Statement': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_EnableReplication20170630v2Command = de_EnableReplication20170630v2Command;
const de_ExportAccountSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeStorageTableEntry': smithy_client_1._json,
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
        'RiskSettings': _ => de_MigrationAccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportAccountSettingsCommand = de_ExportAccountSettingsCommand;
const de_ExportAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationAlias': _ => de_MigrationAlias(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportAliasCommand = de_ExportAliasCommand;
const de_ExportFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationFunctionUrlConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportFunctionUrlConfigsCommand = de_ExportFunctionUrlConfigsCommand;
const de_ExportFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationFunctionVersion': _ => de_MigrationFunctionVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportFunctionVersionCommand = de_ExportFunctionVersionCommand;
const de_ExportLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'LayerVersion': _ => de_MigrationLayerVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportLayerVersionCommand = de_ExportLayerVersionCommand;
const de_ExportProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationProvisionedConcurrencyConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ExportProvisionedConcurrencyConfigCommand = de_ExportProvisionedConcurrencyConfigCommand;
const de_GetAccountRiskSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AccountBlacklistedForAccountRiskMitigation': smithy_client_1.expectBoolean,
        'RiskSettings': _ => de_AccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAccountRiskSettingsCommand = de_GetAccountRiskSettingsCommand;
const de_GetAccountSettings20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AliasCount': smithy_client_1.expectLong,
        'AliasCountLimit': smithy_client_1.expectLong,
        'CodeStorage': smithy_client_1.expectLong,
        'CodeStorageLimit': smithy_client_1.expectLong,
        'FunctionCount': smithy_client_1.expectLong,
        'SupportedFeatures': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAccountSettings20150331Command = de_GetAccountSettings20150331Command;
const de_GetAccountSettings20160819Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AccountLimit': smithy_client_1._json,
        'AccountUsage': smithy_client_1._json,
        'BlacklistedFeatures': smithy_client_1._json,
        'DeprecatedFeaturesAccess': smithy_client_1._json,
        'HasFunctionWithDeprecatedRuntime': smithy_client_1.expectBoolean,
        'PreviewFeatures': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAccountSettings20160819Command = de_GetAccountSettings20160819Command;
const de_GetAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAccountSettingsInternalCommand = de_GetAccountSettingsInternalCommand;
const de_GetAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AliasArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'Name': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAlias20150331Command = de_GetAlias20150331Command;
const de_GetAliasInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AliasArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'Name': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetAliasInternalCommand = de_GetAliasInternalCommand;
const de_GetCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetCodeSigningConfigCommand = de_GetCodeSigningConfigCommand;
const de_GetDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DurableExecutionArn': smithy_client_1.expectString,
        'DurableExecutionName': smithy_client_1.expectString,
        'Error': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'InputPayload': smithy_client_1.expectString,
        'Result': smithy_client_1.expectString,
        'StartDate': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'Status': smithy_client_1.expectString,
        'StopDate': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'Version': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetDurableExecutionCommand = de_GetDurableExecutionCommand;
const de_GetDurableExecutionHistoryCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Events': _ => de_Events(_, context),
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetDurableExecutionHistoryCommand = de_GetDurableExecutionHistoryCommand;
const de_GetDurableExecutionStateCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'NextMarker': smithy_client_1.expectString,
        'Operations': _ => de_Operations(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetDurableExecutionStateCommand = de_GetDurableExecutionStateCommand;
const de_GetEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'BatchSize': smithy_client_1.expectInt32,
        'EventSource': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'IsActive': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'Parameters': smithy_client_1._json,
        'Role': smithy_client_1.expectString,
        'Status': smithy_client_1.expectString,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetEventSourceCommand = de_GetEventSourceCommand;
const de_GetEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetEventSourceMapping20150331Command = de_GetEventSourceMapping20150331Command;
const de_GetEventSourceMappingInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetEventSourceMappingInternalCommand = de_GetEventSourceMappingInternalCommand;
const de_GetFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Code': smithy_client_1._json,
        'Configuration': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionCommand = de_GetFunctionCommand;
const de_GetFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Code': smithy_client_1._json,
        'Concurrency': smithy_client_1._json,
        'Configuration': smithy_client_1._json,
        'Tags': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunction20150331Command = de_GetFunction20150331Command;
const de_GetFunction20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Code': smithy_client_1._json,
        'Concurrency': smithy_client_1._json,
        'Configuration': smithy_client_1._json,
        'Tags': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunction20150331v2Command = de_GetFunction20150331v2Command;
const de_GetFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfigArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionCodeSigningConfigCommand = de_GetFunctionCodeSigningConfigCommand;
const de_GetFunctionConcurrencyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'ReservedConcurrentExecutions': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionConcurrencyCommand = de_GetFunctionConcurrencyCommand;
const de_GetFunctionConfigurationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSize': smithy_client_1.expectLong,
        'ConfigurationId': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionARN': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'Mode': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'Timeout': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionConfigurationCommand = de_GetFunctionConfigurationCommand;
const de_GetFunctionConfiguration20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionConfiguration20150331Command = de_GetFunctionConfiguration20150331Command;
const de_GetFunctionConfiguration20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionConfiguration20150331v2Command = de_GetFunctionConfiguration20150331v2Command;
const de_GetFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DestinationConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'MaximumEventAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionEventInvokeConfigCommand = de_GetFunctionEventInvokeConfigCommand;
const de_GetFunctionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AppliedFunctionScalingConfig': smithy_client_1._json,
        'CodeSigningConfigArn': smithy_client_1.expectString,
        'Concurrency': smithy_client_1._json,
        'Configuration': smithy_client_1._json,
        'RequestedFunctionScalingConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionInternalCommand = de_GetFunctionInternalCommand;
const de_GetFunctionRecursionConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'RecursiveLoop': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionRecursionConfigCommand = de_GetFunctionRecursionConfigCommand;
const de_GetFunctionScalingConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AppliedFunctionScalingConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'RequestedFunctionScalingConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionScalingConfigCommand = de_GetFunctionScalingConfigCommand;
const de_GetFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AuthType': smithy_client_1.expectString,
        'Cors': smithy_client_1._json,
        'CreationTime': smithy_client_1.expectString,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionUrl': smithy_client_1.expectString,
        'InvokeMode': smithy_client_1.expectString,
        'LastModifiedTime': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetFunctionUrlConfigCommand = de_GetFunctionUrlConfigCommand;
const de_GetLatestLayerVersionInfoInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AccountId': smithy_client_1.expectString,
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'LayerArn': smithy_client_1.expectString,
        'Version': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLatestLayerVersionInfoInternalCommand = de_GetLatestLayerVersionInfoInternalCommand;
const de_GetLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'Content': smithy_client_1._json,
        'CreatedDate': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'LayerArn': smithy_client_1.expectString,
        'LayerVersionArn': smithy_client_1.expectString,
        'LicenseInfo': smithy_client_1.expectString,
        'Version': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLayerVersion20181031Command = de_GetLayerVersion20181031Command;
const de_GetLayerVersionByArn20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'Content': smithy_client_1._json,
        'CreatedDate': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'LayerArn': smithy_client_1.expectString,
        'LayerVersionArn': smithy_client_1.expectString,
        'LicenseInfo': smithy_client_1.expectString,
        'Version': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLayerVersionByArn20181031Command = de_GetLayerVersionByArn20181031Command;
const de_GetLayerVersionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Content': _ => de_LayerVersionInternalContentOutput(_, context),
        'LayerVersionArn': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLayerVersionInternalCommand = de_GetLayerVersionInternalCommand;
const de_GetLayerVersionPolicy20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLayerVersionPolicy20181031Command = de_GetLayerVersionPolicy20181031Command;
const de_GetLayerVersionPolicyInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetLayerVersionPolicyInternalCommand = de_GetLayerVersionPolicyInternalCommand;
const de_GetPolicy20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
        'PublicAccessAllowed': smithy_client_1.expectBoolean,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetPolicy20150331Command = de_GetPolicy20150331Command;
const de_GetPolicy20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
        'PublicAccessAllowed': smithy_client_1.expectBoolean,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetPolicy20150331v2Command = de_GetPolicy20150331v2Command;
const de_GetProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AllocatedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'AvailableProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'LastModified': smithy_client_1.expectString,
        'RequestedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'Status': smithy_client_1.expectString,
        'StatusReason': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetProvisionedConcurrencyConfigCommand = de_GetProvisionedConcurrencyConfigCommand;
const de_GetPublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'PublicAccessBlockConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetPublicAccessBlockConfigCommand = de_GetPublicAccessBlockConfigCommand;
const de_GetResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
        'PublicAccessAllowed': smithy_client_1.expectBoolean,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetResourcePolicyCommand = de_GetResourcePolicyCommand;
const de_GetRuntimeManagementConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionArn': smithy_client_1.expectString,
        'RuntimeVersionArn': smithy_client_1.expectString,
        'UpdateRuntimeOn': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetRuntimeManagementConfigCommand = de_GetRuntimeManagementConfigCommand;
const de_GetVersionProvisionedConcurrencyStatusCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AllocatedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'PreWarmingStatus': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetVersionProvisionedConcurrencyStatusCommand = de_GetVersionProvisionedConcurrencyStatusCommand;
const de_GetVersionSandboxSpecCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'PendingConfigSandboxSpec': context.base64Decoder,
        'SandboxSpec': context.base64Decoder,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_GetVersionSandboxSpecCommand = de_GetVersionSandboxSpecCommand;
const de_ImportAccountSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeStorageTableEntry': smithy_client_1._json,
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
        'RiskSettings': _ => de_MigrationAccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportAccountSettingsCommand = de_ImportAccountSettingsCommand;
const de_ImportAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationAlias': _ => de_MigrationAlias(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportAliasCommand = de_ImportAliasCommand;
const de_ImportFunctionCounterCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionCounter': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportFunctionCounterCommand = de_ImportFunctionCounterCommand;
const de_ImportFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationFunctionUrlConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportFunctionUrlConfigsCommand = de_ImportFunctionUrlConfigsCommand;
const de_ImportFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationFunctionVersion': _ => de_MigrationFunctionVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportFunctionVersionCommand = de_ImportFunctionVersionCommand;
const de_ImportLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'LayerVersion': _ => de_MigrationLayerVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportLayerVersionCommand = de_ImportLayerVersionCommand;
const de_ImportProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'MigrationProvisionedConcurrencyConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ImportProvisionedConcurrencyConfigCommand = de_ImportProvisionedConcurrencyConfigCommand;
const de_InformTagrisAfterResourceCreationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_InformTagrisAfterResourceCreationCommand = de_InformTagrisAfterResourceCreationCommand;
const de_Invoke20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
        [_FE]: [, output.headers[_xafe]],
        [_LR]: [, output.headers[_xalr]],
        [_CTo]: [, output.headers[_ct]],
        [_FRM]: [, output.headers[_xasf]],
        [_CL]: [() => void 0 !== output.headers[_cl], () => (0, smithy_client_1.strictParseInt32)(output.headers[_cl])],
        [_TF]: [, output.headers[_xati]],
        [_EV]: [, output.headers[_xaev]],
        [_DEA]: [, output.headers[_xadea]],
    });
    const data = await (0, smithy_client_1.collectBody)(output.body, context);
    contents.Payload = data;
    (0, smithy_client_1.map)(contents, {
        StatusCode: [, output.statusCode]
    });
    return contents;
};
exports.de_Invoke20150331Command = de_Invoke20150331Command;
const de_InvokeAsyncCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = output.body;
    context.sdkStreamMixin(data);
    contents.Body = data;
    (0, smithy_client_1.map)(contents, {
        Status: [, output.statusCode]
    });
    return contents;
};
exports.de_InvokeAsyncCommand = de_InvokeAsyncCommand;
const de_InvokeWithResponseStreamCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
        [_EV]: [, output.headers[_xaev]],
        [_TF]: [, output.headers[_xati]],
        [_CTo]: [, output.headers[_ct]],
    });
    const data = output.body;
    contents.EventStream = de_InvokeWithResponseStreamResponseEvent(data, context);
    (0, smithy_client_1.map)(contents, {
        StatusCode: [, output.statusCode]
    });
    return contents;
};
exports.de_InvokeWithResponseStreamCommand = de_InvokeWithResponseStreamCommand;
const de_ListAliases20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Aliases': _ => de_AliasList20150331(_, context),
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListAliases20150331Command = de_ListAliases20150331Command;
const de_ListAliasesInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Aliases': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListAliasesInternalCommand = de_ListAliasesInternalCommand;
const de_ListCodeSigningConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfigs': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListCodeSigningConfigsCommand = de_ListCodeSigningConfigsCommand;
const de_ListDurableExecutionsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DurableExecutions': _ => de_DurableExecutions(_, context),
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListDurableExecutionsCommand = de_ListDurableExecutionsCommand;
const de_ListEventSourceMappings20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'EventSourceMappings': _ => de_EventSourceMappingsList(_, context),
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListEventSourceMappings20150331Command = de_ListEventSourceMappings20150331Command;
const de_ListEventSourceMappingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'EventSourceMappings': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListEventSourceMappingsInternalCommand = de_ListEventSourceMappingsInternalCommand;
const de_ListEventSourcesCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'EventSources': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListEventSourcesCommand = de_ListEventSourcesCommand;
const de_ListFunctionAliasResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'ResourceMappings': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionAliasResourceMappingsCommand = de_ListFunctionAliasResourceMappingsCommand;
const de_ListFunctionCountersInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionCounters': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionCountersInternalCommand = de_ListFunctionCountersInternalCommand;
const de_ListFunctionEventInvokeConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionEventInvokeConfigs': _ => de_FunctionEventInvokeConfigList(_, context),
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionEventInvokeConfigsCommand = de_ListFunctionEventInvokeConfigsCommand;
const de_ListFunctionResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'ResourceMappings': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionResourceMappingsCommand = de_ListFunctionResourceMappingsCommand;
const de_ListFunctionsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Functions': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionsCommand = de_ListFunctionsCommand;
const de_ListFunctions20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Functions': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctions20150331Command = de_ListFunctions20150331Command;
const de_ListFunctionsByCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionArns': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionsByCodeSigningConfigCommand = de_ListFunctionsByCodeSigningConfigCommand;
const de_ListFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionUrlConfigs': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionUrlConfigsCommand = de_ListFunctionUrlConfigsCommand;
const de_ListFunctionUrlsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionUrls': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionUrlsInternalCommand = de_ListFunctionUrlsInternalCommand;
const de_ListFunctionVersionResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'ResourceMappings': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionVersionResourceMappingsCommand = de_ListFunctionVersionResourceMappingsCommand;
const de_ListFunctionVersionsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionVersions': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListFunctionVersionsInternalCommand = de_ListFunctionVersionsInternalCommand;
const de_ListLayers20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Layers': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListLayers20181031Command = de_ListLayers20181031Command;
const de_ListLayerVersions20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'LayerVersions': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListLayerVersions20181031Command = de_ListLayerVersions20181031Command;
const de_ListLayerVersionsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'LayerVersionArns': smithy_client_1._json,
        'NextMarker': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListLayerVersionsInternalCommand = de_ListLayerVersionsInternalCommand;
const de_ListProvisionedConcurrencyConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'NextMarker': smithy_client_1.expectString,
        'ProvisionedConcurrencyConfigs': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListProvisionedConcurrencyConfigsCommand = de_ListProvisionedConcurrencyConfigsCommand;
const de_ListProvisionedConcurrencyConfigsByAccountIdCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'NextMarker': smithy_client_1.expectString,
        'ProvisionedConcurrencyConfigs': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListProvisionedConcurrencyConfigsByAccountIdCommand = de_ListProvisionedConcurrencyConfigsByAccountIdCommand;
const de_ListTags20170331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Tags': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListTags20170331Command = de_ListTags20170331Command;
const de_ListVersionsByFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'NextMarker': smithy_client_1.expectString,
        'Versions': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ListVersionsByFunction20150331Command = de_ListVersionsByFunction20150331Command;
const de_PublishLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'Content': smithy_client_1._json,
        'CreatedDate': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'LayerArn': smithy_client_1.expectString,
        'LayerCodeSignatureCloudTrailData': smithy_client_1._json,
        'LayerVersionArn': smithy_client_1.expectString,
        'LicenseInfo': smithy_client_1.expectString,
        'Version': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PublishLayerVersion20181031Command = de_PublishLayerVersion20181031Command;
const de_PublishVersion20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PublishVersion20150331Command = de_PublishVersion20150331Command;
const de_PutFunctionAliasResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_PutFunctionAliasResourceMappingCommand = de_PutFunctionAliasResourceMappingCommand;
const de_PutFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfigArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionCodeSigningConfigCommand = de_PutFunctionCodeSigningConfigCommand;
const de_PutFunctionConcurrency20171031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'ReservedConcurrentExecutions': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionConcurrency20171031Command = de_PutFunctionConcurrency20171031Command;
const de_PutFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DestinationConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'MaximumEventAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionEventInvokeConfigCommand = de_PutFunctionEventInvokeConfigCommand;
const de_PutFunctionRecursionConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'RecursiveLoop': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionRecursionConfigCommand = de_PutFunctionRecursionConfigCommand;
const de_PutFunctionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionId': smithy_client_1.expectString,
        'FunctionSequenceNumber': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionResourceMappingCommand = de_PutFunctionResourceMappingCommand;
const de_PutFunctionScalingConfigCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionState': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutFunctionScalingConfigCommand = de_PutFunctionScalingConfigCommand;
const de_PutFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_PutFunctionVersionResourceMappingCommand = de_PutFunctionVersionResourceMappingCommand;
const de_PutProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AllocatedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'LastModified': smithy_client_1.expectString,
        'RequestedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'Status': smithy_client_1.expectString,
        'StatusReason': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutProvisionedConcurrencyConfigCommand = de_PutProvisionedConcurrencyConfigCommand;
const de_PutPublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'PublicAccessBlockConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutPublicAccessBlockConfigCommand = de_PutPublicAccessBlockConfigCommand;
const de_PutResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Policy': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutResourcePolicyCommand = de_PutResourcePolicyCommand;
const de_PutRuntimeManagementConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'FunctionArn': smithy_client_1.expectString,
        'RuntimeVersionArn': smithy_client_1.expectString,
        'UpdateRuntimeOn': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_PutRuntimeManagementConfigCommand = de_PutRuntimeManagementConfigCommand;
const de_ReconcileProvisionedConcurrencyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_ReconcileProvisionedConcurrencyCommand = de_ReconcileProvisionedConcurrencyCommand;
const de_RedriveFunctionResourceTagsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Terminated': smithy_client_1.expectBoolean,
        'ValidationToken': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_RedriveFunctionResourceTagsCommand = de_RedriveFunctionResourceTagsCommand;
const de_RemoveEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_RemoveEventSourceCommand = de_RemoveEventSourceCommand;
const de_RemoveLayerVersionPermission20181031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_RemoveLayerVersionPermission20181031Command = de_RemoveLayerVersionPermission20181031Command;
const de_RemovePermission20150331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_RemovePermission20150331Command = de_RemovePermission20150331Command;
const de_RemovePermission20150331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_RemovePermission20150331v2Command = de_RemovePermission20150331v2Command;
const de_ResetFunctionFeatureInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_ResetFunctionFeatureInternalCommand = de_ResetFunctionFeatureInternalCommand;
const de_ResignFunctionAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Resigned': smithy_client_1.expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ResignFunctionAliasCommand = de_ResignFunctionAliasCommand;
const de_ResignFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Resigned': smithy_client_1.expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ResignFunctionVersionCommand = de_ResignFunctionVersionCommand;
const de_RollbackFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'RuntimeResult': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_RollbackFunctionCommand = de_RollbackFunctionCommand;
const de_RollbackTagsOwnershipFromLambdaCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'HasTagsOwnershipTransferOccurred': smithy_client_1.expectBoolean,
        'ValidationToken': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_RollbackTagsOwnershipFromLambdaCommand = de_RollbackTagsOwnershipFromLambdaCommand;
const de_SafeDeleteProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_SafeDeleteProvisionedConcurrencyConfigCommand = de_SafeDeleteProvisionedConcurrencyConfigCommand;
const de_SendDurableExecutionCallbackFailureCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_SendDurableExecutionCallbackFailureCommand = de_SendDurableExecutionCallbackFailureCommand;
const de_SendDurableExecutionCallbackHeartbeatCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_SendDurableExecutionCallbackHeartbeatCommand = de_SendDurableExecutionCallbackHeartbeatCommand;
const de_SendDurableExecutionCallbackSuccessCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_SendDurableExecutionCallbackSuccessCommand = de_SendDurableExecutionCallbackSuccessCommand;
const de_SetAccountRiskSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_SetAccountRiskSettingsCommand = de_SetAccountRiskSettingsCommand;
const de_SetAccountSettings20170430Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AccountLimit': smithy_client_1._json,
        'AccountUsage': smithy_client_1._json,
        'DeprecatedFeaturesAccess': smithy_client_1._json,
        'PreviewFeatures': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_SetAccountSettings20170430Command = de_SetAccountSettings20170430Command;
const de_StopDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'StopDate': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_StopDurableExecutionCommand = de_StopDurableExecutionCommand;
const de_TagResource20170331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Tags': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_TagResource20170331Command = de_TagResource20170331Command;
const de_TagResource20170331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_TagResource20170331v2Command = de_TagResource20170331v2Command;
const de_TagResourceBeforeResourceCreationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'TagrisExpectedVersion': smithy_client_1.expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_TagResourceBeforeResourceCreationCommand = de_TagResourceBeforeResourceCreationCommand;
const de_TransferTagsOwnershipToLambdaCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'HasTagsOwnershipTransferOccurred': smithy_client_1.expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_TransferTagsOwnershipToLambdaCommand = de_TransferTagsOwnershipToLambdaCommand;
const de_UntagResource20170331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_UntagResource20170331Command = de_UntagResource20170331Command;
const de_UntagResource20170331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_UntagResource20170331v2Command = de_UntagResource20170331v2Command;
const de_UpdateAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_UpdateAccountSettingsInternalCommand = de_UpdateAccountSettingsInternalCommand;
const de_UpdateAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AliasArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'Name': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateAlias20150331Command = de_UpdateAlias20150331Command;
const de_UpdateCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSigningConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateCodeSigningConfigCommand = de_UpdateCodeSigningConfigCommand;
const de_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = de_UpdateConcurrencyInProvisionedConcurrencyConfigCommand;
const de_UpdateEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateEventSourceMapping20150331Command = de_UpdateEventSourceMapping20150331Command;
const de_UpdateFunctionCodeCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSize': smithy_client_1.expectLong,
        'ConfigurationId': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionARN': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'Mode': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'Timeout': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionCodeCommand = de_UpdateFunctionCodeCommand;
const de_UpdateFunctionCode20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionCode20150331Command = de_UpdateFunctionCode20150331Command;
const de_UpdateFunctionCode20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionCode20150331v2Command = de_UpdateFunctionCode20150331v2Command;
const de_UpdateFunctionConfigurationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSize': smithy_client_1.expectLong,
        'ConfigurationId': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionARN': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'Mode': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'Timeout': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionConfigurationCommand = de_UpdateFunctionConfigurationCommand;
const de_UpdateFunctionConfiguration20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionConfiguration20150331Command = de_UpdateFunctionConfiguration20150331Command;
const de_UpdateFunctionConfiguration20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'Architectures': smithy_client_1._json,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'DeadLetterConfig': smithy_client_1._json,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'Environment': smithy_client_1._json,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FileSystemConfigs': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'FunctionVersionId': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'ImageConfigResponse': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'LastUpdateStatus': smithy_client_1.expectString,
        'LastUpdateStatusReason': smithy_client_1.expectString,
        'LastUpdateStatusReasonCode': smithy_client_1.expectString,
        'Layers': smithy_client_1._json,
        'LoggingConfig': smithy_client_1._json,
        'MasterArn': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'PackageType': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeVersionConfig': smithy_client_1._json,
        'SigningJobArn': smithy_client_1.expectString,
        'SigningProfileVersionArn': smithy_client_1.expectString,
        'SnapStart': smithy_client_1._json,
        'State': smithy_client_1.expectString,
        'StateReason': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TracingConfig': smithy_client_1._json,
        'Version': smithy_client_1.expectString,
        'VpcConfig': smithy_client_1._json,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionConfiguration20150331v2Command = de_UpdateFunctionConfiguration20150331v2Command;
const de_UpdateFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DestinationConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'LastModified': _ => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'MaximumEventAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionEventInvokeConfigCommand = de_UpdateFunctionEventInvokeConfigCommand;
const de_UpdateFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AuthType': smithy_client_1.expectString,
        'Cors': smithy_client_1._json,
        'CreationTime': smithy_client_1.expectString,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionUrl': smithy_client_1.expectString,
        'InvokeMode': smithy_client_1.expectString,
        'LastModifiedTime': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateFunctionUrlConfigCommand = de_UpdateFunctionUrlConfigCommand;
const de_UpdateFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    await (0, smithy_client_1.collectBody)(output.body, context);
    return contents;
};
exports.de_UpdateFunctionVersionResourceMappingCommand = de_UpdateFunctionVersionResourceMappingCommand;
const de_UpdateProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'LastModified': smithy_client_1.expectString,
        'Status': smithy_client_1.expectString,
        'StatusReason': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateProvisionedConcurrencyConfigCommand = de_UpdateProvisionedConcurrencyConfigCommand;
const de_UpdateVersionProvisionedConcurrencyStatusCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'AllocatedProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'RevisionId': smithy_client_1.expectString,
        'Status': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UpdateVersionProvisionedConcurrencyStatusCommand = de_UpdateVersionProvisionedConcurrencyStatusCommand;
const de_UploadFunctionCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'CodeSize': smithy_client_1.expectLong,
        'ConfigurationId': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionARN': smithy_client_1.expectString,
        'FunctionName': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'LastModified': smithy_client_1.expectString,
        'MemorySize': smithy_client_1.expectInt32,
        'Mode': smithy_client_1.expectString,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'Timeout': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_UploadFunctionCommand = de_UploadFunctionCommand;
const de_ValidateProvisionedConcurrencyFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = (0, smithy_client_1.map)({
        $metadata: deserializeMetadata(output),
    });
    const data = (0, smithy_client_1.expectNonNull)(((0, smithy_client_1.expectObject)(await (0, core_1.parseJsonBody)(output.body, context))), "body");
    const doc = (0, smithy_client_1.take)(data, {
        'DesiredProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
exports.de_ValidateProvisionedConcurrencyFunctionVersionCommand = de_ValidateProvisionedConcurrencyFunctionVersionCommand;
const de_CommandError = async (output, context) => {
    const parsedOutput = {
        ...output,
        body: await (0, core_1.parseJsonErrorBody)(output.body, context)
    };
    const errorCode = (0, core_1.loadRestJsonErrorCode)(output, parsedOutput.body);
    switch (errorCode) {
        case "InvalidParameterValueException":
        case "com.amazonaws.awsgirapi#InvalidParameterValueException":
            throw await de_InvalidParameterValueExceptionRes(parsedOutput, context);
        case "ResourceConflictException":
        case "com.amazonaws.awsgirapi#ResourceConflictException":
            throw await de_ResourceConflictExceptionRes(parsedOutput, context);
        case "ResourceNotFoundException":
        case "com.amazonaws.awsgirapi#ResourceNotFoundException":
            throw await de_ResourceNotFoundExceptionRes(parsedOutput, context);
        case "ServiceException":
        case "com.amazonaws.awsgirapi#ServiceException":
            throw await de_ServiceExceptionRes(parsedOutput, context);
        case "PolicyLengthExceededException":
        case "com.amazonaws.awsgirapi#PolicyLengthExceededException":
            throw await de_PolicyLengthExceededExceptionRes(parsedOutput, context);
        case "PreconditionFailedException":
        case "com.amazonaws.awsgirapi#PreconditionFailedException":
            throw await de_PreconditionFailedExceptionRes(parsedOutput, context);
        case "TooManyRequestsException":
        case "com.amazonaws.awsgirapi#TooManyRequestsException":
            throw await de_TooManyRequestsExceptionRes(parsedOutput, context);
        case "PublicPolicyException":
        case "com.amazonaws.awsgirapi#PublicPolicyException":
            throw await de_PublicPolicyExceptionRes(parsedOutput, context);
        case "AliasLimitExceededException":
        case "com.amazonaws.awsgirapi#AliasLimitExceededException":
            throw await de_AliasLimitExceededExceptionRes(parsedOutput, context);
        case "CodeSigningConfigNotFoundException":
        case "com.amazonaws.awsgirapi#CodeSigningConfigNotFoundException":
            throw await de_CodeSigningConfigNotFoundExceptionRes(parsedOutput, context);
        case "CodeStorageExceededException":
        case "com.amazonaws.awsgirapi#CodeStorageExceededException":
            throw await de_CodeStorageExceededExceptionRes(parsedOutput, context);
        case "CodeVerificationFailedException":
        case "com.amazonaws.awsgirapi#CodeVerificationFailedException":
            throw await de_CodeVerificationFailedExceptionRes(parsedOutput, context);
        case "InvalidCodeSignatureException":
        case "com.amazonaws.awsgirapi#InvalidCodeSignatureException":
            throw await de_InvalidCodeSignatureExceptionRes(parsedOutput, context);
        case "ResourceInUseException":
        case "com.amazonaws.awsgirapi#ResourceInUseException":
            throw await de_ResourceInUseExceptionRes(parsedOutput, context);
        case "ResourceNotReadyException":
        case "com.amazonaws.awsgirapi#ResourceNotReadyException":
            throw await de_ResourceNotReadyExceptionRes(parsedOutput, context);
        case "InternalLambdaAccountDisabledException":
        case "com.amazonaws.awsgirapi#InternalLambdaAccountDisabledException":
            throw await de_InternalLambdaAccountDisabledExceptionRes(parsedOutput, context);
        case "ProvisionedConcurrencyConfigNotFoundException":
        case "com.amazonaws.awsgirapi#ProvisionedConcurrencyConfigNotFoundException":
            throw await de_ProvisionedConcurrencyConfigNotFoundExceptionRes(parsedOutput, context);
        case "DurableExecutionAlreadyStartedException":
        case "com.amazonaws.awsgirapi#DurableExecutionAlreadyStartedException":
            throw await de_DurableExecutionAlreadyStartedExceptionRes(parsedOutput, context);
        case "EC2AccessDeniedException":
        case "com.amazonaws.awsgirapi#EC2AccessDeniedException":
            throw await de_EC2AccessDeniedExceptionRes(parsedOutput, context);
        case "EC2ThrottledException":
        case "com.amazonaws.awsgirapi#EC2ThrottledException":
            throw await de_EC2ThrottledExceptionRes(parsedOutput, context);
        case "EC2UnexpectedException":
        case "com.amazonaws.awsgirapi#EC2UnexpectedException":
            throw await de_EC2UnexpectedExceptionRes(parsedOutput, context);
        case "EFSIOException":
        case "com.amazonaws.awsgirapi#EFSIOException":
            throw await de_EFSIOExceptionRes(parsedOutput, context);
        case "EFSMountConnectivityException":
        case "com.amazonaws.awsgirapi#EFSMountConnectivityException":
            throw await de_EFSMountConnectivityExceptionRes(parsedOutput, context);
        case "EFSMountFailureException":
        case "com.amazonaws.awsgirapi#EFSMountFailureException":
            throw await de_EFSMountFailureExceptionRes(parsedOutput, context);
        case "EFSMountTimeoutException":
        case "com.amazonaws.awsgirapi#EFSMountTimeoutException":
            throw await de_EFSMountTimeoutExceptionRes(parsedOutput, context);
        case "ENILimitReachedException":
        case "com.amazonaws.awsgirapi#ENILimitReachedException":
            throw await de_ENILimitReachedExceptionRes(parsedOutput, context);
        case "InvalidRequestContentException":
        case "com.amazonaws.awsgirapi#InvalidRequestContentException":
            throw await de_InvalidRequestContentExceptionRes(parsedOutput, context);
        case "InvalidRuntimeException":
        case "com.amazonaws.awsgirapi#InvalidRuntimeException":
            throw await de_InvalidRuntimeExceptionRes(parsedOutput, context);
        case "InvalidSecurityGroupIDException":
        case "com.amazonaws.awsgirapi#InvalidSecurityGroupIDException":
            throw await de_InvalidSecurityGroupIDExceptionRes(parsedOutput, context);
        case "InvalidSubnetIDException":
        case "com.amazonaws.awsgirapi#InvalidSubnetIDException":
            throw await de_InvalidSubnetIDExceptionRes(parsedOutput, context);
        case "InvalidZipFileException":
        case "com.amazonaws.awsgirapi#InvalidZipFileException":
            throw await de_InvalidZipFileExceptionRes(parsedOutput, context);
        case "KMSAccessDeniedException":
        case "com.amazonaws.awsgirapi#KMSAccessDeniedException":
            throw await de_KMSAccessDeniedExceptionRes(parsedOutput, context);
        case "KMSDisabledException":
        case "com.amazonaws.awsgirapi#KMSDisabledException":
            throw await de_KMSDisabledExceptionRes(parsedOutput, context);
        case "KMSInvalidStateException":
        case "com.amazonaws.awsgirapi#KMSInvalidStateException":
            throw await de_KMSInvalidStateExceptionRes(parsedOutput, context);
        case "KMSNotFoundException":
        case "com.amazonaws.awsgirapi#KMSNotFoundException":
            throw await de_KMSNotFoundExceptionRes(parsedOutput, context);
        case "ModeNotSupportedException":
        case "com.amazonaws.awsgirapi#ModeNotSupportedException":
            throw await de_ModeNotSupportedExceptionRes(parsedOutput, context);
        case "NoPublishedVersionException":
        case "com.amazonaws.awsgirapi#NoPublishedVersionException":
            throw await de_NoPublishedVersionExceptionRes(parsedOutput, context);
        case "RecursiveInvocationException":
        case "com.amazonaws.awsgirapi#RecursiveInvocationException":
            throw await de_RecursiveInvocationExceptionRes(parsedOutput, context);
        case "RequestTooLargeException":
        case "com.amazonaws.awsgirapi#RequestTooLargeException":
            throw await de_RequestTooLargeExceptionRes(parsedOutput, context);
        case "SnapRestoreException":
        case "com.amazonaws.awsgirapi#SnapRestoreException":
            throw await de_SnapRestoreExceptionRes(parsedOutput, context);
        case "SnapRestoreTimeoutException":
        case "com.amazonaws.awsgirapi#SnapRestoreTimeoutException":
            throw await de_SnapRestoreTimeoutExceptionRes(parsedOutput, context);
        case "SnapStartException":
        case "com.amazonaws.awsgirapi#SnapStartException":
            throw await de_SnapStartExceptionRes(parsedOutput, context);
        case "SnapStartNotReadyException":
        case "com.amazonaws.awsgirapi#SnapStartNotReadyException":
            throw await de_SnapStartNotReadyExceptionRes(parsedOutput, context);
        case "SnapStartRegenerationFailureException":
        case "com.amazonaws.awsgirapi#SnapStartRegenerationFailureException":
            throw await de_SnapStartRegenerationFailureExceptionRes(parsedOutput, context);
        case "SnapStartTimeoutException":
        case "com.amazonaws.awsgirapi#SnapStartTimeoutException":
            throw await de_SnapStartTimeoutExceptionRes(parsedOutput, context);
        case "SubnetIPAddressLimitReachedException":
        case "com.amazonaws.awsgirapi#SubnetIPAddressLimitReachedException":
            throw await de_SubnetIPAddressLimitReachedExceptionRes(parsedOutput, context);
        case "UnsupportedMediaTypeException":
        case "com.amazonaws.awsgirapi#UnsupportedMediaTypeException":
            throw await de_UnsupportedMediaTypeExceptionRes(parsedOutput, context);
        case "CallbackTimeoutException":
        case "com.amazonaws.awsgirapi#CallbackTimeoutException":
            throw await de_CallbackTimeoutExceptionRes(parsedOutput, context);
        default:
            const parsedBody = parsedOutput.body;
            return throwDefaultError({
                output,
                parsedBody,
                errorCode
            });
    }
};
const throwDefaultError = (0, smithy_client_1.withBaseException)(LambdaServiceException_1.LambdaServiceException);
const de_AliasLimitExceededExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.AliasLimitExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_CallbackTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.CallbackTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_CodeSigningConfigNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.CodeSigningConfigNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_CodeStorageExceededExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.CodeStorageExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_CodeVerificationFailedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.CodeVerificationFailedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_DurableExecutionAlreadyStartedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.DurableExecutionAlreadyStartedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EC2AccessDeniedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EC2AccessDeniedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EC2ThrottledExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EC2ThrottledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EC2UnexpectedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'EC2ErrorCode': smithy_client_1.expectString,
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EC2UnexpectedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EFSIOExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EFSIOException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EFSMountConnectivityExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EFSMountConnectivityException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EFSMountFailureExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EFSMountFailureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_EFSMountTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.EFSMountTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ENILimitReachedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.ENILimitReachedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InternalLambdaAccountDisabledExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.InternalLambdaAccountDisabledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidCodeSignatureExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.InvalidCodeSignatureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidParameterValueExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.InvalidParameterValueException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidRequestContentExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.InvalidRequestContentException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidRuntimeExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.InvalidRuntimeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidSecurityGroupIDExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.InvalidSecurityGroupIDException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidSubnetIDExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.InvalidSubnetIDException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvalidZipFileExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.InvalidZipFileException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_KMSAccessDeniedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.KMSAccessDeniedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_KMSDisabledExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.KMSDisabledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_KMSInvalidStateExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.KMSInvalidStateException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_KMSNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.KMSNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ModeNotSupportedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.ModeNotSupportedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_NoPublishedVersionExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.NoPublishedVersionException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_PolicyLengthExceededExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.PolicyLengthExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_PreconditionFailedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.PreconditionFailedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ProvisionedConcurrencyConfigNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ProvisionedConcurrencyConfigNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_PublicPolicyExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.PublicPolicyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_RecursiveInvocationExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.RecursiveInvocationException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_RequestTooLargeExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.RequestTooLargeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ResourceConflictExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ResourceConflictException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ResourceInUseExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ResourceInUseException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ResourceNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ResourceNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ResourceNotReadyExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ResourceNotReadyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_ServiceExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.ServiceException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapRestoreExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapRestoreException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapRestoreTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapRestoreTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapStartExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapStartException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapStartNotReadyExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapStartNotReadyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapStartRegenerationFailureExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapStartRegenerationFailureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SnapStartTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SnapStartTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_SubnetIPAddressLimitReachedExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Message': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.SubnetIPAddressLimitReachedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_TooManyRequestsExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({
        [_rAS]: [, parsedOutput.headers[_ra]],
    });
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Reason': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_0_1.TooManyRequestsException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_UnsupportedMediaTypeExceptionRes = async (parsedOutput, context) => {
    const contents = (0, smithy_client_1.map)({});
    const data = parsedOutput.body;
    const doc = (0, smithy_client_1.take)(data, {
        'Type': smithy_client_1.expectString,
        'message': smithy_client_1.expectString,
    });
    Object.assign(contents, doc);
    const exception = new models_1_1.UnsupportedMediaTypeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return (0, smithy_client_1.decorateServiceException)(exception, parsedOutput.body);
};
const de_InvokeWithResponseStreamResponseEvent = (output, context) => {
    return context.eventStreamMarshaller.deserialize(output, async (event) => {
        if (event["PayloadChunk"] != null) {
            return {
                PayloadChunk: await de_InvokeResponseStreamUpdate_event(event["PayloadChunk"], context),
            };
        }
        if (event["InvokeComplete"] != null) {
            return {
                InvokeComplete: await de_InvokeWithResponseStreamCompleteEvent_event(event["InvokeComplete"], context),
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
const de_InvokeWithResponseStreamCompleteEvent_event = async (output, context) => {
    const contents = {};
    const data = await (0, core_1.parseJsonBody)(output.body, context);
    Object.assign(contents, (0, smithy_client_1._json)(data));
    return contents;
};
const se_AccountRiskSettings = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'ContainmentScore': [],
        'RiskDetectedTime': _ => (_.getTime() / 1_000),
        'RiskSource': [],
        'RiskStatus': [],
    });
};
const se_AdditionalVersionWeights = (input, context) => {
    return Object.entries(input).reduce((acc, [key, value]) => {
        if (value === null) {
            return acc;
        }
        acc[key] = (0, smithy_client_1.serializeFloat)(value);
        return acc;
    }, {});
};
const se_AliasRoutingConfiguration = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AdditionalVersionWeights': _ => se_AdditionalVersionWeights(_, context),
    });
};
const se_CustomerConfigInternal = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AccountId': [],
        'AccountRiskMetadata': smithy_client_1._json,
        'AccountRiskSource': [],
        'AccountRiskStatusTimestamp': _ => (_.getTime() / 1_000),
        'AccountStatus': [],
        'AccountStatusEvent': [],
        'AccountStatusTimestampAsEpochMilli': [],
        'AliasLimit': [],
        'ArcScalingParameters': smithy_client_1._json,
        'CellId': [],
        'ConcurrencySequenceNumber': [],
        'ControlAPIThrottleLimit': [],
        'CountingServiceBatchDivisor': [],
        'CountingServiceBatchParameters': smithy_client_1._json,
        'DenyListFeatures': smithy_client_1._json,
        'DeprecatedFeaturesControlAccess': smithy_client_1._json,
        'DeprecatedFeaturesInvokeAccess': smithy_client_1._json,
        'Enabled': [],
        'EniLimit': [],
        'EniVpcLimits': smithy_client_1._json,
        'EventSourceMappingRestrictions': smithy_client_1._json,
        'Features': smithy_client_1._json,
        'FunctionMemorySizeLimit': [],
        'GetFunctionAPIThrottleLimit': [],
        'GetPolicyAPIThrottleLimit': [],
        'InvokeAsyncThrottleLimit': [],
        'LargeCloudFunctionConcurrencyLimit': [],
        'MaxQueueDepth': [],
        'MigrationStatus': [],
        'PreviewFeatures': smithy_client_1._json,
        'ProvisionedConcurrencyPreWarmingRate': [],
        'RequestSignerInvokeTpsLimitOverride': [],
        'RuntimesPinnedToAL1703ByDefaultOnCreate': smithy_client_1._json,
        'RuntimesPinnedToAL1703ByDefaultOnUpdate': smithy_client_1._json,
        'ShardPoolParameters': smithy_client_1._json,
        'SmallCloudFunctionConcurrencyLimit': [],
        'SplitCountParameters': smithy_client_1._json,
        'SqsQueueName': [],
        'TotalCodeSizeLimit': [],
        'UnreservedConcurrentExecutions': [],
        'UnreservedConcurrentExecutionsMinimum': [],
        'VersionString': [],
    });
};
const se_FunctionCode = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'ImageUri': [],
        'S3Bucket': [],
        'S3Key': [],
        'S3ObjectStorageMode': [],
        'S3ObjectVersion': [],
        'SourceKMSKeyArn': [],
        'ZipFile': context.base64Encoder,
    });
};
const se_LayerConfig = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'CodeSignatureExpirationTime': [],
        'CodeSignatureRevocationData': context.base64Encoder,
        'CodeSignatureStatus': [],
        'CodeSigningJobArn': [],
        'CodeSigningProfileArn': [],
        'CodeSize': [],
        'LayerArn': [],
        'S3CodeUri': [],
        'S3VersionId': [],
        'UncompressedCodeSize': [],
    });
};
const se_LayerConfigList = (input, context) => {
    return input.filter((e) => e != null).map(entry => {
        return se_LayerConfig(entry, context);
    });
};
const se_LayerVersionContentInput20181031 = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'DirectUploadLayerCodeTempPath': smithy_client_1._json,
        'S3Bucket': [],
        'S3Key': [],
        'S3ObjectVersion': [],
        'ZipFile': context.base64Encoder,
    });
};
const se_MigrationAccountRiskSettings = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AccountRiskMetadata': smithy_client_1._json,
        'RiskDetectedTime': _ => (_.getTime() / 1_000),
        'RiskSource': [],
    });
};
const se_MigrationAlias = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AdditionalVersionWeights': _ => se_AdditionalVersionWeights(_, context),
        'AliasArn': [],
        'AliasName': [],
        'Description': [],
        'FunctionVersion': [],
        'HashOfConsistentFields': [],
        'ModifiedDateInEpochMillis': [],
        'Policy': [],
        'PublicPolicyAttached': [],
        'TargetAdditionalVersionWeights': _ => se_AdditionalVersionWeights(_, context),
    });
};
const se_MigrationFunctionVersion = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AccountId': [],
        'AllLayerConfigs': _ => se_LayerConfigList(_, context),
        'Architectures': smithy_client_1._json,
        'Code': [],
        'CodeMergedWithLayersUri': [],
        'CodeSha256': [],
        'CodeSignatureExpirationTime': [],
        'CodeSigningConfigArn': [],
        'CodeSigningJobArn': [],
        'CodeSigningProfileArn': [],
        'CodeSize': [],
        'ConcurrencySequenceNumber': [],
        'ConfigSha256': [],
        'CustomerSubnetsByLambdaAz': smithy_client_1._json,
        'DeadLetterArn': [],
        'Description': [],
        'DurableConfig': smithy_client_1._json,
        'EnableTracer': [],
        'EncryptedEnvironmentVars': [],
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FunctionArn': [],
        'FunctionId': [],
        'FunctionSequenceNumber': [],
        'FunctionVersion': [],
        'GenerateDataKeyKmsGrantId': [],
        'GenerateDataKeyKmsGrantToken': [],
        'Handler': [],
        'HashOfConsistentFields': [],
        'Ipv6AllowedForDualStack': [],
        'IsLarge': [],
        'KmsGrantId': [],
        'KmsGrantToken': [],
        'KmsKeyArn': [],
        'LayerConfigs': _ => se_LayerConfigList(_, context),
        'LoggingConfig': smithy_client_1._json,
        'MemoryLimitMb': [],
        'MergedLayersUri': [],
        'Mode': [],
        'ModifiedDateAsEpochMilli': [],
        'Name': [],
        'PackageType': [],
        'PendingTaskConfig': [],
        'Policy': [],
        'PollerCustomerVpcRole': [],
        'PreviousRuntimeArtifactArn': [],
        'PreviousRuntimeVersion': [],
        'ProgrammingModel': [],
        'ProvisionedConcurrencyState': [],
        'PublicAccessBlockConfig': smithy_client_1._json,
        'PublicPolicyAttached': [],
        'PublishedVersion': [],
        'ReservedConcurrentExecutions': [],
        'Role': [],
        'Runtime': [],
        'RuntimeArtifactArn': [],
        'RuntimeUpdateReason': [],
        'RuntimeVariant': [],
        'RuntimeVersion': [],
        'SandboxGeneration': [],
        'SecurityGroupIds': smithy_client_1._json,
        'SnapStart': smithy_client_1._json,
        'SqsQueueName': [],
        'SquashfsRollbackVersionId': [],
        'State': [],
        'StateReasonCode': [],
        'Tagged': [],
        'TagsInfo': smithy_client_1._json,
        'TargetSourceArn': [],
        'TenancyConfig': smithy_client_1._json,
        'Timeout': [],
        'TotalProvisionedConcurrentExecutions': [],
        'TracingMode': [],
        'TransactionId': [],
        'UncompresedCodeSize': [],
        'UnderlyingPackageType': [],
        'VersionId': [],
        'VmSelectorPreference': [],
        'VpcDelegationRole': [],
        'VpcId': [],
        'VpcOwnerRole': [],
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
};
const se_MigrationLayerVersion = (input, context) => {
    return (0, smithy_client_1.take)(input, {
        'AccountId': [],
        'CodeSha256': [],
        'CodeSignatureExpirationTime': [],
        'CodeSignatureRevocationData': context.base64Encoder,
        'CodeSignatureStatus': [],
        'CodeSigningJobArn': [],
        'CodeSigningProfileArn': [],
        'CodeSize': [],
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'CreatedDate': [],
        'CurrentVersionNumber': [],
        'Description': [],
        'HashOfConsistentFields': [],
        'LatestUsableCompatibleArchitectures': smithy_client_1._json,
        'LatestUsableCompatibleRuntimes': smithy_client_1._json,
        'LatestUsableVersionNumber': [],
        'LayerArn': [],
        'LayerId': [],
        'LayerVersionArn': [],
        'LicenseInfo': [],
        'Policy': [],
        'RevisionId': [],
        'SquashFSSignedUrl': [],
        'UncompressedCodeSize': [],
        'ZipFileSignedUrl': [],
    });
};
const de_AccountRiskSettings = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'ContainmentScore': smithy_client_1.expectInt32,
        'RiskDetectedTime': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'RiskSource': smithy_client_1.expectString,
        'RiskStatus': smithy_client_1.expectInt32,
    });
};
const de_AdditionalVersionWeights = (output, context) => {
    return Object.entries(output).reduce((acc, [key, value]) => {
        if (value === null) {
            return acc;
        }
        acc[key] = (0, smithy_client_1.limitedParseDouble)(value);
        return acc;
    }, {});
};
const de_AliasConfiguration20150331 = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AliasArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'Name': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'RoutingConfig': (_) => de_AliasRoutingConfiguration(_, context),
    });
};
const de_AliasList20150331 = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_AliasConfiguration20150331(entry, context);
    });
    return retVal;
};
const de_AliasRoutingConfiguration = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
    });
};
const de_CheckpointUpdatedExecutionState = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'NextMarker': smithy_client_1.expectString,
        'Operations': (_) => de_Operations(_, context),
    });
};
const de_CustomerConfigInternal = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AccountId': smithy_client_1.expectString,
        'AccountRiskMetadata': smithy_client_1._json,
        'AccountRiskSource': smithy_client_1.expectString,
        'AccountRiskStatusTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'AccountStatus': smithy_client_1.expectString,
        'AccountStatusEvent': smithy_client_1.expectString,
        'AccountStatusTimestampAsEpochMilli': smithy_client_1.expectLong,
        'AliasLimit': smithy_client_1.expectLong,
        'ArcScalingParameters': smithy_client_1._json,
        'CellId': smithy_client_1.expectString,
        'ConcurrencySequenceNumber': smithy_client_1.expectLong,
        'ControlAPIThrottleLimit': smithy_client_1.expectInt32,
        'CountingServiceBatchDivisor': smithy_client_1.expectInt32,
        'CountingServiceBatchParameters': smithy_client_1._json,
        'DenyListFeatures': smithy_client_1._json,
        'DeprecatedFeaturesControlAccess': smithy_client_1._json,
        'DeprecatedFeaturesInvokeAccess': smithy_client_1._json,
        'Enabled': smithy_client_1.expectBoolean,
        'EniLimit': smithy_client_1.expectInt32,
        'EniVpcLimits': smithy_client_1._json,
        'EventSourceMappingRestrictions': smithy_client_1._json,
        'Features': smithy_client_1._json,
        'FunctionMemorySizeLimit': smithy_client_1.expectInt32,
        'GetFunctionAPIThrottleLimit': smithy_client_1.expectInt32,
        'GetPolicyAPIThrottleLimit': smithy_client_1.expectInt32,
        'InvokeAsyncThrottleLimit': smithy_client_1.expectInt32,
        'LargeCloudFunctionConcurrencyLimit': smithy_client_1.expectInt32,
        'MaxQueueDepth': smithy_client_1.expectInt32,
        'MigrationStatus': smithy_client_1.expectString,
        'PreviewFeatures': smithy_client_1._json,
        'ProvisionedConcurrencyPreWarmingRate': smithy_client_1.expectInt32,
        'RequestSignerInvokeTpsLimitOverride': smithy_client_1.expectInt32,
        'RuntimesPinnedToAL1703ByDefaultOnCreate': smithy_client_1._json,
        'RuntimesPinnedToAL1703ByDefaultOnUpdate': smithy_client_1._json,
        'ShardPoolParameters': smithy_client_1._json,
        'SmallCloudFunctionConcurrencyLimit': smithy_client_1.expectInt32,
        'SplitCountParameters': smithy_client_1._json,
        'SqsQueueName': smithy_client_1.expectString,
        'TotalCodeSizeLimit': smithy_client_1.expectLong,
        'UnreservedConcurrentExecutions': smithy_client_1.expectInt32,
        'UnreservedConcurrentExecutionsMinimum': smithy_client_1.expectInt32,
        'VersionString': smithy_client_1.expectString,
    });
};
const de_DurableExecutions = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_Execution(entry, context);
    });
    return retVal;
};
const de_Event = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'CallbackFailedDetails': smithy_client_1._json,
        'CallbackStartedDetails': smithy_client_1._json,
        'CallbackSucceededDetails': smithy_client_1._json,
        'CallbackTimedOutDetails': smithy_client_1._json,
        'ContextFailedDetails': smithy_client_1._json,
        'ContextStartedDetails': smithy_client_1._json,
        'ContextSucceededDetails': smithy_client_1._json,
        'EventId': smithy_client_1.expectInt32,
        'EventTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'EventType': smithy_client_1.expectString,
        'ExecutionFailedDetails': smithy_client_1._json,
        'ExecutionStartedDetails': smithy_client_1._json,
        'ExecutionStoppedDetails': smithy_client_1._json,
        'ExecutionSucceededDetails': smithy_client_1._json,
        'ExecutionTimedOutDetails': smithy_client_1._json,
        'Id': smithy_client_1.expectString,
        'InvokeFailedDetails': smithy_client_1._json,
        'InvokeStartedDetails': smithy_client_1._json,
        'InvokeStoppedDetails': smithy_client_1._json,
        'InvokeSucceededDetails': smithy_client_1._json,
        'InvokeTimedOutDetails': smithy_client_1._json,
        'Name': smithy_client_1.expectString,
        'ParentId': smithy_client_1.expectString,
        'StepFailedDetails': smithy_client_1._json,
        'StepStartedDetails': smithy_client_1._json,
        'StepSucceededDetails': smithy_client_1._json,
        'SubType': smithy_client_1.expectString,
        'WaitCancelledDetails': smithy_client_1._json,
        'WaitStartedDetails': (_) => de_WaitStartedDetails(_, context),
        'WaitSucceededDetails': smithy_client_1._json,
    });
};
const de_Events = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_Event(entry, context);
    });
    return retVal;
};
const de_EventSourceMappingConfiguration = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AmazonManagedKafkaEventSourceConfig': smithy_client_1._json,
        'BatchSize': smithy_client_1.expectInt32,
        'BisectBatchOnFunctionError': smithy_client_1.expectBoolean,
        'DestinationConfig': smithy_client_1._json,
        'DocumentDBEventSourceConfig': smithy_client_1._json,
        'EventSourceArn': smithy_client_1.expectString,
        'EventSourceMappingArn': smithy_client_1.expectString,
        'FilterCriteria': smithy_client_1._json,
        'FilterCriteriaError': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionResponseTypes': smithy_client_1._json,
        'KMSKeyArn': smithy_client_1.expectString,
        'LastModified': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'LastProcessingResult': smithy_client_1.expectString,
        'MaximumBatchingWindowInSeconds': smithy_client_1.expectInt32,
        'MaximumRecordAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
        'MetricsConfig': smithy_client_1._json,
        'ParallelizationFactor': smithy_client_1.expectInt32,
        'PartialBatchResponse': smithy_client_1.expectBoolean,
        'ProvisionedPollerConfig': smithy_client_1._json,
        'Queues': smithy_client_1._json,
        'ScalingConfig': smithy_client_1._json,
        'SelfManagedEventSource': smithy_client_1._json,
        'SelfManagedKafkaEventSourceConfig': smithy_client_1._json,
        'SourceAccessConfigurations': smithy_client_1._json,
        'StartingPosition': smithy_client_1.expectString,
        'StartingPositionTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'State': smithy_client_1.expectString,
        'StateTransitionReason': smithy_client_1.expectString,
        'Topics': smithy_client_1._json,
        'TumblingWindowInSeconds': smithy_client_1.expectInt32,
        'UUID': smithy_client_1.expectString,
    });
};
const de_EventSourceMappingsList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_EventSourceMappingConfiguration(entry, context);
    });
    return retVal;
};
const de_Execution = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'DurableExecutionArn': smithy_client_1.expectString,
        'DurableExecutionName': smithy_client_1.expectString,
        'FunctionArn': smithy_client_1.expectString,
        'StartDate': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'Status': smithy_client_1.expectString,
        'StopDate': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
    });
};
const de_FunctionEventInvokeConfig = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'DestinationConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'LastModified': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'MaximumEventAgeInSeconds': smithy_client_1.expectInt32,
        'MaximumRetryAttempts': smithy_client_1.expectInt32,
    });
};
const de_FunctionEventInvokeConfigList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_FunctionEventInvokeConfig(entry, context);
    });
    return retVal;
};
const de_LayerConfig = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'CodeSignatureExpirationTime': smithy_client_1.expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': smithy_client_1.expectString,
        'CodeSigningJobArn': smithy_client_1.expectString,
        'CodeSigningProfileArn': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'LayerArn': smithy_client_1.expectString,
        'S3CodeUri': smithy_client_1.expectString,
        'S3VersionId': smithy_client_1.expectString,
        'UncompressedCodeSize': smithy_client_1.expectLong,
    });
};
const de_LayerConfigList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_LayerConfig(entry, context);
    });
    return retVal;
};
const de_LayerVersionInternalContentOutput = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'CodeSignatureExpirationTime': smithy_client_1.expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': smithy_client_1.expectString,
        'CodeSigningJobArn': smithy_client_1.expectString,
        'CodeSigningProfileVersionArn': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'CodeUri': smithy_client_1.expectString,
        'InternalFormatLocation': smithy_client_1.expectString,
        'S3CodeVersionId': smithy_client_1.expectString,
        'UncompressedCodeSize': smithy_client_1.expectLong,
    });
};
const de_MigrationAccountRiskSettings = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AccountRiskMetadata': smithy_client_1._json,
        'RiskDetectedTime': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'RiskSource': smithy_client_1.expectString,
    });
};
const de_MigrationAlias = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
        'AliasArn': smithy_client_1.expectString,
        'AliasName': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'FunctionVersion': smithy_client_1.expectString,
        'HashOfConsistentFields': smithy_client_1.expectString,
        'ModifiedDateInEpochMillis': smithy_client_1.expectLong,
        'Policy': smithy_client_1.expectString,
        'PublicPolicyAttached': smithy_client_1.expectBoolean,
        'TargetAdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
    });
};
const de_MigrationFunctionVersion = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AccountId': smithy_client_1.expectString,
        'AllLayerConfigs': (_) => de_LayerConfigList(_, context),
        'Architectures': smithy_client_1._json,
        'Code': smithy_client_1.expectString,
        'CodeMergedWithLayersUri': smithy_client_1.expectString,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSignatureExpirationTime': smithy_client_1.expectLong,
        'CodeSigningConfigArn': smithy_client_1.expectString,
        'CodeSigningJobArn': smithy_client_1.expectString,
        'CodeSigningProfileArn': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'ConcurrencySequenceNumber': smithy_client_1.expectLong,
        'ConfigSha256': smithy_client_1.expectString,
        'CustomerSubnetsByLambdaAz': smithy_client_1._json,
        'DeadLetterArn': smithy_client_1.expectString,
        'Description': smithy_client_1.expectString,
        'DurableConfig': smithy_client_1._json,
        'EnableTracer': smithy_client_1.expectBoolean,
        'EncryptedEnvironmentVars': smithy_client_1.expectString,
        'EphemeralStorage': smithy_client_1._json,
        'ExecutionEnvironmentConcurrencyConfig': smithy_client_1._json,
        'FunctionArn': smithy_client_1.expectString,
        'FunctionId': smithy_client_1.expectString,
        'FunctionSequenceNumber': smithy_client_1.expectLong,
        'FunctionVersion': smithy_client_1.expectString,
        'GenerateDataKeyKmsGrantId': smithy_client_1.expectString,
        'GenerateDataKeyKmsGrantToken': smithy_client_1.expectString,
        'Handler': smithy_client_1.expectString,
        'HashOfConsistentFields': smithy_client_1.expectString,
        'Ipv6AllowedForDualStack': smithy_client_1.expectBoolean,
        'IsLarge': smithy_client_1.expectInt32,
        'KmsGrantId': smithy_client_1.expectString,
        'KmsGrantToken': smithy_client_1.expectString,
        'KmsKeyArn': smithy_client_1.expectString,
        'LayerConfigs': (_) => de_LayerConfigList(_, context),
        'LoggingConfig': smithy_client_1._json,
        'MemoryLimitMb': smithy_client_1.expectInt32,
        'MergedLayersUri': smithy_client_1.expectString,
        'Mode': smithy_client_1.expectString,
        'ModifiedDateAsEpochMilli': smithy_client_1.expectLong,
        'Name': smithy_client_1.expectString,
        'PackageType': smithy_client_1.expectString,
        'PendingTaskConfig': smithy_client_1.expectString,
        'Policy': smithy_client_1.expectString,
        'PollerCustomerVpcRole': smithy_client_1.expectString,
        'PreviousRuntimeArtifactArn': smithy_client_1.expectString,
        'PreviousRuntimeVersion': smithy_client_1.expectString,
        'ProgrammingModel': smithy_client_1.expectString,
        'ProvisionedConcurrencyState': smithy_client_1.expectString,
        'PublicAccessBlockConfig': smithy_client_1._json,
        'PublicPolicyAttached': smithy_client_1.expectBoolean,
        'PublishedVersion': smithy_client_1.expectLong,
        'ReservedConcurrentExecutions': smithy_client_1.expectInt32,
        'Role': smithy_client_1.expectString,
        'Runtime': smithy_client_1.expectString,
        'RuntimeArtifactArn': smithy_client_1.expectString,
        'RuntimeUpdateReason': smithy_client_1.expectString,
        'RuntimeVariant': smithy_client_1.expectString,
        'RuntimeVersion': smithy_client_1.expectString,
        'SandboxGeneration': smithy_client_1.expectLong,
        'SecurityGroupIds': smithy_client_1._json,
        'SnapStart': smithy_client_1._json,
        'SqsQueueName': smithy_client_1.expectString,
        'SquashfsRollbackVersionId': smithy_client_1.expectString,
        'State': smithy_client_1.expectString,
        'StateReasonCode': smithy_client_1.expectString,
        'Tagged': smithy_client_1.expectBoolean,
        'TagsInfo': smithy_client_1._json,
        'TargetSourceArn': smithy_client_1.expectString,
        'TenancyConfig': smithy_client_1._json,
        'Timeout': smithy_client_1.expectInt32,
        'TotalProvisionedConcurrentExecutions': smithy_client_1.expectInt32,
        'TracingMode': smithy_client_1.expectString,
        'TransactionId': smithy_client_1.expectString,
        'UncompresedCodeSize': smithy_client_1.expectLong,
        'UnderlyingPackageType': smithy_client_1.expectString,
        'VersionId': smithy_client_1.expectString,
        'VmSelectorPreference': smithy_client_1.expectString,
        'VpcDelegationRole': smithy_client_1.expectString,
        'VpcId': smithy_client_1.expectString,
        'VpcOwnerRole': smithy_client_1.expectString,
        'WebProgrammingModelConfig': smithy_client_1._json,
    });
};
const de_MigrationLayerVersion = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'AccountId': smithy_client_1.expectString,
        'CodeSha256': smithy_client_1.expectString,
        'CodeSignatureExpirationTime': smithy_client_1.expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': smithy_client_1.expectString,
        'CodeSigningJobArn': smithy_client_1.expectString,
        'CodeSigningProfileArn': smithy_client_1.expectString,
        'CodeSize': smithy_client_1.expectLong,
        'CompatibleArchitectures': smithy_client_1._json,
        'CompatibleRuntimes': smithy_client_1._json,
        'CreatedDate': smithy_client_1.expectString,
        'CurrentVersionNumber': smithy_client_1.expectLong,
        'Description': smithy_client_1.expectString,
        'HashOfConsistentFields': smithy_client_1.expectString,
        'LatestUsableCompatibleArchitectures': smithy_client_1._json,
        'LatestUsableCompatibleRuntimes': smithy_client_1._json,
        'LatestUsableVersionNumber': smithy_client_1.expectLong,
        'LayerArn': smithy_client_1.expectString,
        'LayerId': smithy_client_1.expectString,
        'LayerVersionArn': smithy_client_1.expectString,
        'LicenseInfo': smithy_client_1.expectString,
        'Policy': smithy_client_1.expectString,
        'RevisionId': smithy_client_1.expectString,
        'SquashFSSignedUrl': smithy_client_1.expectString,
        'UncompressedCodeSize': smithy_client_1.expectLong,
        'ZipFileSignedUrl': smithy_client_1.expectString,
    });
};
const de_Operation = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'CallbackDetails': smithy_client_1._json,
        'ContextDetails': smithy_client_1._json,
        'EndTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'ExecutionDetails': smithy_client_1._json,
        'Id': smithy_client_1.expectString,
        'InvokeDetails': smithy_client_1._json,
        'Name': smithy_client_1.expectString,
        'ParentId': smithy_client_1.expectString,
        'StartTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'Status': smithy_client_1.expectString,
        'StepDetails': (_) => de_StepDetails(_, context),
        'SubType': smithy_client_1.expectString,
        'Type': smithy_client_1.expectString,
        'WaitDetails': (_) => de_WaitDetails(_, context),
    });
};
const de_Operations = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_Operation(entry, context);
    });
    return retVal;
};
const de_StepDetails = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'Attempt': smithy_client_1.expectInt32,
        'Error': smithy_client_1._json,
        'NextAttemptTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
        'Result': smithy_client_1.expectString,
    });
};
const de_WaitDetails = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'ScheduledTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
    });
};
const de_WaitStartedDetails = (output, context) => {
    return (0, smithy_client_1.take)(output, {
        'Duration': smithy_client_1.expectInt32,
        'ScheduledEndTimestamp': (_) => (0, smithy_client_1.expectNonNull)((0, smithy_client_1.parseEpochTimestamp)((0, smithy_client_1.expectNumber)(_))),
    });
};
const deserializeMetadata = (output) => ({
    httpStatusCode: output.statusCode,
    requestId: output.headers["x-amzn-requestid"] ?? output.headers["x-amzn-request-id"] ?? output.headers["x-amz-request-id"],
    extendedRequestId: output.headers["x-amz-id-2"],
    cfId: output.headers["x-amz-cf-id"],
});
const collectBodyString = (streamBody, context) => (0, smithy_client_1.collectBody)(streamBody, context).then(body => context.utf8Encoder(body));
const _A = "Arn";
const _AI = "AccountId";
const _AOPU = "AllowOnlyPresignedUrl";
const _CA = "CompatibleArchitecture";
const _CC = "ClientContext";
const _CE = "ConcurrentExecutions";
const _CL = "ContentLength";
const _CR = "CompatibleRuntime";
const _CT = "CheckpointToken";
const _CTo = "ContentType";
const _D = "Description";
const _DEA = "DurableExecutionArn";
const _DEN = "DurableExecutionName";
const _DFIE = "DurableFunctionInvokeExecution";
const _DR = "DryRun";
const _ES = "EventSource";
const _ESA = "EventSourceArn";
const _EST = "EventSourceToken";
const _EV = "ExecutedVersion";
const _FE = "FunctionError";
const _FLUTS = "FallbackLayerUriToSign";
const _FN = "FunctionName";
const _FRM = "FunctionResponseMode";
const _FTIIR = "FieldsToIncludeInResponse";
const _FTQFS = "FeaturesToQueryForStatus";
const _FV = "FunctionVersion";
const _H = "Handler";
const _IBF = "IncludeBlacklistedFeatures";
const _IDFA = "IncludeDeprecatedFeaturesAccess";
const _IDRD = "IncludeDeprecatedRuntimeDetails";
const _IED = "IncludeExecutionData";
const _IL = "InternalLambda";
const _IPF = "IncludePreviewFeatures";
const _IT = "InvocationType";
const _IUCEM = "IncludeUnreservedConcurrentExecutionsMinimum";
const _L = "List";
const _LM = "LastModified";
const _LR = "LogResult";
const _LT = "LogType";
const _M = "Marker";
const _MA = "MasterArn";
const _MI = "MaxItems";
const _MR = "MasterRegion";
const _MS = "MemorySize";
const _Mo = "Mode";
const _O = "Operation";
const _OFDA = "OnFailureDestinationArn";
const _OSDA = "OnSuccessDestinationArn";
const _Q = "Qualifier";
const _R = "Resource";
const _RA = "ReconciliationAction";
const _RI = "RevisionId";
const _RO = "ReverseOrder";
const _RT = "ResourceType";
const _Ro = "Role";
const _Ru = "Runtime";
const _SA = "SourceArn";
const _SAo = "SourceAccount";
const _SF = "StatusFilter";
const _SKT = "SigningKeyType";
const _SO = "SourceOwner";
const _T = "Timeout";
const _TA = "TimeAfter";
const _TB = "TimeBefore";
const _TF = "TraceFields";
const _TI = "TenantId";
const _TK = "TagKeys";
const _cl = "content-length";
const _ct = "content-type";
const _f = "find";
const _l = "list";
const _rAS = "retryAfterSeconds";
const _ra = "retry-after";
const _tK = "tagKeys";
const _xacc = "x-amz-client-context";
const _xadea = "x-amz-durable-execution-arn";
const _xaden = "x-amz-durable-execution-name";
const _xadi = "x-amz-dex-invoke";
const _xadr = "x-amzn-dry-run";
const _xaest = "x-amz-event-source-token";
const _xaev = "x-amz-executed-version";
const _xafe = "x-amz-function-error";
const _xail = "x-amzn-internal-lambda";
const _xait = "x-amz-invocation-type";
const _xalr = "x-amz-log-result";
const _xalt = "x-amz-log-type";
const _xaoda = "x-amzn-onsuccess-dest-arn";
const _xaoda_ = "x-amzn-onfailure-dest-arn";
const _xasa = "x-amz-source-arn";
const _xasa_ = "x-amz-source-account";
const _xasf = "x-amzn-stream-function";
const _xaso = "x-amz-source-owner";
const _xati = "x-amzn-trace-id";
const _xati_ = "x-amz-tenant-id";
