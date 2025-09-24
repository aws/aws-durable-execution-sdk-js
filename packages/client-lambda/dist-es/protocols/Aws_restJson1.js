import { LambdaServiceException as __BaseException } from "../models/LambdaServiceException";
import { AliasLimitExceededException, CodeSigningConfigNotFoundException, CodeStorageExceededException, CodeVerificationFailedException, InternalLambdaAccountDisabledException, InvalidCodeSignatureException, InvalidParameterValueException, PolicyLengthExceededException, PreconditionFailedException, ProvisionedConcurrencyConfigNotFoundException, PublicPolicyException, ResourceConflictException, ResourceInUseException, ResourceNotFoundException, ResourceNotReadyException, ServiceException, TooManyRequestsException, } from "../models/models_0";
import { CallbackTimeoutException, DurableExecutionAlreadyStartedException, EC2AccessDeniedException, EC2ThrottledException, EC2UnexpectedException, EFSIOException, EFSMountConnectivityException, EFSMountFailureException, EFSMountTimeoutException, ENILimitReachedException, InvalidRequestContentException, InvalidRuntimeException, InvalidSecurityGroupIDException, InvalidSubnetIDException, InvalidZipFileException, KMSAccessDeniedException, KMSDisabledException, KMSInvalidStateException, KMSNotFoundException, ModeNotSupportedException, NoPublishedVersionException, RecursiveInvocationException, RequestTooLargeException, SnapRestoreException, SnapRestoreTimeoutException, SnapStartException, SnapStartNotReadyException, SnapStartRegenerationFailureException, SnapStartTimeoutException, SubnetIPAddressLimitReachedException, UnsupportedMediaTypeException, } from "../models/models_1";
import { loadRestJsonErrorCode, parseJsonBody as parseBody, parseJsonErrorBody as parseErrorBody, } from "@aws-sdk/core";
import { requestBuilder as rb } from "@smithy/core";
import { decorateServiceException as __decorateServiceException, expectBoolean as __expectBoolean, expectInt32 as __expectInt32, expectLong as __expectLong, expectNonNull as __expectNonNull, expectNumber as __expectNumber, expectObject as __expectObject, expectString as __expectString, limitedParseDouble as __limitedParseDouble, parseEpochTimestamp as __parseEpochTimestamp, serializeDateTime as __serializeDateTime, serializeFloat as __serializeFloat, strictParseInt32 as __strictParseInt32, _json, collectBody, isSerializableHeaderValue, map, take, withBaseException, } from "@smithy/smithy-client";
export const se_AddEventSourceCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2014-11-13/event-source-mappings");
    let body;
    body = JSON.stringify(take(input, {
        'BatchSize': [],
        'EventSource': [],
        'FunctionName': [],
        'Parameters': _ => _json(_),
        'Role': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_AddLayerVersionPermission20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    const query = map({
        [_RI]: [, input[_RI]],
    });
    let body;
    body = JSON.stringify(take(input, {
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
export const se_AddPermission20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
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
export const se_AddPermission20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
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
export const se_CheckpointDurableExecutionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/checkpoint");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CheckpointToken': [],
        'ClientToken': [],
        'Updates': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_CreateAlias20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/aliases");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
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
export const se_CreateCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-22/code-signing-configs");
    let body;
    body = JSON.stringify(take(input, {
        'AllowedPublishers': _ => _json(_),
        'CodeSigningPolicies': _ => _json(_),
        'Description': [],
        'Tags': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_CreateEventSourceMapping20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/event-source-mappings");
    let body;
    body = JSON.stringify(take(input, {
        'AmazonManagedKafkaEventSourceConfig': _ => _json(_),
        'BatchSize': [],
        'BisectBatchOnFunctionError': [],
        'DestinationConfig': _ => _json(_),
        'DocumentDBEventSourceConfig': _ => _json(_),
        'Enabled': [],
        'EventSourceArn': [],
        'FilterCriteria': _ => _json(_),
        'FunctionName': [],
        'FunctionResponseTypes': _ => _json(_),
        'KMSKeyArn': [],
        'MaximumBatchingWindowInSeconds': [],
        'MaximumRecordAgeInSeconds': [],
        'MaximumRetryAttempts': [],
        'MetricsConfig': _ => _json(_),
        'ParallelizationFactor': [],
        'PartialBatchResponse': [],
        'ProvisionedPollerConfig': _ => _json(_),
        'Queues': _ => _json(_),
        'ScalingConfig': _ => _json(_),
        'SelfManagedEventSource': _ => _json(_),
        'SelfManagedKafkaEventSourceConfig': _ => _json(_),
        'SourceAccessConfigurations': _ => _json(_),
        'StartingPosition': [],
        'StartingPositionTimestamp': _ => (_.getTime() / 1_000),
        'Tags': _ => _json(_),
        'Topics': _ => _json(_),
        'TumblingWindowInSeconds': [],
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_CreateFunction20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions");
    let body;
    body = JSON.stringify(take(input, {
        'Architectures': _ => _json(_),
        'Code': _ => se_FunctionCode(_, context),
        'CodeSigningConfigArn': [],
        'DeadLetterConfig': _ => _json(_),
        'Description': [],
        'DurableConfig': _ => _json(_),
        'Environment': _ => _json(_),
        'EphemeralStorage': _ => _json(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => _json(_),
        'FileSystemConfigs': _ => _json(_),
        'FunctionName': [],
        'Handler': [],
        'ImageConfig': _ => _json(_),
        'KMSKeyArn': [],
        'Layers': _ => _json(_),
        'LoggingConfig': _ => _json(_),
        'MasterArn': [],
        'MemorySize': [],
        'PackageType': [],
        'PollerCustomerVpcRole': [],
        'ProgrammingModel': [],
        'Publish': [],
        'PublishTo': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => _json(_),
        'Tags': _ => _json(_),
        'TenancyConfig': _ => _json(_),
        'Timeout': [],
        'TracingConfig': _ => _json(_),
        'VpcConfig': _ => _json(_),
        'WebProgrammingModelConfig': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_CreateFunctionUrlConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'AuthType': [],
        'Cors': _ => _json(_),
        'InvokeMode': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteAccountSettingsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteAlias20150331Command = async (input, context) => {
    const b = rb(input, context);
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
export const se_DeleteCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteEventSourceMapping20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_DeleteFunction20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_DeleteFunctionAliasResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/aliases/{Alias}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Alias', () => input.Alias, '{Alias}', false);
    const query = map({
        [_RT]: [, __expectNonNull(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionConcurrency20171031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_DeleteFunctionResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = map({
        [_RT]: [, __expectNonNull(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionUrlConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    const query = map({
        [_RT]: [, __expectNonNull(input[_RT], `ResourceType`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteFunctionVersionResourcesInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionArn}/deleteresources");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteLayerVersion20181031Command = async (input, context) => {
    const b = rb(input, context);
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
export const se_DeleteMigratedLayerVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/layers/{LayerVersionArn}");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DeleteProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DeleteResourcePolicyCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    const query = map({
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_DisableFunctionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionArn}/disable");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DisablePublicAccessBlockConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionArn}/disable-public-access-block");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_DisableReplication20170630Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_EnableReplication20170630Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify(take(input, {
        'RevisionId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_EnableReplication20170630v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-06-30/functions/{FunctionName}/replication-policy-v2");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify(take(input, {
        'RevisionId': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ExportAccountSettingsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ExportAliasCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/aliases/{AliasArn}/export");
    b.p('AliasArn', () => input.AliasArn, '{AliasArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ExportFunctionUrlConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ExportFunctionVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/export");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ExportLayerVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/layers/{LayerVersionArn}/export");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ExportProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetAccountRiskSettingsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-04-07/account-settings/{AccountId}/risk");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetAccountSettings20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/account-settings");
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetAccountSettings20160819Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2016-08-19/account-settings");
    const query = map({
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
export const se_GetAccountSettingsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    const query = map({
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
export const se_GetAlias20150331Command = async (input, context) => {
    const b = rb(input, context);
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
export const se_GetAliasInternalCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_GetCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetDurableExecutionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetDurableExecutionHistoryCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/history");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    const query = map({
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
export const se_GetDurableExecutionStateCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/state");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    const query = map({
        [_CT]: [, __expectNonNull(input[_CT], `CheckpointToken`)],
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
export const se_GetEventSourceCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetEventSourceMapping20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetEventSourceMappingInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetFunctionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunction20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunction20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetFunctionConcurrencyCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetFunctionConfigurationCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionConfiguration20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionConfiguration20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionRecursionConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetFunctionScalingConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-11-30/functions/{FunctionName}/function-scaling-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetFunctionUrlConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetLatestLayerVersionInfoInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/layer-arn/{LayerArn}");
    b.p('LayerArn', () => input.LayerArn, '{LayerArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetLayerVersion20181031Command = async (input, context) => {
    const b = rb(input, context);
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
export const se_GetLayerVersionByArn20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers");
    const query = map({
        [_f]: [, "LayerVersion"],
        [_A]: [, __expectNonNull(input[_A], `Arn`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetLayerVersionInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/layer-version-arn/{LayerVersionArn}");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    const query = map({
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
export const se_GetLayerVersionPolicy20181031Command = async (input, context) => {
    const b = rb(input, context);
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
export const se_GetLayerVersionPolicyInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/layer-version-arn/{LayerVersionArn}/policy");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetPolicy20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetPolicy20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/policy");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetPublicAccessBlockConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2024-09-16/public-access-block/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetResourcePolicyCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetRuntimeManagementConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_GetVersionProvisionedConcurrencyStatusCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/status");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_GetVersionSandboxSpecCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/sandbox-spec");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportAccountSettingsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CodeStorageTableEntry': _ => _json(_),
        'CustomerConfig': _ => se_CustomerConfigInternal(_, context),
        'RiskSettings': _ => se_MigrationAccountRiskSettings(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportAliasCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/aliases/{AliasArn}/import");
    b.p('AliasArn', () => input.AliasArn, '{AliasArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'MigrationAlias': _ => se_MigrationAlias(_, context),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportFunctionCounterCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/counter");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CurrentVersionNumber': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportFunctionUrlConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'MigrationFunctionUrlConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportFunctionVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/import");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'MigrationFunctionVersion': _ => se_MigrationFunctionVersion(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportLayerVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/layers/{LayerVersionArn}/import");
    b.p('LayerVersionArn', () => input.LayerVersionArn, '{LayerVersionArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'LayerVersion': _ => se_MigrationLayerVersion(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ImportProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/cellmigration/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'MigrationProvisionedConcurrencyConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_InformTagrisAfterResourceCreationCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_Invoke20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = map({}, isSerializableHeaderValue, {
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
        [_xadi]: [() => isSerializableHeaderValue(input[_DFIE]), () => input[_DFIE].toString()],
    });
    b.bp("/2015-03-31/functions/{FunctionName}/invocations");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_InvokeAsyncCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = map({}, isSerializableHeaderValue, {
        'content-type': 'application/octet-stream',
        [_xail]: input[_IL],
        [_xadr]: [() => isSerializableHeaderValue(input[_DR]), () => input[_DR].toString()],
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
export const se_InvokeWithResponseStreamCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = map({}, isSerializableHeaderValue, {
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
    const query = map({
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
export const se_ListAliases20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/aliases");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_ListAliasesInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/aliases");
    const query = map({
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ListCodeSigningConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs");
    const query = map({
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
export const se_ListDurableExecutionsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-executions");
    const query = map({
        [_FN]: [, input[_FN]],
        [_FV]: [, input[_FV]],
        [_DEN]: [, input[_DEN]],
        [_SF]: [() => input.StatusFilter !== void 0, () => ((input[_SF] || []))],
        [_TA]: [() => input.TimeAfter !== void 0, () => (__serializeDateTime(input[_TA]).toString())],
        [_TB]: [() => input.TimeBefore !== void 0, () => (__serializeDateTime(input[_TB]).toString())],
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
export const se_ListEventSourceMappings20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/event-source-mappings");
    const query = map({
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
export const se_ListEventSourceMappingsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/internal/event-source-mappings");
    const query = map({
        [_M]: [, input[_M]],
        [_MI]: [() => input.MaxItems !== void 0, () => (input[_MI].toString())],
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ListEventSourcesCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings");
    const query = map({
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
export const se_ListFunctionAliasResourceMappingsCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_ListFunctionCountersInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions");
    const query = map({
        [_l]: [, "counters"],
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ListFunctionEventInvokeConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config/list");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_ListFunctionResourceMappingsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ListFunctionsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions");
    const query = map({
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
export const se_ListFunctions20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions");
    const query = map({
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
export const se_ListFunctionsByCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}/functions");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    const query = map({
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
export const se_ListFunctionUrlConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-10-31/functions/{FunctionName}/urls");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_ListFunctionUrlsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/urls");
    const query = map({
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
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
export const se_ListFunctionVersionResourceMappingsCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_ListFunctionVersionsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/functions");
    const query = map({
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
        [_M]: [, input[_M]],
    });
    let body;
    b.m("GET")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ListLayers20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers");
    const query = map({
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
export const se_ListLayerVersions20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    const query = map({
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
export const se_ListLayerVersionsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/cellmigration/layers");
    const query = map({
        [_AI]: [, __expectNonNull(input[_AI], `AccountId`)],
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
export const se_ListProvisionedConcurrencyConfigsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_ListProvisionedConcurrencyConfigsByAccountIdCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/accounts/{AccountId}/provisioned-concurrency");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    const query = map({
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
export const se_ListTags20170331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_ListVersionsByFunction20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_PublishLayerVersion20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2018-10-31/layers/{LayerName}/versions");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CompatibleArchitectures': _ => _json(_),
        'CompatibleRuntimes': _ => _json(_),
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
export const se_PublishVersion20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
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
export const se_PutFunctionAliasResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/aliases/{Alias}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Alias', () => input.Alias, '{Alias}', false);
    let body;
    body = JSON.stringify(take(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutFunctionCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-06-30/functions/{FunctionName}/code-signing-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CodeSigningConfigArn': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutFunctionConcurrency20171031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-10-31/functions/{FunctionName}/concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'ReservedConcurrentExecutions': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'DestinationConfig': _ => _json(_),
        'MaximumEventAgeInSeconds': [],
        'MaximumRetryAttempts': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_PutFunctionRecursionConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-08-31/functions/{FunctionName}/recursion-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'RecursiveLoop': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutFunctionResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutFunctionScalingConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-11-30/functions/{FunctionName}/function-scaling-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify(take(input, {
        'FunctionScalingConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_PutFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    let body;
    body = JSON.stringify(take(input, {
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, __expectNonNull(input[_Q], `Qualifier`)],
    });
    let body;
    body = JSON.stringify(take(input, {
        'ProvisionedConcurrentExecutions': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_PutPublicAccessBlockConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-09-16/public-access-block/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'PublicAccessBlockConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutResourcePolicyCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2024-09-16/resource-policy/{ResourceArn}");
    b.p('ResourceArn', () => input.ResourceArn, '{ResourceArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'BlockPublicPolicy': [],
        'Policy': [],
        'RevisionId': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_PutRuntimeManagementConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-07-20/functions/{FunctionName}/runtime-management-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'RuntimeVersionArn': [],
        'UpdateRuntimeOn': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ReconcileProvisionedConcurrencyCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/reconcile");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_RA]: [, __expectNonNull(input[_RA], `ReconciliationAction`)],
    });
    let body;
    body = JSON.stringify(take(input, {
        'ProvisionedConcurrencyConfig': _ => _json(_),
        'ProvisionedConcurrencyFunctionVersion': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_RedriveFunctionResourceTagsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/redrive-tags");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_RemoveEventSourceCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    b.m("DELETE")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_RemoveLayerVersionPermission20181031Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2018-10-31/layers/{LayerName}/versions/{VersionNumber}/policy/{StatementId}");
    b.p('LayerName', () => input.LayerName, '{LayerName}', false);
    b.p('VersionNumber', () => input.VersionNumber.toString(), '{VersionNumber}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = map({
        [_RI]: [, input[_RI]],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_RemovePermission20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/policy/{StatementId}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = map({
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
export const se_RemovePermission20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2015-03-31/functions/{FunctionName}/policy/{StatementId}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('StatementId', () => input.StatementId, '{StatementId}', false);
    const query = map({
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
export const se_ResetFunctionFeatureInternalCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_ResignFunctionAliasCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2022-03-31/aliases/{FunctionArn}/resign");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = map({
        [_SKT]: [, __expectNonNull(input[_SKT], `SigningKeyType`)],
    });
    let body;
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_ResignFunctionVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2022-03-31/functions/{FunctionArn}/resign");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    const query = map({
        [_SKT]: [, __expectNonNull(input[_SKT], `SigningKeyType`)],
    });
    let body;
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_RollbackFunctionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-07-20/functions/{FunctionName}/rollback");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'RuntimeUpdate': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_RollbackTagsOwnershipFromLambdaCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/rollback-tags-ownership-from-lambda");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_SafeDeleteProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_LM]: [, __expectNonNull(input[_LM], `LastModified`)],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_SendDurableExecutionCallbackFailureCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/fail");
    b.p('CallbackId', () => input.CallbackId, '{CallbackId}', false);
    let body;
    if (input.Error !== undefined) {
        body = _json(input.Error);
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
export const se_SendDurableExecutionCallbackHeartbeatCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2025-12-01/durable-execution-callbacks/{CallbackId}/heartbeat");
    b.p('CallbackId', () => input.CallbackId, '{CallbackId}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_SendDurableExecutionCallbackSuccessCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_SetAccountRiskSettingsCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-07/account-settings/{AccountId}/risk");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify(take(input, {
        'RiskSettings': _ => se_AccountRiskSettings(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_SetAccountSettings20170430Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-04-30/account-settings");
    let body;
    body = JSON.stringify(take(input, {
        'DeprecatedFeaturesAccess': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_StopDurableExecutionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2025-12-01/durable-executions/{DurableExecutionArn}/stop");
    b.p('DurableExecutionArn', () => input.DurableExecutionArn, '{DurableExecutionArn}', false);
    let body;
    if (input.Error !== undefined) {
        body = _json(input.Error);
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
export const se_TagResource20170331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/internal/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    if (input.Tags !== undefined) {
        body = _json(input.Tags);
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
export const se_TagResource20170331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    body = JSON.stringify(take(input, {
        'Tags': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_TagResourceBeforeResourceCreationCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/internal/tags/{Resource}/before-resource-creation");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    let body;
    body = JSON.stringify(take(input, {
        'Tags': _ => _json(_),
    }));
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_TransferTagsOwnershipToLambdaCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2021-12-31/functions/{FunctionArn}/transfer-tags-ownership-to-lambda");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    let body;
    b.m("POST")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UntagResource20170331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2017-03-31/tagging");
    const query = map({
        [_O]: [, "Untag"],
        [_R]: [, __expectNonNull(input[_R], `Resource`)],
    });
    let body;
    if (input.TagKeys !== undefined) {
        body = _json(input.TagKeys);
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
export const se_UntagResource20170331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2017-03-31/tags/{Resource}");
    b.p('Resource', () => input.Resource, '{Resource}', false);
    const query = map({
        [_tK]: [__expectNonNull(input.TagKeys, `TagKeys`) != null, () => (input[_TK] || [])],
    });
    let body;
    b.m("DELETE")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_UpdateAccountSettingsInternalCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-06-08/account-settings/{AccountId}");
    b.p('AccountId', () => input.AccountId, '{AccountId}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CustomerConfig': _ => se_CustomerConfigInternal(_, context),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateAlias20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/aliases/{Name}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    b.p('Name', () => input.Name, '{Name}', false);
    let body;
    body = JSON.stringify(take(input, {
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
export const se_UpdateCodeSigningConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-04-22/code-signing-configs/{CodeSigningConfigArn}");
    b.p('CodeSigningConfigArn', () => input.CodeSigningConfigArn, '{CodeSigningConfigArn}', false);
    let body;
    body = JSON.stringify(take(input, {
        'AllowedPublishers': _ => _json(_),
        'CodeSigningPolicies': _ => _json(_),
        'Description': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/update-concurrency");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_CE]: [__expectNonNull(input.ConcurrentExecutions, `ConcurrentExecutions`) != null, () => input[_CE].toString()],
    });
    let body;
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_UpdateEventSourceMapping20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/event-source-mappings/{UUID}");
    b.p('UUID', () => input.UUID, '{UUID}', false);
    let body;
    body = JSON.stringify(take(input, {
        'AmazonManagedKafkaEventSourceConfig': _ => _json(_),
        'BatchSize': [],
        'BisectBatchOnFunctionError': [],
        'DestinationConfig': _ => _json(_),
        'DocumentDBEventSourceConfig': _ => _json(_),
        'Enabled': [],
        'FilterCriteria': _ => _json(_),
        'FunctionName': [],
        'FunctionResponseTypes': _ => _json(_),
        'KMSKeyArn': [],
        'MaximumBatchingWindowInSeconds': [],
        'MaximumRecordAgeInSeconds': [],
        'MaximumRetryAttempts': [],
        'MetricsConfig': _ => _json(_),
        'ParallelizationFactor': [],
        'PartialBatchResponse': [],
        'ProvisionedPollerConfig': _ => _json(_),
        'ScalingConfig': _ => _json(_),
        'SelfManagedKafkaEventSourceConfig': _ => _json(_),
        'SourceAccessConfigurations': _ => _json(_),
        'TumblingWindowInSeconds': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateFunctionCodeCommand = async (input, context) => {
    const b = rb(input, context);
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
export const se_UpdateFunctionCode20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/code");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'Architectures': _ => _json(_),
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
export const se_UpdateFunctionCode20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/code");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'Architectures': _ => _json(_),
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
export const se_UpdateFunctionConfigurationCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2014-11-13/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
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
export const se_UpdateFunctionConfiguration20150331Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/versions/HEAD/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'DeadLetterConfig': _ => _json(_),
        'Description': [],
        'DurableConfig': _ => _json(_),
        'Environment': _ => _json(_),
        'EphemeralStorage': _ => _json(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => _json(_),
        'FileSystemConfigs': _ => _json(_),
        'Handler': [],
        'ImageConfig': _ => _json(_),
        'KMSKeyArn': [],
        'Layers': _ => _json(_),
        'LoggingConfig': _ => _json(_),
        'MemorySize': [],
        'PackageType': [],
        'ProgrammingModel': [],
        'RevisionId': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => _json(_),
        'Timeout': [],
        'TracingConfig': _ => _json(_),
        'VpcConfig': _ => _json(_),
        'WebProgrammingModelConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateFunctionConfiguration20150331v2Command = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2015-03-31/functions/{FunctionName}/configuration");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
        'DeadLetterConfig': _ => _json(_),
        'Description': [],
        'DurableConfig': _ => _json(_),
        'Environment': _ => _json(_),
        'EphemeralStorage': _ => _json(_),
        'ExecutionEnvironmentConcurrencyConfig': _ => _json(_),
        'FileSystemConfigs': _ => _json(_),
        'Handler': [],
        'ImageConfig': _ => _json(_),
        'KMSKeyArn': [],
        'Layers': _ => _json(_),
        'LoggingConfig': _ => _json(_),
        'MemorySize': [],
        'PackageType': [],
        'ProgrammingModel': [],
        'RevisionId': [],
        'Role': [],
        'Runtime': [],
        'SnapStart': _ => _json(_),
        'Timeout': [],
        'TracingConfig': _ => _json(_),
        'VpcConfig': _ => _json(_),
        'WebProgrammingModelConfig': _ => _json(_),
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateFunctionEventInvokeConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-25/functions/{FunctionName}/event-invoke-config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'DestinationConfig': _ => _json(_),
        'MaximumEventAgeInSeconds': [],
        'MaximumRetryAttempts': [],
    }));
    b.m("POST")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_UpdateFunctionUrlConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2021-10-31/functions/{FunctionName}/url");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Q]: [, input[_Q]],
    });
    let body;
    body = JSON.stringify(take(input, {
        'AuthType': [],
        'Cors': _ => _json(_),
        'InvokeMode': [],
    }));
    b.m("PUT")
        .h(headers)
        .q(query)
        .b(body);
    return b.build();
};
export const se_UpdateFunctionVersionResourceMappingCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2020-11-02/functions/{FunctionArn}/versions/{Version}/resource-mappings/update");
    b.p('FunctionArn', () => input.FunctionArn, '{FunctionArn}', false);
    b.p('Version', () => input.Version, '{Version}', false);
    let body;
    body = JSON.stringify(take(input, {
        'CurrentValue': [],
        'NewValue': [],
        'ResourceType': [],
    }));
    b.m("PUT")
        .h(headers)
        .b(body);
    return b.build();
};
export const se_UpdateProvisionedConcurrencyConfigCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/config");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
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
export const se_UpdateVersionProvisionedConcurrencyStatusCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/json',
    };
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/status");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    body = JSON.stringify(take(input, {
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
export const se_UploadFunctionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {
        'content-type': 'application/octet-stream',
    };
    b.bp("/2014-11-13/functions/{FunctionName}");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    const query = map({
        [_Ru]: [, __expectNonNull(input[_Ru], `Runtime`)],
        [_Ro]: [, __expectNonNull(input[_Ro], `Role`)],
        [_H]: [, __expectNonNull(input[_H], `Handler`)],
        [_Mo]: [, __expectNonNull(input[_Mo], `Mode`)],
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
export const se_ValidateProvisionedConcurrencyFunctionVersionCommand = async (input, context) => {
    const b = rb(input, context);
    const headers = {};
    b.bp("/2019-09-30/functions/{FunctionName}/provisioned-concurrency/validate-provisioned-concurrency-function-version");
    b.p('FunctionName', () => input.FunctionName, '{FunctionName}', false);
    let body;
    b.m("GET")
        .h(headers)
        .b(body);
    return b.build();
};
export const de_AddEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'BatchSize': __expectInt32,
        'EventSource': __expectString,
        'FunctionName': __expectString,
        'IsActive': __expectString,
        'LastModified': __expectString,
        'Parameters': _json,
        'Role': __expectString,
        'Status': __expectString,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_AddLayerVersionPermission20181031Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'RevisionId': __expectString,
        'Statement': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_AddPermission20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Statement': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_AddPermission20150331v2Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Statement': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CheckpointDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CheckpointToken': __expectString,
        'NewExecutionState': _ => de_CheckpointUpdatedExecutionState(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CreateAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AliasArn': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'Name': __expectString,
        'RevisionId': __expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CreateCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CreateEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CreateFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_CreateFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AuthType': __expectString,
        'Cors': _json,
        'CreationTime': __expectString,
        'FunctionArn': __expectString,
        'FunctionUrl': __expectString,
        'InvokeMode': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_DeleteAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_DeleteFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    map(contents, {
        StatusCode: [, output.statusCode]
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    map(contents, {
        StatusCode: [, output.statusCode]
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionAliasResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionConcurrency20171031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    map(contents, {
        StatusCode: [, output.statusCode]
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionId': __expectString,
        'FunctionSequenceNumber': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_DeleteFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteFunctionVersionResourcesInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'VpcConfigResponse': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_DeleteLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteMigratedLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DeleteResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DisableFunctionCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_DisablePublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Disabled': __expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_DisableReplication20170630Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_EnableReplication20170630Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Statement': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_EnableReplication20170630v2Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'RevisionId': __expectString,
        'Statement': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportAccountSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeStorageTableEntry': _json,
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
        'RiskSettings': _ => de_MigrationAccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationAlias': _ => de_MigrationAlias(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationFunctionUrlConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationFunctionVersion': _ => de_MigrationFunctionVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'LayerVersion': _ => de_MigrationLayerVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ExportProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationProvisionedConcurrencyConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAccountRiskSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AccountBlacklistedForAccountRiskMitigation': __expectBoolean,
        'RiskSettings': _ => de_AccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAccountSettings20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AliasCount': __expectLong,
        'AliasCountLimit': __expectLong,
        'CodeStorage': __expectLong,
        'CodeStorageLimit': __expectLong,
        'FunctionCount': __expectLong,
        'SupportedFeatures': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAccountSettings20160819Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AccountLimit': _json,
        'AccountUsage': _json,
        'BlacklistedFeatures': _json,
        'DeprecatedFeaturesAccess': _json,
        'HasFunctionWithDeprecatedRuntime': __expectBoolean,
        'PreviewFeatures': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AliasArn': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'Name': __expectString,
        'RevisionId': __expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetAliasInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AliasArn': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'Name': __expectString,
        'RevisionId': __expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DurableExecutionArn': __expectString,
        'DurableExecutionName': __expectString,
        'Error': _json,
        'FunctionArn': __expectString,
        'InputPayload': __expectString,
        'Result': __expectString,
        'StartDate': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'Status': __expectString,
        'StopDate': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'Version': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetDurableExecutionHistoryCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Events': _ => de_Events(_, context),
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetDurableExecutionStateCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'NextMarker': __expectString,
        'Operations': _ => de_Operations(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'BatchSize': __expectInt32,
        'EventSource': __expectString,
        'FunctionName': __expectString,
        'IsActive': __expectString,
        'LastModified': __expectString,
        'Parameters': _json,
        'Role': __expectString,
        'Status': __expectString,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetEventSourceMappingInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Code': _json,
        'Configuration': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Code': _json,
        'Concurrency': _json,
        'Configuration': _json,
        'Tags': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunction20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Code': _json,
        'Concurrency': _json,
        'Configuration': _json,
        'Tags': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfigArn': __expectString,
        'FunctionName': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionConcurrencyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'ReservedConcurrentExecutions': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionConfigurationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSize': __expectLong,
        'ConfigurationId': __expectString,
        'Description': __expectString,
        'FunctionARN': __expectString,
        'FunctionName': __expectString,
        'Handler': __expectString,
        'LastModified': __expectString,
        'MemorySize': __expectInt32,
        'Mode': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'Timeout': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionConfiguration20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionConfiguration20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DestinationConfig': _json,
        'FunctionArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'MaximumEventAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AppliedFunctionScalingConfig': _json,
        'CodeSigningConfigArn': __expectString,
        'Concurrency': _json,
        'Configuration': _json,
        'RequestedFunctionScalingConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionRecursionConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'RecursiveLoop': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionScalingConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AppliedFunctionScalingConfig': _json,
        'FunctionArn': __expectString,
        'RequestedFunctionScalingConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AuthType': __expectString,
        'Cors': _json,
        'CreationTime': __expectString,
        'FunctionArn': __expectString,
        'FunctionUrl': __expectString,
        'InvokeMode': __expectString,
        'LastModifiedTime': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLatestLayerVersionInfoInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AccountId': __expectString,
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'LayerArn': __expectString,
        'Version': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'Content': _json,
        'CreatedDate': __expectString,
        'Description': __expectString,
        'LayerArn': __expectString,
        'LayerVersionArn': __expectString,
        'LicenseInfo': __expectString,
        'Version': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLayerVersionByArn20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'Content': _json,
        'CreatedDate': __expectString,
        'Description': __expectString,
        'LayerArn': __expectString,
        'LayerVersionArn': __expectString,
        'LicenseInfo': __expectString,
        'Version': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLayerVersionInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Content': _ => de_LayerVersionInternalContentOutput(_, context),
        'LayerVersionArn': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLayerVersionPolicy20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetLayerVersionPolicyInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetPolicy20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
        'PublicAccessAllowed': __expectBoolean,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetPolicy20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
        'PublicAccessAllowed': __expectBoolean,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AllocatedProvisionedConcurrentExecutions': __expectInt32,
        'AvailableProvisionedConcurrentExecutions': __expectInt32,
        'LastModified': __expectString,
        'RequestedProvisionedConcurrentExecutions': __expectInt32,
        'Status': __expectString,
        'StatusReason': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetPublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'PublicAccessBlockConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
        'PublicAccessAllowed': __expectBoolean,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetRuntimeManagementConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionArn': __expectString,
        'RuntimeVersionArn': __expectString,
        'UpdateRuntimeOn': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetVersionProvisionedConcurrencyStatusCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AllocatedProvisionedConcurrentExecutions': __expectInt32,
        'PreWarmingStatus': __expectString,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_GetVersionSandboxSpecCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'PendingConfigSandboxSpec': context.base64Decoder,
        'SandboxSpec': context.base64Decoder,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportAccountSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeStorageTableEntry': _json,
        'CustomerConfig': _ => de_CustomerConfigInternal(_, context),
        'RiskSettings': _ => de_MigrationAccountRiskSettings(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationAlias': _ => de_MigrationAlias(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportFunctionCounterCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionCounter': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationFunctionUrlConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationFunctionVersion': _ => de_MigrationFunctionVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportLayerVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'LayerVersion': _ => de_MigrationLayerVersion(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ImportProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'MigrationProvisionedConcurrencyConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_InformTagrisAfterResourceCreationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_Invoke20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
        [_FE]: [, output.headers[_xafe]],
        [_LR]: [, output.headers[_xalr]],
        [_CTo]: [, output.headers[_ct]],
        [_FRM]: [, output.headers[_xasf]],
        [_CL]: [() => void 0 !== output.headers[_cl], () => __strictParseInt32(output.headers[_cl])],
        [_TF]: [, output.headers[_xati]],
        [_EV]: [, output.headers[_xaev]],
        [_DEA]: [, output.headers[_xadea]],
    });
    const data = await collectBody(output.body, context);
    contents.Payload = data;
    map(contents, {
        StatusCode: [, output.statusCode]
    });
    return contents;
};
export const de_InvokeAsyncCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = output.body;
    context.sdkStreamMixin(data);
    contents.Body = data;
    map(contents, {
        Status: [, output.statusCode]
    });
    return contents;
};
export const de_InvokeWithResponseStreamCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
        [_EV]: [, output.headers[_xaev]],
        [_TF]: [, output.headers[_xati]],
        [_CTo]: [, output.headers[_ct]],
    });
    const data = output.body;
    contents.EventStream = de_InvokeWithResponseStreamResponseEvent(data, context);
    map(contents, {
        StatusCode: [, output.statusCode]
    });
    return contents;
};
export const de_ListAliases20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Aliases': _ => de_AliasList20150331(_, context),
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListAliasesInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Aliases': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListCodeSigningConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfigs': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListDurableExecutionsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DurableExecutions': _ => de_DurableExecutions(_, context),
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListEventSourceMappings20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'EventSourceMappings': _ => de_EventSourceMappingsList(_, context),
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListEventSourceMappingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'EventSourceMappings': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListEventSourcesCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'EventSources': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionAliasResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'ResourceMappings': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionCountersInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionCounters': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionEventInvokeConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionEventInvokeConfigs': _ => de_FunctionEventInvokeConfigList(_, context),
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'ResourceMappings': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Functions': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctions20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Functions': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionsByCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionArns': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionUrlConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionUrlConfigs': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionUrlsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionUrls': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionVersionResourceMappingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'ResourceMappings': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListFunctionVersionsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionVersions': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListLayers20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Layers': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListLayerVersions20181031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'LayerVersions': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListLayerVersionsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'LayerVersionArns': _json,
        'NextMarker': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListProvisionedConcurrencyConfigsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'NextMarker': __expectString,
        'ProvisionedConcurrencyConfigs': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListProvisionedConcurrencyConfigsByAccountIdCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'NextMarker': __expectString,
        'ProvisionedConcurrencyConfigs': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListTags20170331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Tags': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ListVersionsByFunction20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'NextMarker': __expectString,
        'Versions': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PublishLayerVersion20181031Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'Content': _json,
        'CreatedDate': __expectString,
        'Description': __expectString,
        'LayerArn': __expectString,
        'LayerCodeSignatureCloudTrailData': _json,
        'LayerVersionArn': __expectString,
        'LicenseInfo': __expectString,
        'Version': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PublishVersion20150331Command = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionAliasResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_PutFunctionCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfigArn': __expectString,
        'FunctionName': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionConcurrency20171031Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'ReservedConcurrentExecutions': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DestinationConfig': _json,
        'FunctionArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'MaximumEventAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionRecursionConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'RecursiveLoop': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionId': __expectString,
        'FunctionSequenceNumber': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionScalingConfigCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionState': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_PutProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AllocatedProvisionedConcurrentExecutions': __expectInt32,
        'LastModified': __expectString,
        'RequestedProvisionedConcurrentExecutions': __expectInt32,
        'Status': __expectString,
        'StatusReason': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutPublicAccessBlockConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'PublicAccessBlockConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutResourcePolicyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Policy': __expectString,
        'RevisionId': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_PutRuntimeManagementConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'FunctionArn': __expectString,
        'RuntimeVersionArn': __expectString,
        'UpdateRuntimeOn': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ReconcileProvisionedConcurrencyCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_RedriveFunctionResourceTagsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Terminated': __expectBoolean,
        'ValidationToken': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_RemoveEventSourceCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_RemoveLayerVersionPermission20181031Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_RemovePermission20150331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_RemovePermission20150331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_ResetFunctionFeatureInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_ResignFunctionAliasCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Resigned': __expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ResignFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Resigned': __expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_RollbackFunctionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'RuntimeResult': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_RollbackTagsOwnershipFromLambdaCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'HasTagsOwnershipTransferOccurred': __expectBoolean,
        'ValidationToken': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_SafeDeleteProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_SendDurableExecutionCallbackFailureCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_SendDurableExecutionCallbackHeartbeatCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_SendDurableExecutionCallbackSuccessCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_SetAccountRiskSettingsCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_SetAccountSettings20170430Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AccountLimit': _json,
        'AccountUsage': _json,
        'DeprecatedFeaturesAccess': _json,
        'PreviewFeatures': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_StopDurableExecutionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'StopDate': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_TagResource20170331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Tags': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_TagResource20170331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_TagResourceBeforeResourceCreationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'TagrisExpectedVersion': __expectLong,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_TransferTagsOwnershipToLambdaCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'HasTagsOwnershipTransferOccurred': __expectBoolean,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UntagResource20170331Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_UntagResource20170331v2Command = async (output, context) => {
    if (output.statusCode !== 204 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_UpdateAccountSettingsInternalCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_UpdateAlias20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AliasArn': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'Name': __expectString,
        'RevisionId': __expectString,
        'RoutingConfig': _ => de_AliasRoutingConfiguration(_, context),
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateCodeSigningConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSigningConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateConcurrencyInProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_UpdateEventSourceMapping20150331Command = async (output, context) => {
    if (output.statusCode !== 202 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionCodeCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSize': __expectLong,
        'ConfigurationId': __expectString,
        'Description': __expectString,
        'FunctionARN': __expectString,
        'FunctionName': __expectString,
        'Handler': __expectString,
        'LastModified': __expectString,
        'MemorySize': __expectInt32,
        'Mode': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'Timeout': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionCode20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionCode20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionConfigurationCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSize': __expectLong,
        'ConfigurationId': __expectString,
        'Description': __expectString,
        'FunctionARN': __expectString,
        'FunctionName': __expectString,
        'Handler': __expectString,
        'LastModified': __expectString,
        'MemorySize': __expectInt32,
        'Mode': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'Timeout': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionConfiguration20150331Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionConfiguration20150331v2Command = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'Architectures': _json,
        'CodeSha256': __expectString,
        'CodeSize': __expectLong,
        'ConfigSha256': __expectString,
        'DeadLetterConfig': _json,
        'Description': __expectString,
        'DurableConfig': _json,
        'Environment': _json,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FileSystemConfigs': _json,
        'FunctionArn': __expectString,
        'FunctionName': __expectString,
        'FunctionVersionId': __expectString,
        'Handler': __expectString,
        'ImageConfigResponse': _json,
        'KMSKeyArn': __expectString,
        'LastModified': __expectString,
        'LastUpdateStatus': __expectString,
        'LastUpdateStatusReason': __expectString,
        'LastUpdateStatusReasonCode': __expectString,
        'Layers': _json,
        'LoggingConfig': _json,
        'MasterArn': __expectString,
        'MemorySize': __expectInt32,
        'PackageType': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'ProgrammingModel': __expectString,
        'RevisionId': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeVersionConfig': _json,
        'SigningJobArn': __expectString,
        'SigningProfileVersionArn': __expectString,
        'SnapStart': _json,
        'State': __expectString,
        'StateReason': __expectString,
        'StateReasonCode': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TracingConfig': _json,
        'Version': __expectString,
        'VpcConfig': _json,
        'WebProgrammingModelConfig': _json,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionEventInvokeConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DestinationConfig': _json,
        'FunctionArn': __expectString,
        'LastModified': _ => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'MaximumEventAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionUrlConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AuthType': __expectString,
        'Cors': _json,
        'CreationTime': __expectString,
        'FunctionArn': __expectString,
        'FunctionUrl': __expectString,
        'InvokeMode': __expectString,
        'LastModifiedTime': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateFunctionVersionResourceMappingCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    await collectBody(output.body, context);
    return contents;
};
export const de_UpdateProvisionedConcurrencyConfigCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'LastModified': __expectString,
        'Status': __expectString,
        'StatusReason': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UpdateVersionProvisionedConcurrencyStatusCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'AllocatedProvisionedConcurrentExecutions': __expectInt32,
        'RevisionId': __expectString,
        'Status': __expectString,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_UploadFunctionCommand = async (output, context) => {
    if (output.statusCode !== 201 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'CodeSize': __expectLong,
        'ConfigurationId': __expectString,
        'Description': __expectString,
        'FunctionARN': __expectString,
        'FunctionName': __expectString,
        'Handler': __expectString,
        'LastModified': __expectString,
        'MemorySize': __expectInt32,
        'Mode': __expectString,
        'Role': __expectString,
        'Runtime': __expectString,
        'Timeout': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
export const de_ValidateProvisionedConcurrencyFunctionVersionCommand = async (output, context) => {
    if (output.statusCode !== 200 && output.statusCode >= 300) {
        return de_CommandError(output, context);
    }
    const contents = map({
        $metadata: deserializeMetadata(output),
    });
    const data = __expectNonNull((__expectObject(await parseBody(output.body, context))), "body");
    const doc = take(data, {
        'DesiredProvisionedConcurrentExecutions': __expectInt32,
    });
    Object.assign(contents, doc);
    return contents;
};
const de_CommandError = async (output, context) => {
    const parsedOutput = {
        ...output,
        body: await parseErrorBody(output.body, context)
    };
    const errorCode = loadRestJsonErrorCode(output, parsedOutput.body);
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
const throwDefaultError = withBaseException(__BaseException);
const de_AliasLimitExceededExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new AliasLimitExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_CallbackTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new CallbackTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_CodeSigningConfigNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeSigningConfigNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_CodeStorageExceededExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeStorageExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_CodeVerificationFailedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new CodeVerificationFailedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_DurableExecutionAlreadyStartedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new DurableExecutionAlreadyStartedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EC2AccessDeniedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2AccessDeniedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EC2ThrottledExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2ThrottledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EC2UnexpectedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'EC2ErrorCode': __expectString,
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EC2UnexpectedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EFSIOExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSIOException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountConnectivityExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountConnectivityException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountFailureExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountFailureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_EFSMountTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new EFSMountTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ENILimitReachedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ENILimitReachedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InternalLambdaAccountDisabledExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InternalLambdaAccountDisabledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidCodeSignatureExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidCodeSignatureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidParameterValueExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidParameterValueException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidRequestContentExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidRequestContentException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidRuntimeExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidRuntimeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidSecurityGroupIDExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidSecurityGroupIDException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidSubnetIDExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidSubnetIDException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_InvalidZipFileExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new InvalidZipFileException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_KMSAccessDeniedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSAccessDeniedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_KMSDisabledExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSDisabledException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_KMSInvalidStateExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSInvalidStateException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_KMSNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new KMSNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ModeNotSupportedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ModeNotSupportedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_NoPublishedVersionExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new NoPublishedVersionException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_PolicyLengthExceededExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new PolicyLengthExceededException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_PreconditionFailedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new PreconditionFailedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ProvisionedConcurrencyConfigNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ProvisionedConcurrencyConfigNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_PublicPolicyExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new PublicPolicyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_RecursiveInvocationExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new RecursiveInvocationException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_RequestTooLargeExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new RequestTooLargeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceConflictExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceConflictException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceInUseExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceInUseException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceNotFoundExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceNotFoundException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ResourceNotReadyExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ResourceNotReadyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_ServiceExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new ServiceException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapRestoreExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapRestoreException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapRestoreTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapRestoreTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartNotReadyExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartNotReadyException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartRegenerationFailureExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartRegenerationFailureException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SnapStartTimeoutExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SnapStartTimeoutException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_SubnetIPAddressLimitReachedExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Message': __expectString,
        'Type': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new SubnetIPAddressLimitReachedException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_TooManyRequestsExceptionRes = async (parsedOutput, context) => {
    const contents = map({
        [_rAS]: [, parsedOutput.headers[_ra]],
    });
    const data = parsedOutput.body;
    const doc = take(data, {
        'Reason': __expectString,
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new TooManyRequestsException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
};
const de_UnsupportedMediaTypeExceptionRes = async (parsedOutput, context) => {
    const contents = map({});
    const data = parsedOutput.body;
    const doc = take(data, {
        'Type': __expectString,
        'message': __expectString,
    });
    Object.assign(contents, doc);
    const exception = new UnsupportedMediaTypeException({
        $metadata: deserializeMetadata(parsedOutput),
        ...contents
    });
    return __decorateServiceException(exception, parsedOutput.body);
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
    const data = await parseBody(output.body, context);
    Object.assign(contents, _json(data));
    return contents;
};
const se_AccountRiskSettings = (input, context) => {
    return take(input, {
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
        acc[key] = __serializeFloat(value);
        return acc;
    }, {});
};
const se_AliasRoutingConfiguration = (input, context) => {
    return take(input, {
        'AdditionalVersionWeights': _ => se_AdditionalVersionWeights(_, context),
    });
};
const se_CustomerConfigInternal = (input, context) => {
    return take(input, {
        'AccountId': [],
        'AccountRiskMetadata': _json,
        'AccountRiskSource': [],
        'AccountRiskStatusTimestamp': _ => (_.getTime() / 1_000),
        'AccountStatus': [],
        'AccountStatusEvent': [],
        'AccountStatusTimestampAsEpochMilli': [],
        'AliasLimit': [],
        'ArcScalingParameters': _json,
        'CellId': [],
        'ConcurrencySequenceNumber': [],
        'ControlAPIThrottleLimit': [],
        'CountingServiceBatchDivisor': [],
        'CountingServiceBatchParameters': _json,
        'DenyListFeatures': _json,
        'DeprecatedFeaturesControlAccess': _json,
        'DeprecatedFeaturesInvokeAccess': _json,
        'Enabled': [],
        'EniLimit': [],
        'EniVpcLimits': _json,
        'EventSourceMappingRestrictions': _json,
        'Features': _json,
        'FunctionMemorySizeLimit': [],
        'GetFunctionAPIThrottleLimit': [],
        'GetPolicyAPIThrottleLimit': [],
        'InvokeAsyncThrottleLimit': [],
        'LargeCloudFunctionConcurrencyLimit': [],
        'MaxQueueDepth': [],
        'MigrationStatus': [],
        'PreviewFeatures': _json,
        'ProvisionedConcurrencyPreWarmingRate': [],
        'RequestSignerInvokeTpsLimitOverride': [],
        'RuntimesPinnedToAL1703ByDefaultOnCreate': _json,
        'RuntimesPinnedToAL1703ByDefaultOnUpdate': _json,
        'ShardPoolParameters': _json,
        'SmallCloudFunctionConcurrencyLimit': [],
        'SplitCountParameters': _json,
        'SqsQueueName': [],
        'TotalCodeSizeLimit': [],
        'UnreservedConcurrentExecutions': [],
        'UnreservedConcurrentExecutionsMinimum': [],
        'VersionString': [],
    });
};
const se_FunctionCode = (input, context) => {
    return take(input, {
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
    return take(input, {
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
    return take(input, {
        'DirectUploadLayerCodeTempPath': _json,
        'S3Bucket': [],
        'S3Key': [],
        'S3ObjectVersion': [],
        'ZipFile': context.base64Encoder,
    });
};
const se_MigrationAccountRiskSettings = (input, context) => {
    return take(input, {
        'AccountRiskMetadata': _json,
        'RiskDetectedTime': _ => (_.getTime() / 1_000),
        'RiskSource': [],
    });
};
const se_MigrationAlias = (input, context) => {
    return take(input, {
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
    return take(input, {
        'AccountId': [],
        'AllLayerConfigs': _ => se_LayerConfigList(_, context),
        'Architectures': _json,
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
        'CustomerSubnetsByLambdaAz': _json,
        'DeadLetterArn': [],
        'Description': [],
        'DurableConfig': _json,
        'EnableTracer': [],
        'EncryptedEnvironmentVars': [],
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
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
        'LoggingConfig': _json,
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
        'PublicAccessBlockConfig': _json,
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
        'SecurityGroupIds': _json,
        'SnapStart': _json,
        'SqsQueueName': [],
        'SquashfsRollbackVersionId': [],
        'State': [],
        'StateReasonCode': [],
        'Tagged': [],
        'TagsInfo': _json,
        'TargetSourceArn': [],
        'TenancyConfig': _json,
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
        'WebProgrammingModelConfig': _json,
    });
};
const se_MigrationLayerVersion = (input, context) => {
    return take(input, {
        'AccountId': [],
        'CodeSha256': [],
        'CodeSignatureExpirationTime': [],
        'CodeSignatureRevocationData': context.base64Encoder,
        'CodeSignatureStatus': [],
        'CodeSigningJobArn': [],
        'CodeSigningProfileArn': [],
        'CodeSize': [],
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'CreatedDate': [],
        'CurrentVersionNumber': [],
        'Description': [],
        'HashOfConsistentFields': [],
        'LatestUsableCompatibleArchitectures': _json,
        'LatestUsableCompatibleRuntimes': _json,
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
    return take(output, {
        'ContainmentScore': __expectInt32,
        'RiskDetectedTime': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'RiskSource': __expectString,
        'RiskStatus': __expectInt32,
    });
};
const de_AdditionalVersionWeights = (output, context) => {
    return Object.entries(output).reduce((acc, [key, value]) => {
        if (value === null) {
            return acc;
        }
        acc[key] = __limitedParseDouble(value);
        return acc;
    }, {});
};
const de_AliasConfiguration20150331 = (output, context) => {
    return take(output, {
        'AliasArn': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'Name': __expectString,
        'RevisionId': __expectString,
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
    return take(output, {
        'AdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
    });
};
const de_CheckpointUpdatedExecutionState = (output, context) => {
    return take(output, {
        'NextMarker': __expectString,
        'Operations': (_) => de_Operations(_, context),
    });
};
const de_CustomerConfigInternal = (output, context) => {
    return take(output, {
        'AccountId': __expectString,
        'AccountRiskMetadata': _json,
        'AccountRiskSource': __expectString,
        'AccountRiskStatusTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'AccountStatus': __expectString,
        'AccountStatusEvent': __expectString,
        'AccountStatusTimestampAsEpochMilli': __expectLong,
        'AliasLimit': __expectLong,
        'ArcScalingParameters': _json,
        'CellId': __expectString,
        'ConcurrencySequenceNumber': __expectLong,
        'ControlAPIThrottleLimit': __expectInt32,
        'CountingServiceBatchDivisor': __expectInt32,
        'CountingServiceBatchParameters': _json,
        'DenyListFeatures': _json,
        'DeprecatedFeaturesControlAccess': _json,
        'DeprecatedFeaturesInvokeAccess': _json,
        'Enabled': __expectBoolean,
        'EniLimit': __expectInt32,
        'EniVpcLimits': _json,
        'EventSourceMappingRestrictions': _json,
        'Features': _json,
        'FunctionMemorySizeLimit': __expectInt32,
        'GetFunctionAPIThrottleLimit': __expectInt32,
        'GetPolicyAPIThrottleLimit': __expectInt32,
        'InvokeAsyncThrottleLimit': __expectInt32,
        'LargeCloudFunctionConcurrencyLimit': __expectInt32,
        'MaxQueueDepth': __expectInt32,
        'MigrationStatus': __expectString,
        'PreviewFeatures': _json,
        'ProvisionedConcurrencyPreWarmingRate': __expectInt32,
        'RequestSignerInvokeTpsLimitOverride': __expectInt32,
        'RuntimesPinnedToAL1703ByDefaultOnCreate': _json,
        'RuntimesPinnedToAL1703ByDefaultOnUpdate': _json,
        'ShardPoolParameters': _json,
        'SmallCloudFunctionConcurrencyLimit': __expectInt32,
        'SplitCountParameters': _json,
        'SqsQueueName': __expectString,
        'TotalCodeSizeLimit': __expectLong,
        'UnreservedConcurrentExecutions': __expectInt32,
        'UnreservedConcurrentExecutionsMinimum': __expectInt32,
        'VersionString': __expectString,
    });
};
const de_DurableExecutions = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_Execution(entry, context);
    });
    return retVal;
};
const de_Event = (output, context) => {
    return take(output, {
        'CallbackFailedDetails': _json,
        'CallbackStartedDetails': _json,
        'CallbackSucceededDetails': _json,
        'CallbackTimedOutDetails': _json,
        'ContextFailedDetails': _json,
        'ContextStartedDetails': _json,
        'ContextSucceededDetails': _json,
        'EventId': __expectInt32,
        'EventTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'EventType': __expectString,
        'ExecutionFailedDetails': _json,
        'ExecutionStartedDetails': _json,
        'ExecutionStoppedDetails': _json,
        'ExecutionSucceededDetails': _json,
        'ExecutionTimedOutDetails': _json,
        'Id': __expectString,
        'InvokeFailedDetails': _json,
        'InvokeStartedDetails': _json,
        'InvokeStoppedDetails': _json,
        'InvokeSucceededDetails': _json,
        'InvokeTimedOutDetails': _json,
        'Name': __expectString,
        'ParentId': __expectString,
        'StepFailedDetails': _json,
        'StepStartedDetails': _json,
        'StepSucceededDetails': _json,
        'SubType': __expectString,
        'WaitCancelledDetails': _json,
        'WaitStartedDetails': (_) => de_WaitStartedDetails(_, context),
        'WaitSucceededDetails': _json,
    });
};
const de_Events = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_Event(entry, context);
    });
    return retVal;
};
const de_EventSourceMappingConfiguration = (output, context) => {
    return take(output, {
        'AmazonManagedKafkaEventSourceConfig': _json,
        'BatchSize': __expectInt32,
        'BisectBatchOnFunctionError': __expectBoolean,
        'DestinationConfig': _json,
        'DocumentDBEventSourceConfig': _json,
        'EventSourceArn': __expectString,
        'EventSourceMappingArn': __expectString,
        'FilterCriteria': _json,
        'FilterCriteriaError': _json,
        'FunctionArn': __expectString,
        'FunctionResponseTypes': _json,
        'KMSKeyArn': __expectString,
        'LastModified': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'LastProcessingResult': __expectString,
        'MaximumBatchingWindowInSeconds': __expectInt32,
        'MaximumRecordAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
        'MetricsConfig': _json,
        'ParallelizationFactor': __expectInt32,
        'PartialBatchResponse': __expectBoolean,
        'ProvisionedPollerConfig': _json,
        'Queues': _json,
        'ScalingConfig': _json,
        'SelfManagedEventSource': _json,
        'SelfManagedKafkaEventSourceConfig': _json,
        'SourceAccessConfigurations': _json,
        'StartingPosition': __expectString,
        'StartingPositionTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'State': __expectString,
        'StateTransitionReason': __expectString,
        'Topics': _json,
        'TumblingWindowInSeconds': __expectInt32,
        'UUID': __expectString,
    });
};
const de_EventSourceMappingsList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_EventSourceMappingConfiguration(entry, context);
    });
    return retVal;
};
const de_Execution = (output, context) => {
    return take(output, {
        'DurableExecutionArn': __expectString,
        'DurableExecutionName': __expectString,
        'FunctionArn': __expectString,
        'StartDate': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'Status': __expectString,
        'StopDate': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    });
};
const de_FunctionEventInvokeConfig = (output, context) => {
    return take(output, {
        'DestinationConfig': _json,
        'FunctionArn': __expectString,
        'LastModified': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'MaximumEventAgeInSeconds': __expectInt32,
        'MaximumRetryAttempts': __expectInt32,
    });
};
const de_FunctionEventInvokeConfigList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_FunctionEventInvokeConfig(entry, context);
    });
    return retVal;
};
const de_LayerConfig = (output, context) => {
    return take(output, {
        'CodeSignatureExpirationTime': __expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': __expectString,
        'CodeSigningJobArn': __expectString,
        'CodeSigningProfileArn': __expectString,
        'CodeSize': __expectLong,
        'LayerArn': __expectString,
        'S3CodeUri': __expectString,
        'S3VersionId': __expectString,
        'UncompressedCodeSize': __expectLong,
    });
};
const de_LayerConfigList = (output, context) => {
    const retVal = (output || []).filter((e) => e != null).map((entry) => {
        return de_LayerConfig(entry, context);
    });
    return retVal;
};
const de_LayerVersionInternalContentOutput = (output, context) => {
    return take(output, {
        'CodeSignatureExpirationTime': __expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': __expectString,
        'CodeSigningJobArn': __expectString,
        'CodeSigningProfileVersionArn': __expectString,
        'CodeSize': __expectLong,
        'CodeUri': __expectString,
        'InternalFormatLocation': __expectString,
        'S3CodeVersionId': __expectString,
        'UncompressedCodeSize': __expectLong,
    });
};
const de_MigrationAccountRiskSettings = (output, context) => {
    return take(output, {
        'AccountRiskMetadata': _json,
        'RiskDetectedTime': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'RiskSource': __expectString,
    });
};
const de_MigrationAlias = (output, context) => {
    return take(output, {
        'AdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
        'AliasArn': __expectString,
        'AliasName': __expectString,
        'Description': __expectString,
        'FunctionVersion': __expectString,
        'HashOfConsistentFields': __expectString,
        'ModifiedDateInEpochMillis': __expectLong,
        'Policy': __expectString,
        'PublicPolicyAttached': __expectBoolean,
        'TargetAdditionalVersionWeights': (_) => de_AdditionalVersionWeights(_, context),
    });
};
const de_MigrationFunctionVersion = (output, context) => {
    return take(output, {
        'AccountId': __expectString,
        'AllLayerConfigs': (_) => de_LayerConfigList(_, context),
        'Architectures': _json,
        'Code': __expectString,
        'CodeMergedWithLayersUri': __expectString,
        'CodeSha256': __expectString,
        'CodeSignatureExpirationTime': __expectLong,
        'CodeSigningConfigArn': __expectString,
        'CodeSigningJobArn': __expectString,
        'CodeSigningProfileArn': __expectString,
        'CodeSize': __expectLong,
        'ConcurrencySequenceNumber': __expectLong,
        'ConfigSha256': __expectString,
        'CustomerSubnetsByLambdaAz': _json,
        'DeadLetterArn': __expectString,
        'Description': __expectString,
        'DurableConfig': _json,
        'EnableTracer': __expectBoolean,
        'EncryptedEnvironmentVars': __expectString,
        'EphemeralStorage': _json,
        'ExecutionEnvironmentConcurrencyConfig': _json,
        'FunctionArn': __expectString,
        'FunctionId': __expectString,
        'FunctionSequenceNumber': __expectLong,
        'FunctionVersion': __expectString,
        'GenerateDataKeyKmsGrantId': __expectString,
        'GenerateDataKeyKmsGrantToken': __expectString,
        'Handler': __expectString,
        'HashOfConsistentFields': __expectString,
        'Ipv6AllowedForDualStack': __expectBoolean,
        'IsLarge': __expectInt32,
        'KmsGrantId': __expectString,
        'KmsGrantToken': __expectString,
        'KmsKeyArn': __expectString,
        'LayerConfigs': (_) => de_LayerConfigList(_, context),
        'LoggingConfig': _json,
        'MemoryLimitMb': __expectInt32,
        'MergedLayersUri': __expectString,
        'Mode': __expectString,
        'ModifiedDateAsEpochMilli': __expectLong,
        'Name': __expectString,
        'PackageType': __expectString,
        'PendingTaskConfig': __expectString,
        'Policy': __expectString,
        'PollerCustomerVpcRole': __expectString,
        'PreviousRuntimeArtifactArn': __expectString,
        'PreviousRuntimeVersion': __expectString,
        'ProgrammingModel': __expectString,
        'ProvisionedConcurrencyState': __expectString,
        'PublicAccessBlockConfig': _json,
        'PublicPolicyAttached': __expectBoolean,
        'PublishedVersion': __expectLong,
        'ReservedConcurrentExecutions': __expectInt32,
        'Role': __expectString,
        'Runtime': __expectString,
        'RuntimeArtifactArn': __expectString,
        'RuntimeUpdateReason': __expectString,
        'RuntimeVariant': __expectString,
        'RuntimeVersion': __expectString,
        'SandboxGeneration': __expectLong,
        'SecurityGroupIds': _json,
        'SnapStart': _json,
        'SqsQueueName': __expectString,
        'SquashfsRollbackVersionId': __expectString,
        'State': __expectString,
        'StateReasonCode': __expectString,
        'Tagged': __expectBoolean,
        'TagsInfo': _json,
        'TargetSourceArn': __expectString,
        'TenancyConfig': _json,
        'Timeout': __expectInt32,
        'TotalProvisionedConcurrentExecutions': __expectInt32,
        'TracingMode': __expectString,
        'TransactionId': __expectString,
        'UncompresedCodeSize': __expectLong,
        'UnderlyingPackageType': __expectString,
        'VersionId': __expectString,
        'VmSelectorPreference': __expectString,
        'VpcDelegationRole': __expectString,
        'VpcId': __expectString,
        'VpcOwnerRole': __expectString,
        'WebProgrammingModelConfig': _json,
    });
};
const de_MigrationLayerVersion = (output, context) => {
    return take(output, {
        'AccountId': __expectString,
        'CodeSha256': __expectString,
        'CodeSignatureExpirationTime': __expectLong,
        'CodeSignatureRevocationData': context.base64Decoder,
        'CodeSignatureStatus': __expectString,
        'CodeSigningJobArn': __expectString,
        'CodeSigningProfileArn': __expectString,
        'CodeSize': __expectLong,
        'CompatibleArchitectures': _json,
        'CompatibleRuntimes': _json,
        'CreatedDate': __expectString,
        'CurrentVersionNumber': __expectLong,
        'Description': __expectString,
        'HashOfConsistentFields': __expectString,
        'LatestUsableCompatibleArchitectures': _json,
        'LatestUsableCompatibleRuntimes': _json,
        'LatestUsableVersionNumber': __expectLong,
        'LayerArn': __expectString,
        'LayerId': __expectString,
        'LayerVersionArn': __expectString,
        'LicenseInfo': __expectString,
        'Policy': __expectString,
        'RevisionId': __expectString,
        'SquashFSSignedUrl': __expectString,
        'UncompressedCodeSize': __expectLong,
        'ZipFileSignedUrl': __expectString,
    });
};
const de_Operation = (output, context) => {
    return take(output, {
        'CallbackDetails': _json,
        'ContextDetails': _json,
        'EndTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'ExecutionDetails': _json,
        'Id': __expectString,
        'InvokeDetails': _json,
        'Name': __expectString,
        'ParentId': __expectString,
        'StartTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'Status': __expectString,
        'StepDetails': (_) => de_StepDetails(_, context),
        'SubType': __expectString,
        'Type': __expectString,
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
    return take(output, {
        'Attempt': __expectInt32,
        'Error': _json,
        'NextAttemptTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
        'Result': __expectString,
    });
};
const de_WaitDetails = (output, context) => {
    return take(output, {
        'ScheduledTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    });
};
const de_WaitStartedDetails = (output, context) => {
    return take(output, {
        'Duration': __expectInt32,
        'ScheduledEndTimestamp': (_) => __expectNonNull(__parseEpochTimestamp(__expectNumber(_))),
    });
};
const deserializeMetadata = (output) => ({
    httpStatusCode: output.statusCode,
    requestId: output.headers["x-amzn-requestid"] ?? output.headers["x-amzn-request-id"] ?? output.headers["x-amz-request-id"],
    extendedRequestId: output.headers["x-amz-id-2"],
    cfId: output.headers["x-amz-cf-id"],
});
const collectBodyString = (streamBody, context) => collectBody(streamBody, context).then(body => context.utf8Encoder(body));
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
