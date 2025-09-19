import { LambdaClient, } from "./LambdaClient";
import { AddEventSourceCommand, } from "./commands/AddEventSourceCommand";
import { AddLayerVersionPermission20181031Command, } from "./commands/AddLayerVersionPermission20181031Command";
import { AddPermission20150331Command, } from "./commands/AddPermission20150331Command";
import { AddPermission20150331v2Command, } from "./commands/AddPermission20150331v2Command";
import { CheckpointDurableExecutionCommand, } from "./commands/CheckpointDurableExecutionCommand";
import { CreateAlias20150331Command, } from "./commands/CreateAlias20150331Command";
import { CreateCodeSigningConfigCommand, } from "./commands/CreateCodeSigningConfigCommand";
import { CreateEventSourceMapping20150331Command, } from "./commands/CreateEventSourceMapping20150331Command";
import { CreateFunction20150331Command, } from "./commands/CreateFunction20150331Command";
import { CreateFunctionUrlConfigCommand, } from "./commands/CreateFunctionUrlConfigCommand";
import { DeleteAccountSettingsInternalCommand, } from "./commands/DeleteAccountSettingsInternalCommand";
import { DeleteAlias20150331Command, } from "./commands/DeleteAlias20150331Command";
import { DeleteCodeSigningConfigCommand, } from "./commands/DeleteCodeSigningConfigCommand";
import { DeleteEventSourceMapping20150331Command, } from "./commands/DeleteEventSourceMapping20150331Command";
import { DeleteFunction20150331Command, } from "./commands/DeleteFunction20150331Command";
import { DeleteFunctionAliasResourceMappingCommand, } from "./commands/DeleteFunctionAliasResourceMappingCommand";
import { DeleteFunctionCodeSigningConfigCommand, } from "./commands/DeleteFunctionCodeSigningConfigCommand";
import { DeleteFunctionCommand, } from "./commands/DeleteFunctionCommand";
import { DeleteFunctionConcurrency20171031Command, } from "./commands/DeleteFunctionConcurrency20171031Command";
import { DeleteFunctionEventInvokeConfigCommand, } from "./commands/DeleteFunctionEventInvokeConfigCommand";
import { DeleteFunctionInternalCommand, } from "./commands/DeleteFunctionInternalCommand";
import { DeleteFunctionResourceMappingCommand, } from "./commands/DeleteFunctionResourceMappingCommand";
import { DeleteFunctionUrlConfigCommand, } from "./commands/DeleteFunctionUrlConfigCommand";
import { DeleteFunctionVersionResourceMappingCommand, } from "./commands/DeleteFunctionVersionResourceMappingCommand";
import { DeleteFunctionVersionResourcesInternalCommand, } from "./commands/DeleteFunctionVersionResourcesInternalCommand";
import { DeleteLayerVersion20181031Command, } from "./commands/DeleteLayerVersion20181031Command";
import { DeleteMigratedLayerVersionCommand, } from "./commands/DeleteMigratedLayerVersionCommand";
import { DeleteProvisionedConcurrencyConfigCommand, } from "./commands/DeleteProvisionedConcurrencyConfigCommand";
import { DeleteResourcePolicyCommand, } from "./commands/DeleteResourcePolicyCommand";
import { DisableFunctionCommand, } from "./commands/DisableFunctionCommand";
import { DisablePublicAccessBlockConfigCommand, } from "./commands/DisablePublicAccessBlockConfigCommand";
import { DisableReplication20170630Command, } from "./commands/DisableReplication20170630Command";
import { EnableReplication20170630Command, } from "./commands/EnableReplication20170630Command";
import { EnableReplication20170630v2Command, } from "./commands/EnableReplication20170630v2Command";
import { ExportAccountSettingsCommand, } from "./commands/ExportAccountSettingsCommand";
import { ExportAliasCommand, } from "./commands/ExportAliasCommand";
import { ExportFunctionUrlConfigsCommand, } from "./commands/ExportFunctionUrlConfigsCommand";
import { ExportFunctionVersionCommand, } from "./commands/ExportFunctionVersionCommand";
import { ExportLayerVersionCommand, } from "./commands/ExportLayerVersionCommand";
import { ExportProvisionedConcurrencyConfigCommand, } from "./commands/ExportProvisionedConcurrencyConfigCommand";
import { GetAccountRiskSettingsCommand, } from "./commands/GetAccountRiskSettingsCommand";
import { GetAccountSettings20150331Command, } from "./commands/GetAccountSettings20150331Command";
import { GetAccountSettings20160819Command, } from "./commands/GetAccountSettings20160819Command";
import { GetAccountSettingsInternalCommand, } from "./commands/GetAccountSettingsInternalCommand";
import { GetAlias20150331Command, } from "./commands/GetAlias20150331Command";
import { GetAliasInternalCommand, } from "./commands/GetAliasInternalCommand";
import { GetCodeSigningConfigCommand, } from "./commands/GetCodeSigningConfigCommand";
import { GetDurableExecutionCommand, } from "./commands/GetDurableExecutionCommand";
import { GetDurableExecutionHistoryCommand, } from "./commands/GetDurableExecutionHistoryCommand";
import { GetDurableExecutionStateCommand, } from "./commands/GetDurableExecutionStateCommand";
import { GetEventSourceCommand, } from "./commands/GetEventSourceCommand";
import { GetEventSourceMapping20150331Command, } from "./commands/GetEventSourceMapping20150331Command";
import { GetEventSourceMappingInternalCommand, } from "./commands/GetEventSourceMappingInternalCommand";
import { GetFunction20150331Command, } from "./commands/GetFunction20150331Command";
import { GetFunction20150331v2Command, } from "./commands/GetFunction20150331v2Command";
import { GetFunctionCodeSigningConfigCommand, } from "./commands/GetFunctionCodeSigningConfigCommand";
import { GetFunctionCommand, } from "./commands/GetFunctionCommand";
import { GetFunctionConcurrencyCommand, } from "./commands/GetFunctionConcurrencyCommand";
import { GetFunctionConfiguration20150331Command, } from "./commands/GetFunctionConfiguration20150331Command";
import { GetFunctionConfiguration20150331v2Command, } from "./commands/GetFunctionConfiguration20150331v2Command";
import { GetFunctionConfigurationCommand, } from "./commands/GetFunctionConfigurationCommand";
import { GetFunctionEventInvokeConfigCommand, } from "./commands/GetFunctionEventInvokeConfigCommand";
import { GetFunctionInternalCommand, } from "./commands/GetFunctionInternalCommand";
import { GetFunctionRecursionConfigCommand, } from "./commands/GetFunctionRecursionConfigCommand";
import { GetFunctionScalingConfigCommand, } from "./commands/GetFunctionScalingConfigCommand";
import { GetFunctionUrlConfigCommand, } from "./commands/GetFunctionUrlConfigCommand";
import { GetLatestLayerVersionInfoInternalCommand, } from "./commands/GetLatestLayerVersionInfoInternalCommand";
import { GetLayerVersion20181031Command, } from "./commands/GetLayerVersion20181031Command";
import { GetLayerVersionByArn20181031Command, } from "./commands/GetLayerVersionByArn20181031Command";
import { GetLayerVersionInternalCommand, } from "./commands/GetLayerVersionInternalCommand";
import { GetLayerVersionPolicy20181031Command, } from "./commands/GetLayerVersionPolicy20181031Command";
import { GetLayerVersionPolicyInternalCommand, } from "./commands/GetLayerVersionPolicyInternalCommand";
import { GetPolicy20150331Command, } from "./commands/GetPolicy20150331Command";
import { GetPolicy20150331v2Command, } from "./commands/GetPolicy20150331v2Command";
import { GetProvisionedConcurrencyConfigCommand, } from "./commands/GetProvisionedConcurrencyConfigCommand";
import { GetPublicAccessBlockConfigCommand, } from "./commands/GetPublicAccessBlockConfigCommand";
import { GetResourcePolicyCommand, } from "./commands/GetResourcePolicyCommand";
import { GetRuntimeManagementConfigCommand, } from "./commands/GetRuntimeManagementConfigCommand";
import { GetVersionProvisionedConcurrencyStatusCommand, } from "./commands/GetVersionProvisionedConcurrencyStatusCommand";
import { GetVersionSandboxSpecCommand, } from "./commands/GetVersionSandboxSpecCommand";
import { ImportAccountSettingsCommand, } from "./commands/ImportAccountSettingsCommand";
import { ImportAliasCommand, } from "./commands/ImportAliasCommand";
import { ImportFunctionCounterCommand, } from "./commands/ImportFunctionCounterCommand";
import { ImportFunctionUrlConfigsCommand, } from "./commands/ImportFunctionUrlConfigsCommand";
import { ImportFunctionVersionCommand, } from "./commands/ImportFunctionVersionCommand";
import { ImportLayerVersionCommand, } from "./commands/ImportLayerVersionCommand";
import { ImportProvisionedConcurrencyConfigCommand, } from "./commands/ImportProvisionedConcurrencyConfigCommand";
import { InformTagrisAfterResourceCreationCommand, } from "./commands/InformTagrisAfterResourceCreationCommand";
import { Invoke20150331Command, } from "./commands/Invoke20150331Command";
import { InvokeAsyncCommand, } from "./commands/InvokeAsyncCommand";
import { InvokeWithResponseStreamCommand, } from "./commands/InvokeWithResponseStreamCommand";
import { ListAliases20150331Command, } from "./commands/ListAliases20150331Command";
import { ListAliasesInternalCommand, } from "./commands/ListAliasesInternalCommand";
import { ListCodeSigningConfigsCommand, } from "./commands/ListCodeSigningConfigsCommand";
import { ListDurableExecutionsCommand, } from "./commands/ListDurableExecutionsCommand";
import { ListEventSourceMappings20150331Command, } from "./commands/ListEventSourceMappings20150331Command";
import { ListEventSourceMappingsInternalCommand, } from "./commands/ListEventSourceMappingsInternalCommand";
import { ListEventSourcesCommand, } from "./commands/ListEventSourcesCommand";
import { ListFunctionAliasResourceMappingsCommand, } from "./commands/ListFunctionAliasResourceMappingsCommand";
import { ListFunctionCountersInternalCommand, } from "./commands/ListFunctionCountersInternalCommand";
import { ListFunctionEventInvokeConfigsCommand, } from "./commands/ListFunctionEventInvokeConfigsCommand";
import { ListFunctionResourceMappingsCommand, } from "./commands/ListFunctionResourceMappingsCommand";
import { ListFunctionUrlConfigsCommand, } from "./commands/ListFunctionUrlConfigsCommand";
import { ListFunctionUrlsInternalCommand, } from "./commands/ListFunctionUrlsInternalCommand";
import { ListFunctionVersionResourceMappingsCommand, } from "./commands/ListFunctionVersionResourceMappingsCommand";
import { ListFunctionVersionsInternalCommand, } from "./commands/ListFunctionVersionsInternalCommand";
import { ListFunctions20150331Command, } from "./commands/ListFunctions20150331Command";
import { ListFunctionsByCodeSigningConfigCommand, } from "./commands/ListFunctionsByCodeSigningConfigCommand";
import { ListFunctionsCommand, } from "./commands/ListFunctionsCommand";
import { ListLayerVersions20181031Command, } from "./commands/ListLayerVersions20181031Command";
import { ListLayerVersionsInternalCommand, } from "./commands/ListLayerVersionsInternalCommand";
import { ListLayers20181031Command, } from "./commands/ListLayers20181031Command";
import { ListProvisionedConcurrencyConfigsByAccountIdCommand, } from "./commands/ListProvisionedConcurrencyConfigsByAccountIdCommand";
import { ListProvisionedConcurrencyConfigsCommand, } from "./commands/ListProvisionedConcurrencyConfigsCommand";
import { ListTags20170331Command, } from "./commands/ListTags20170331Command";
import { ListVersionsByFunction20150331Command, } from "./commands/ListVersionsByFunction20150331Command";
import { PublishLayerVersion20181031Command, } from "./commands/PublishLayerVersion20181031Command";
import { PublishVersion20150331Command, } from "./commands/PublishVersion20150331Command";
import { PutFunctionAliasResourceMappingCommand, } from "./commands/PutFunctionAliasResourceMappingCommand";
import { PutFunctionCodeSigningConfigCommand, } from "./commands/PutFunctionCodeSigningConfigCommand";
import { PutFunctionConcurrency20171031Command, } from "./commands/PutFunctionConcurrency20171031Command";
import { PutFunctionEventInvokeConfigCommand, } from "./commands/PutFunctionEventInvokeConfigCommand";
import { PutFunctionRecursionConfigCommand, } from "./commands/PutFunctionRecursionConfigCommand";
import { PutFunctionResourceMappingCommand, } from "./commands/PutFunctionResourceMappingCommand";
import { PutFunctionScalingConfigCommand, } from "./commands/PutFunctionScalingConfigCommand";
import { PutFunctionVersionResourceMappingCommand, } from "./commands/PutFunctionVersionResourceMappingCommand";
import { PutProvisionedConcurrencyConfigCommand, } from "./commands/PutProvisionedConcurrencyConfigCommand";
import { PutPublicAccessBlockConfigCommand, } from "./commands/PutPublicAccessBlockConfigCommand";
import { PutResourcePolicyCommand, } from "./commands/PutResourcePolicyCommand";
import { PutRuntimeManagementConfigCommand, } from "./commands/PutRuntimeManagementConfigCommand";
import { ReconcileProvisionedConcurrencyCommand, } from "./commands/ReconcileProvisionedConcurrencyCommand";
import { RedriveFunctionResourceTagsCommand, } from "./commands/RedriveFunctionResourceTagsCommand";
import { RemoveEventSourceCommand, } from "./commands/RemoveEventSourceCommand";
import { RemoveLayerVersionPermission20181031Command, } from "./commands/RemoveLayerVersionPermission20181031Command";
import { RemovePermission20150331Command, } from "./commands/RemovePermission20150331Command";
import { RemovePermission20150331v2Command, } from "./commands/RemovePermission20150331v2Command";
import { ResetFunctionFeatureInternalCommand, } from "./commands/ResetFunctionFeatureInternalCommand";
import { ResignFunctionAliasCommand, } from "./commands/ResignFunctionAliasCommand";
import { ResignFunctionVersionCommand, } from "./commands/ResignFunctionVersionCommand";
import { RollbackFunctionCommand, } from "./commands/RollbackFunctionCommand";
import { RollbackTagsOwnershipFromLambdaCommand, } from "./commands/RollbackTagsOwnershipFromLambdaCommand";
import { SafeDeleteProvisionedConcurrencyConfigCommand, } from "./commands/SafeDeleteProvisionedConcurrencyConfigCommand";
import { SendDurableExecutionCallbackFailureCommand, } from "./commands/SendDurableExecutionCallbackFailureCommand";
import { SendDurableExecutionCallbackHeartbeatCommand, } from "./commands/SendDurableExecutionCallbackHeartbeatCommand";
import { SendDurableExecutionCallbackSuccessCommand, } from "./commands/SendDurableExecutionCallbackSuccessCommand";
import { SetAccountRiskSettingsCommand, } from "./commands/SetAccountRiskSettingsCommand";
import { SetAccountSettings20170430Command, } from "./commands/SetAccountSettings20170430Command";
import { StopDurableExecutionCommand, } from "./commands/StopDurableExecutionCommand";
import { TagResource20170331Command, } from "./commands/TagResource20170331Command";
import { TagResource20170331v2Command, } from "./commands/TagResource20170331v2Command";
import { TagResourceBeforeResourceCreationCommand, } from "./commands/TagResourceBeforeResourceCreationCommand";
import { TransferTagsOwnershipToLambdaCommand, } from "./commands/TransferTagsOwnershipToLambdaCommand";
import { UntagResource20170331Command, } from "./commands/UntagResource20170331Command";
import { UntagResource20170331v2Command, } from "./commands/UntagResource20170331v2Command";
import { UpdateAccountSettingsInternalCommand, } from "./commands/UpdateAccountSettingsInternalCommand";
import { UpdateAlias20150331Command, } from "./commands/UpdateAlias20150331Command";
import { UpdateCodeSigningConfigCommand, } from "./commands/UpdateCodeSigningConfigCommand";
import { UpdateConcurrencyInProvisionedConcurrencyConfigCommand, } from "./commands/UpdateConcurrencyInProvisionedConcurrencyConfigCommand";
import { UpdateEventSourceMapping20150331Command, } from "./commands/UpdateEventSourceMapping20150331Command";
import { UpdateFunctionCode20150331Command, } from "./commands/UpdateFunctionCode20150331Command";
import { UpdateFunctionCode20150331v2Command, } from "./commands/UpdateFunctionCode20150331v2Command";
import { UpdateFunctionCodeCommand, } from "./commands/UpdateFunctionCodeCommand";
import { UpdateFunctionConfiguration20150331Command, } from "./commands/UpdateFunctionConfiguration20150331Command";
import { UpdateFunctionConfiguration20150331v2Command, } from "./commands/UpdateFunctionConfiguration20150331v2Command";
import { UpdateFunctionConfigurationCommand, } from "./commands/UpdateFunctionConfigurationCommand";
import { UpdateFunctionEventInvokeConfigCommand, } from "./commands/UpdateFunctionEventInvokeConfigCommand";
import { UpdateFunctionUrlConfigCommand, } from "./commands/UpdateFunctionUrlConfigCommand";
import { UpdateFunctionVersionResourceMappingCommand, } from "./commands/UpdateFunctionVersionResourceMappingCommand";
import { UpdateProvisionedConcurrencyConfigCommand, } from "./commands/UpdateProvisionedConcurrencyConfigCommand";
import { UpdateVersionProvisionedConcurrencyStatusCommand, } from "./commands/UpdateVersionProvisionedConcurrencyStatusCommand";
import { UploadFunctionCommand, } from "./commands/UploadFunctionCommand";
import { ValidateProvisionedConcurrencyFunctionVersionCommand, } from "./commands/ValidateProvisionedConcurrencyFunctionVersionCommand";
import { createAggregatedClient } from "@smithy/smithy-client";
const commands = {
    AddEventSourceCommand,
    AddLayerVersionPermission20181031Command,
    AddPermission20150331Command,
    AddPermission20150331v2Command,
    CheckpointDurableExecutionCommand,
    CreateAlias20150331Command,
    CreateCodeSigningConfigCommand,
    CreateEventSourceMapping20150331Command,
    CreateFunction20150331Command,
    CreateFunctionUrlConfigCommand,
    DeleteAccountSettingsInternalCommand,
    DeleteAlias20150331Command,
    DeleteCodeSigningConfigCommand,
    DeleteEventSourceMapping20150331Command,
    DeleteFunctionCommand,
    DeleteFunction20150331Command,
    DeleteFunctionAliasResourceMappingCommand,
    DeleteFunctionCodeSigningConfigCommand,
    DeleteFunctionConcurrency20171031Command,
    DeleteFunctionEventInvokeConfigCommand,
    DeleteFunctionInternalCommand,
    DeleteFunctionResourceMappingCommand,
    DeleteFunctionUrlConfigCommand,
    DeleteFunctionVersionResourceMappingCommand,
    DeleteFunctionVersionResourcesInternalCommand,
    DeleteLayerVersion20181031Command,
    DeleteMigratedLayerVersionCommand,
    DeleteProvisionedConcurrencyConfigCommand,
    DeleteResourcePolicyCommand,
    DisableFunctionCommand,
    DisablePublicAccessBlockConfigCommand,
    DisableReplication20170630Command,
    EnableReplication20170630Command,
    EnableReplication20170630v2Command,
    ExportAccountSettingsCommand,
    ExportAliasCommand,
    ExportFunctionUrlConfigsCommand,
    ExportFunctionVersionCommand,
    ExportLayerVersionCommand,
    ExportProvisionedConcurrencyConfigCommand,
    GetAccountRiskSettingsCommand,
    GetAccountSettings20150331Command,
    GetAccountSettings20160819Command,
    GetAccountSettingsInternalCommand,
    GetAlias20150331Command,
    GetAliasInternalCommand,
    GetCodeSigningConfigCommand,
    GetDurableExecutionCommand,
    GetDurableExecutionHistoryCommand,
    GetDurableExecutionStateCommand,
    GetEventSourceCommand,
    GetEventSourceMapping20150331Command,
    GetEventSourceMappingInternalCommand,
    GetFunctionCommand,
    GetFunction20150331Command,
    GetFunction20150331v2Command,
    GetFunctionCodeSigningConfigCommand,
    GetFunctionConcurrencyCommand,
    GetFunctionConfigurationCommand,
    GetFunctionConfiguration20150331Command,
    GetFunctionConfiguration20150331v2Command,
    GetFunctionEventInvokeConfigCommand,
    GetFunctionInternalCommand,
    GetFunctionRecursionConfigCommand,
    GetFunctionScalingConfigCommand,
    GetFunctionUrlConfigCommand,
    GetLatestLayerVersionInfoInternalCommand,
    GetLayerVersion20181031Command,
    GetLayerVersionByArn20181031Command,
    GetLayerVersionInternalCommand,
    GetLayerVersionPolicy20181031Command,
    GetLayerVersionPolicyInternalCommand,
    GetPolicy20150331Command,
    GetPolicy20150331v2Command,
    GetProvisionedConcurrencyConfigCommand,
    GetPublicAccessBlockConfigCommand,
    GetResourcePolicyCommand,
    GetRuntimeManagementConfigCommand,
    GetVersionProvisionedConcurrencyStatusCommand,
    GetVersionSandboxSpecCommand,
    ImportAccountSettingsCommand,
    ImportAliasCommand,
    ImportFunctionCounterCommand,
    ImportFunctionUrlConfigsCommand,
    ImportFunctionVersionCommand,
    ImportLayerVersionCommand,
    ImportProvisionedConcurrencyConfigCommand,
    InformTagrisAfterResourceCreationCommand,
    Invoke20150331Command,
    InvokeAsyncCommand,
    InvokeWithResponseStreamCommand,
    ListAliases20150331Command,
    ListAliasesInternalCommand,
    ListCodeSigningConfigsCommand,
    ListDurableExecutionsCommand,
    ListEventSourceMappings20150331Command,
    ListEventSourceMappingsInternalCommand,
    ListEventSourcesCommand,
    ListFunctionAliasResourceMappingsCommand,
    ListFunctionCountersInternalCommand,
    ListFunctionEventInvokeConfigsCommand,
    ListFunctionResourceMappingsCommand,
    ListFunctionsCommand,
    ListFunctions20150331Command,
    ListFunctionsByCodeSigningConfigCommand,
    ListFunctionUrlConfigsCommand,
    ListFunctionUrlsInternalCommand,
    ListFunctionVersionResourceMappingsCommand,
    ListFunctionVersionsInternalCommand,
    ListLayers20181031Command,
    ListLayerVersions20181031Command,
    ListLayerVersionsInternalCommand,
    ListProvisionedConcurrencyConfigsCommand,
    ListProvisionedConcurrencyConfigsByAccountIdCommand,
    ListTags20170331Command,
    ListVersionsByFunction20150331Command,
    PublishLayerVersion20181031Command,
    PublishVersion20150331Command,
    PutFunctionAliasResourceMappingCommand,
    PutFunctionCodeSigningConfigCommand,
    PutFunctionConcurrency20171031Command,
    PutFunctionEventInvokeConfigCommand,
    PutFunctionRecursionConfigCommand,
    PutFunctionResourceMappingCommand,
    PutFunctionScalingConfigCommand,
    PutFunctionVersionResourceMappingCommand,
    PutProvisionedConcurrencyConfigCommand,
    PutPublicAccessBlockConfigCommand,
    PutResourcePolicyCommand,
    PutRuntimeManagementConfigCommand,
    ReconcileProvisionedConcurrencyCommand,
    RedriveFunctionResourceTagsCommand,
    RemoveEventSourceCommand,
    RemoveLayerVersionPermission20181031Command,
    RemovePermission20150331Command,
    RemovePermission20150331v2Command,
    ResetFunctionFeatureInternalCommand,
    ResignFunctionAliasCommand,
    ResignFunctionVersionCommand,
    RollbackFunctionCommand,
    RollbackTagsOwnershipFromLambdaCommand,
    SafeDeleteProvisionedConcurrencyConfigCommand,
    SendDurableExecutionCallbackFailureCommand,
    SendDurableExecutionCallbackHeartbeatCommand,
    SendDurableExecutionCallbackSuccessCommand,
    SetAccountRiskSettingsCommand,
    SetAccountSettings20170430Command,
    StopDurableExecutionCommand,
    TagResource20170331Command,
    TagResource20170331v2Command,
    TagResourceBeforeResourceCreationCommand,
    TransferTagsOwnershipToLambdaCommand,
    UntagResource20170331Command,
    UntagResource20170331v2Command,
    UpdateAccountSettingsInternalCommand,
    UpdateAlias20150331Command,
    UpdateCodeSigningConfigCommand,
    UpdateConcurrencyInProvisionedConcurrencyConfigCommand,
    UpdateEventSourceMapping20150331Command,
    UpdateFunctionCodeCommand,
    UpdateFunctionCode20150331Command,
    UpdateFunctionCode20150331v2Command,
    UpdateFunctionConfigurationCommand,
    UpdateFunctionConfiguration20150331Command,
    UpdateFunctionConfiguration20150331v2Command,
    UpdateFunctionEventInvokeConfigCommand,
    UpdateFunctionUrlConfigCommand,
    UpdateFunctionVersionResourceMappingCommand,
    UpdateProvisionedConcurrencyConfigCommand,
    UpdateVersionProvisionedConcurrencyStatusCommand,
    UploadFunctionCommand,
    ValidateProvisionedConcurrencyFunctionVersionCommand,
};
export class Lambda extends LambdaClient {
}
createAggregatedClient(commands, Lambda);
