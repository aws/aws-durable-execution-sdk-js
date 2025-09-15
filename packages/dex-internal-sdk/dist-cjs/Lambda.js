"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lambda = void 0;
const LambdaClient_1 = require("./LambdaClient");
const AddEventSourceCommand_1 = require("./commands/AddEventSourceCommand");
const AddLayerVersionPermission20181031Command_1 = require("./commands/AddLayerVersionPermission20181031Command");
const AddPermission20150331Command_1 = require("./commands/AddPermission20150331Command");
const AddPermission20150331v2Command_1 = require("./commands/AddPermission20150331v2Command");
const CheckpointDurableExecutionCommand_1 = require("./commands/CheckpointDurableExecutionCommand");
const CreateAlias20150331Command_1 = require("./commands/CreateAlias20150331Command");
const CreateCodeSigningConfigCommand_1 = require("./commands/CreateCodeSigningConfigCommand");
const CreateEventSourceMapping20150331Command_1 = require("./commands/CreateEventSourceMapping20150331Command");
const CreateFunction20150331Command_1 = require("./commands/CreateFunction20150331Command");
const CreateFunctionUrlConfigCommand_1 = require("./commands/CreateFunctionUrlConfigCommand");
const DeleteAccountSettingsInternalCommand_1 = require("./commands/DeleteAccountSettingsInternalCommand");
const DeleteAlias20150331Command_1 = require("./commands/DeleteAlias20150331Command");
const DeleteCodeSigningConfigCommand_1 = require("./commands/DeleteCodeSigningConfigCommand");
const DeleteEventSourceMapping20150331Command_1 = require("./commands/DeleteEventSourceMapping20150331Command");
const DeleteFunction20150331Command_1 = require("./commands/DeleteFunction20150331Command");
const DeleteFunctionAliasResourceMappingCommand_1 = require("./commands/DeleteFunctionAliasResourceMappingCommand");
const DeleteFunctionCodeSigningConfigCommand_1 = require("./commands/DeleteFunctionCodeSigningConfigCommand");
const DeleteFunctionCommand_1 = require("./commands/DeleteFunctionCommand");
const DeleteFunctionConcurrency20171031Command_1 = require("./commands/DeleteFunctionConcurrency20171031Command");
const DeleteFunctionEventInvokeConfigCommand_1 = require("./commands/DeleteFunctionEventInvokeConfigCommand");
const DeleteFunctionInternalCommand_1 = require("./commands/DeleteFunctionInternalCommand");
const DeleteFunctionResourceMappingCommand_1 = require("./commands/DeleteFunctionResourceMappingCommand");
const DeleteFunctionUrlConfigCommand_1 = require("./commands/DeleteFunctionUrlConfigCommand");
const DeleteFunctionVersionResourceMappingCommand_1 = require("./commands/DeleteFunctionVersionResourceMappingCommand");
const DeleteFunctionVersionResourcesInternalCommand_1 = require("./commands/DeleteFunctionVersionResourcesInternalCommand");
const DeleteLayerVersion20181031Command_1 = require("./commands/DeleteLayerVersion20181031Command");
const DeleteMigratedLayerVersionCommand_1 = require("./commands/DeleteMigratedLayerVersionCommand");
const DeleteProvisionedConcurrencyConfigCommand_1 = require("./commands/DeleteProvisionedConcurrencyConfigCommand");
const DeleteProvisionedConcurrencyConfigInternalCommand_1 = require("./commands/DeleteProvisionedConcurrencyConfigInternalCommand");
const DeleteResourcePolicyCommand_1 = require("./commands/DeleteResourcePolicyCommand");
const DisableFunctionCommand_1 = require("./commands/DisableFunctionCommand");
const DisablePublicAccessBlockConfigCommand_1 = require("./commands/DisablePublicAccessBlockConfigCommand");
const DisableReplication20170630Command_1 = require("./commands/DisableReplication20170630Command");
const EnableReplication20170630Command_1 = require("./commands/EnableReplication20170630Command");
const EnableReplication20170630v2Command_1 = require("./commands/EnableReplication20170630v2Command");
const ExportAccountSettingsCommand_1 = require("./commands/ExportAccountSettingsCommand");
const ExportAliasCommand_1 = require("./commands/ExportAliasCommand");
const ExportFunctionUrlConfigsCommand_1 = require("./commands/ExportFunctionUrlConfigsCommand");
const ExportFunctionVersionCommand_1 = require("./commands/ExportFunctionVersionCommand");
const ExportLayerVersionCommand_1 = require("./commands/ExportLayerVersionCommand");
const ExportProvisionedConcurrencyConfigCommand_1 = require("./commands/ExportProvisionedConcurrencyConfigCommand");
const GetAccountRiskSettingsCommand_1 = require("./commands/GetAccountRiskSettingsCommand");
const GetAccountSettings20150331Command_1 = require("./commands/GetAccountSettings20150331Command");
const GetAccountSettings20160819Command_1 = require("./commands/GetAccountSettings20160819Command");
const GetAccountSettingsInternalCommand_1 = require("./commands/GetAccountSettingsInternalCommand");
const GetAlias20150331Command_1 = require("./commands/GetAlias20150331Command");
const GetAliasInternalCommand_1 = require("./commands/GetAliasInternalCommand");
const GetCodeSigningConfigCommand_1 = require("./commands/GetCodeSigningConfigCommand");
const GetDurableExecutionCommand_1 = require("./commands/GetDurableExecutionCommand");
const GetDurableExecutionHistoryCommand_1 = require("./commands/GetDurableExecutionHistoryCommand");
const GetDurableExecutionStateCommand_1 = require("./commands/GetDurableExecutionStateCommand");
const GetEventSourceCommand_1 = require("./commands/GetEventSourceCommand");
const GetEventSourceMapping20150331Command_1 = require("./commands/GetEventSourceMapping20150331Command");
const GetEventSourceMappingInternalCommand_1 = require("./commands/GetEventSourceMappingInternalCommand");
const GetFunction20150331Command_1 = require("./commands/GetFunction20150331Command");
const GetFunction20150331v2Command_1 = require("./commands/GetFunction20150331v2Command");
const GetFunctionCodeSigningConfigCommand_1 = require("./commands/GetFunctionCodeSigningConfigCommand");
const GetFunctionCommand_1 = require("./commands/GetFunctionCommand");
const GetFunctionConcurrencyCommand_1 = require("./commands/GetFunctionConcurrencyCommand");
const GetFunctionConfiguration20150331Command_1 = require("./commands/GetFunctionConfiguration20150331Command");
const GetFunctionConfiguration20150331v2Command_1 = require("./commands/GetFunctionConfiguration20150331v2Command");
const GetFunctionConfigurationCommand_1 = require("./commands/GetFunctionConfigurationCommand");
const GetFunctionEventInvokeConfigCommand_1 = require("./commands/GetFunctionEventInvokeConfigCommand");
const GetFunctionInternalCommand_1 = require("./commands/GetFunctionInternalCommand");
const GetFunctionRecursionConfigCommand_1 = require("./commands/GetFunctionRecursionConfigCommand");
const GetFunctionScalingConfigCommand_1 = require("./commands/GetFunctionScalingConfigCommand");
const GetFunctionUrlConfigCommand_1 = require("./commands/GetFunctionUrlConfigCommand");
const GetLatestLayerVersionInfoInternalCommand_1 = require("./commands/GetLatestLayerVersionInfoInternalCommand");
const GetLayerVersion20181031Command_1 = require("./commands/GetLayerVersion20181031Command");
const GetLayerVersionByArn20181031Command_1 = require("./commands/GetLayerVersionByArn20181031Command");
const GetLayerVersionInternalCommand_1 = require("./commands/GetLayerVersionInternalCommand");
const GetLayerVersionPolicy20181031Command_1 = require("./commands/GetLayerVersionPolicy20181031Command");
const GetLayerVersionPolicyInternalCommand_1 = require("./commands/GetLayerVersionPolicyInternalCommand");
const GetPolicy20150331Command_1 = require("./commands/GetPolicy20150331Command");
const GetPolicy20150331v2Command_1 = require("./commands/GetPolicy20150331v2Command");
const GetProvisionedConcurrencyConfigCommand_1 = require("./commands/GetProvisionedConcurrencyConfigCommand");
const GetPublicAccessBlockConfigCommand_1 = require("./commands/GetPublicAccessBlockConfigCommand");
const GetResourcePolicyCommand_1 = require("./commands/GetResourcePolicyCommand");
const GetRuntimeManagementConfigCommand_1 = require("./commands/GetRuntimeManagementConfigCommand");
const GetVersionProvisionedConcurrencyStatusCommand_1 = require("./commands/GetVersionProvisionedConcurrencyStatusCommand");
const GetVersionSandboxSpecCommand_1 = require("./commands/GetVersionSandboxSpecCommand");
const ImportAccountSettingsCommand_1 = require("./commands/ImportAccountSettingsCommand");
const ImportAliasCommand_1 = require("./commands/ImportAliasCommand");
const ImportFunctionCounterCommand_1 = require("./commands/ImportFunctionCounterCommand");
const ImportFunctionUrlConfigsCommand_1 = require("./commands/ImportFunctionUrlConfigsCommand");
const ImportFunctionVersionCommand_1 = require("./commands/ImportFunctionVersionCommand");
const ImportLayerVersionCommand_1 = require("./commands/ImportLayerVersionCommand");
const ImportProvisionedConcurrencyConfigCommand_1 = require("./commands/ImportProvisionedConcurrencyConfigCommand");
const InformTagrisAfterResourceCreationCommand_1 = require("./commands/InformTagrisAfterResourceCreationCommand");
const Invoke20150331Command_1 = require("./commands/Invoke20150331Command");
const InvokeAsyncCommand_1 = require("./commands/InvokeAsyncCommand");
const InvokeWithResponseStreamCommand_1 = require("./commands/InvokeWithResponseStreamCommand");
const ListAliases20150331Command_1 = require("./commands/ListAliases20150331Command");
const ListAliasesInternalCommand_1 = require("./commands/ListAliasesInternalCommand");
const ListCodeSigningConfigsCommand_1 = require("./commands/ListCodeSigningConfigsCommand");
const ListDurableExecutionsCommand_1 = require("./commands/ListDurableExecutionsCommand");
const ListEventSourceMappings20150331Command_1 = require("./commands/ListEventSourceMappings20150331Command");
const ListEventSourceMappingsInternalCommand_1 = require("./commands/ListEventSourceMappingsInternalCommand");
const ListEventSourcesCommand_1 = require("./commands/ListEventSourcesCommand");
const ListFunctionAliasResourceMappingsCommand_1 = require("./commands/ListFunctionAliasResourceMappingsCommand");
const ListFunctionCountersInternalCommand_1 = require("./commands/ListFunctionCountersInternalCommand");
const ListFunctionEventInvokeConfigsCommand_1 = require("./commands/ListFunctionEventInvokeConfigsCommand");
const ListFunctionResourceMappingsCommand_1 = require("./commands/ListFunctionResourceMappingsCommand");
const ListFunctionUrlConfigsCommand_1 = require("./commands/ListFunctionUrlConfigsCommand");
const ListFunctionUrlsInternalCommand_1 = require("./commands/ListFunctionUrlsInternalCommand");
const ListFunctionVersionResourceMappingsCommand_1 = require("./commands/ListFunctionVersionResourceMappingsCommand");
const ListFunctionVersionsInternalCommand_1 = require("./commands/ListFunctionVersionsInternalCommand");
const ListFunctions20150331Command_1 = require("./commands/ListFunctions20150331Command");
const ListFunctionsByCodeSigningConfigCommand_1 = require("./commands/ListFunctionsByCodeSigningConfigCommand");
const ListFunctionsCommand_1 = require("./commands/ListFunctionsCommand");
const ListLayerVersions20181031Command_1 = require("./commands/ListLayerVersions20181031Command");
const ListLayerVersionsInternalCommand_1 = require("./commands/ListLayerVersionsInternalCommand");
const ListLayers20181031Command_1 = require("./commands/ListLayers20181031Command");
const ListProvisionedConcurrencyConfigsByAccountIdCommand_1 = require("./commands/ListProvisionedConcurrencyConfigsByAccountIdCommand");
const ListProvisionedConcurrencyConfigsCommand_1 = require("./commands/ListProvisionedConcurrencyConfigsCommand");
const ListTags20170331Command_1 = require("./commands/ListTags20170331Command");
const ListVersionsByFunction20150331Command_1 = require("./commands/ListVersionsByFunction20150331Command");
const PublishLayerVersion20181031Command_1 = require("./commands/PublishLayerVersion20181031Command");
const PublishVersion20150331Command_1 = require("./commands/PublishVersion20150331Command");
const PutFunctionAliasResourceMappingCommand_1 = require("./commands/PutFunctionAliasResourceMappingCommand");
const PutFunctionCodeSigningConfigCommand_1 = require("./commands/PutFunctionCodeSigningConfigCommand");
const PutFunctionConcurrency20171031Command_1 = require("./commands/PutFunctionConcurrency20171031Command");
const PutFunctionEventInvokeConfigCommand_1 = require("./commands/PutFunctionEventInvokeConfigCommand");
const PutFunctionRecursionConfigCommand_1 = require("./commands/PutFunctionRecursionConfigCommand");
const PutFunctionResourceMappingCommand_1 = require("./commands/PutFunctionResourceMappingCommand");
const PutFunctionScalingConfigCommand_1 = require("./commands/PutFunctionScalingConfigCommand");
const PutFunctionVersionResourceMappingCommand_1 = require("./commands/PutFunctionVersionResourceMappingCommand");
const PutProvisionedConcurrencyConfigCommand_1 = require("./commands/PutProvisionedConcurrencyConfigCommand");
const PutPublicAccessBlockConfigCommand_1 = require("./commands/PutPublicAccessBlockConfigCommand");
const PutResourcePolicyCommand_1 = require("./commands/PutResourcePolicyCommand");
const PutRuntimeManagementConfigCommand_1 = require("./commands/PutRuntimeManagementConfigCommand");
const ReconcileProvisionedConcurrencyCommand_1 = require("./commands/ReconcileProvisionedConcurrencyCommand");
const RedriveFunctionResourceTagsCommand_1 = require("./commands/RedriveFunctionResourceTagsCommand");
const RemoveEventSourceCommand_1 = require("./commands/RemoveEventSourceCommand");
const RemoveLayerVersionPermission20181031Command_1 = require("./commands/RemoveLayerVersionPermission20181031Command");
const RemovePermission20150331Command_1 = require("./commands/RemovePermission20150331Command");
const RemovePermission20150331v2Command_1 = require("./commands/RemovePermission20150331v2Command");
const ResetFunctionFeatureInternalCommand_1 = require("./commands/ResetFunctionFeatureInternalCommand");
const ResignFunctionAliasCommand_1 = require("./commands/ResignFunctionAliasCommand");
const ResignFunctionVersionCommand_1 = require("./commands/ResignFunctionVersionCommand");
const RollbackFunctionCommand_1 = require("./commands/RollbackFunctionCommand");
const RollbackTagsOwnershipFromLambdaCommand_1 = require("./commands/RollbackTagsOwnershipFromLambdaCommand");
const SafeDeleteProvisionedConcurrencyConfigCommand_1 = require("./commands/SafeDeleteProvisionedConcurrencyConfigCommand");
const SendDurableExecutionCallbackFailureCommand_1 = require("./commands/SendDurableExecutionCallbackFailureCommand");
const SendDurableExecutionCallbackHeartbeatCommand_1 = require("./commands/SendDurableExecutionCallbackHeartbeatCommand");
const SendDurableExecutionCallbackSuccessCommand_1 = require("./commands/SendDurableExecutionCallbackSuccessCommand");
const SetAccountRiskSettingsCommand_1 = require("./commands/SetAccountRiskSettingsCommand");
const SetAccountSettings20170430Command_1 = require("./commands/SetAccountSettings20170430Command");
const StopDurableExecutionCommand_1 = require("./commands/StopDurableExecutionCommand");
const TagResource20170331Command_1 = require("./commands/TagResource20170331Command");
const TagResource20170331v2Command_1 = require("./commands/TagResource20170331v2Command");
const TagResourceBeforeResourceCreationCommand_1 = require("./commands/TagResourceBeforeResourceCreationCommand");
const TransferTagsOwnershipToLambdaCommand_1 = require("./commands/TransferTagsOwnershipToLambdaCommand");
const UntagResource20170331Command_1 = require("./commands/UntagResource20170331Command");
const UntagResource20170331v2Command_1 = require("./commands/UntagResource20170331v2Command");
const UpdateAccountSettingsInternalCommand_1 = require("./commands/UpdateAccountSettingsInternalCommand");
const UpdateAlias20150331Command_1 = require("./commands/UpdateAlias20150331Command");
const UpdateCodeSigningConfigCommand_1 = require("./commands/UpdateCodeSigningConfigCommand");
const UpdateConcurrencyInProvisionedConcurrencyConfigCommand_1 = require("./commands/UpdateConcurrencyInProvisionedConcurrencyConfigCommand");
const UpdateEventSourceMapping20150331Command_1 = require("./commands/UpdateEventSourceMapping20150331Command");
const UpdateFunctionCode20150331Command_1 = require("./commands/UpdateFunctionCode20150331Command");
const UpdateFunctionCode20150331v2Command_1 = require("./commands/UpdateFunctionCode20150331v2Command");
const UpdateFunctionCodeCommand_1 = require("./commands/UpdateFunctionCodeCommand");
const UpdateFunctionConfiguration20150331Command_1 = require("./commands/UpdateFunctionConfiguration20150331Command");
const UpdateFunctionConfiguration20150331v2Command_1 = require("./commands/UpdateFunctionConfiguration20150331v2Command");
const UpdateFunctionConfigurationCommand_1 = require("./commands/UpdateFunctionConfigurationCommand");
const UpdateFunctionEventInvokeConfigCommand_1 = require("./commands/UpdateFunctionEventInvokeConfigCommand");
const UpdateFunctionUrlConfigCommand_1 = require("./commands/UpdateFunctionUrlConfigCommand");
const UpdateFunctionVersionResourceMappingCommand_1 = require("./commands/UpdateFunctionVersionResourceMappingCommand");
const UpdateProvisionedConcurrencyConfigCommand_1 = require("./commands/UpdateProvisionedConcurrencyConfigCommand");
const UpdateVersionProvisionedConcurrencyStatusCommand_1 = require("./commands/UpdateVersionProvisionedConcurrencyStatusCommand");
const UploadFunctionCommand_1 = require("./commands/UploadFunctionCommand");
const ValidateProvisionedConcurrencyFunctionVersionCommand_1 = require("./commands/ValidateProvisionedConcurrencyFunctionVersionCommand");
const smithy_client_1 = require("@smithy/smithy-client");
const commands = {
    AddEventSourceCommand: AddEventSourceCommand_1.AddEventSourceCommand,
    AddLayerVersionPermission20181031Command: AddLayerVersionPermission20181031Command_1.AddLayerVersionPermission20181031Command,
    AddPermission20150331Command: AddPermission20150331Command_1.AddPermission20150331Command,
    AddPermission20150331v2Command: AddPermission20150331v2Command_1.AddPermission20150331v2Command,
    CheckpointDurableExecutionCommand: CheckpointDurableExecutionCommand_1.CheckpointDurableExecutionCommand,
    CreateAlias20150331Command: CreateAlias20150331Command_1.CreateAlias20150331Command,
    CreateCodeSigningConfigCommand: CreateCodeSigningConfigCommand_1.CreateCodeSigningConfigCommand,
    CreateEventSourceMapping20150331Command: CreateEventSourceMapping20150331Command_1.CreateEventSourceMapping20150331Command,
    CreateFunction20150331Command: CreateFunction20150331Command_1.CreateFunction20150331Command,
    CreateFunctionUrlConfigCommand: CreateFunctionUrlConfigCommand_1.CreateFunctionUrlConfigCommand,
    DeleteAccountSettingsInternalCommand: DeleteAccountSettingsInternalCommand_1.DeleteAccountSettingsInternalCommand,
    DeleteAlias20150331Command: DeleteAlias20150331Command_1.DeleteAlias20150331Command,
    DeleteCodeSigningConfigCommand: DeleteCodeSigningConfigCommand_1.DeleteCodeSigningConfigCommand,
    DeleteEventSourceMapping20150331Command: DeleteEventSourceMapping20150331Command_1.DeleteEventSourceMapping20150331Command,
    DeleteFunctionCommand: DeleteFunctionCommand_1.DeleteFunctionCommand,
    DeleteFunction20150331Command: DeleteFunction20150331Command_1.DeleteFunction20150331Command,
    DeleteFunctionAliasResourceMappingCommand: DeleteFunctionAliasResourceMappingCommand_1.DeleteFunctionAliasResourceMappingCommand,
    DeleteFunctionCodeSigningConfigCommand: DeleteFunctionCodeSigningConfigCommand_1.DeleteFunctionCodeSigningConfigCommand,
    DeleteFunctionConcurrency20171031Command: DeleteFunctionConcurrency20171031Command_1.DeleteFunctionConcurrency20171031Command,
    DeleteFunctionEventInvokeConfigCommand: DeleteFunctionEventInvokeConfigCommand_1.DeleteFunctionEventInvokeConfigCommand,
    DeleteFunctionInternalCommand: DeleteFunctionInternalCommand_1.DeleteFunctionInternalCommand,
    DeleteFunctionResourceMappingCommand: DeleteFunctionResourceMappingCommand_1.DeleteFunctionResourceMappingCommand,
    DeleteFunctionUrlConfigCommand: DeleteFunctionUrlConfigCommand_1.DeleteFunctionUrlConfigCommand,
    DeleteFunctionVersionResourceMappingCommand: DeleteFunctionVersionResourceMappingCommand_1.DeleteFunctionVersionResourceMappingCommand,
    DeleteFunctionVersionResourcesInternalCommand: DeleteFunctionVersionResourcesInternalCommand_1.DeleteFunctionVersionResourcesInternalCommand,
    DeleteLayerVersion20181031Command: DeleteLayerVersion20181031Command_1.DeleteLayerVersion20181031Command,
    DeleteMigratedLayerVersionCommand: DeleteMigratedLayerVersionCommand_1.DeleteMigratedLayerVersionCommand,
    DeleteProvisionedConcurrencyConfigCommand: DeleteProvisionedConcurrencyConfigCommand_1.DeleteProvisionedConcurrencyConfigCommand,
    DeleteProvisionedConcurrencyConfigInternalCommand: DeleteProvisionedConcurrencyConfigInternalCommand_1.DeleteProvisionedConcurrencyConfigInternalCommand,
    DeleteResourcePolicyCommand: DeleteResourcePolicyCommand_1.DeleteResourcePolicyCommand,
    DisableFunctionCommand: DisableFunctionCommand_1.DisableFunctionCommand,
    DisablePublicAccessBlockConfigCommand: DisablePublicAccessBlockConfigCommand_1.DisablePublicAccessBlockConfigCommand,
    DisableReplication20170630Command: DisableReplication20170630Command_1.DisableReplication20170630Command,
    EnableReplication20170630Command: EnableReplication20170630Command_1.EnableReplication20170630Command,
    EnableReplication20170630v2Command: EnableReplication20170630v2Command_1.EnableReplication20170630v2Command,
    ExportAccountSettingsCommand: ExportAccountSettingsCommand_1.ExportAccountSettingsCommand,
    ExportAliasCommand: ExportAliasCommand_1.ExportAliasCommand,
    ExportFunctionUrlConfigsCommand: ExportFunctionUrlConfigsCommand_1.ExportFunctionUrlConfigsCommand,
    ExportFunctionVersionCommand: ExportFunctionVersionCommand_1.ExportFunctionVersionCommand,
    ExportLayerVersionCommand: ExportLayerVersionCommand_1.ExportLayerVersionCommand,
    ExportProvisionedConcurrencyConfigCommand: ExportProvisionedConcurrencyConfigCommand_1.ExportProvisionedConcurrencyConfigCommand,
    GetAccountRiskSettingsCommand: GetAccountRiskSettingsCommand_1.GetAccountRiskSettingsCommand,
    GetAccountSettings20150331Command: GetAccountSettings20150331Command_1.GetAccountSettings20150331Command,
    GetAccountSettings20160819Command: GetAccountSettings20160819Command_1.GetAccountSettings20160819Command,
    GetAccountSettingsInternalCommand: GetAccountSettingsInternalCommand_1.GetAccountSettingsInternalCommand,
    GetAlias20150331Command: GetAlias20150331Command_1.GetAlias20150331Command,
    GetAliasInternalCommand: GetAliasInternalCommand_1.GetAliasInternalCommand,
    GetCodeSigningConfigCommand: GetCodeSigningConfigCommand_1.GetCodeSigningConfigCommand,
    GetDurableExecutionCommand: GetDurableExecutionCommand_1.GetDurableExecutionCommand,
    GetDurableExecutionHistoryCommand: GetDurableExecutionHistoryCommand_1.GetDurableExecutionHistoryCommand,
    GetDurableExecutionStateCommand: GetDurableExecutionStateCommand_1.GetDurableExecutionStateCommand,
    GetEventSourceCommand: GetEventSourceCommand_1.GetEventSourceCommand,
    GetEventSourceMapping20150331Command: GetEventSourceMapping20150331Command_1.GetEventSourceMapping20150331Command,
    GetEventSourceMappingInternalCommand: GetEventSourceMappingInternalCommand_1.GetEventSourceMappingInternalCommand,
    GetFunctionCommand: GetFunctionCommand_1.GetFunctionCommand,
    GetFunction20150331Command: GetFunction20150331Command_1.GetFunction20150331Command,
    GetFunction20150331v2Command: GetFunction20150331v2Command_1.GetFunction20150331v2Command,
    GetFunctionCodeSigningConfigCommand: GetFunctionCodeSigningConfigCommand_1.GetFunctionCodeSigningConfigCommand,
    GetFunctionConcurrencyCommand: GetFunctionConcurrencyCommand_1.GetFunctionConcurrencyCommand,
    GetFunctionConfigurationCommand: GetFunctionConfigurationCommand_1.GetFunctionConfigurationCommand,
    GetFunctionConfiguration20150331Command: GetFunctionConfiguration20150331Command_1.GetFunctionConfiguration20150331Command,
    GetFunctionConfiguration20150331v2Command: GetFunctionConfiguration20150331v2Command_1.GetFunctionConfiguration20150331v2Command,
    GetFunctionEventInvokeConfigCommand: GetFunctionEventInvokeConfigCommand_1.GetFunctionEventInvokeConfigCommand,
    GetFunctionInternalCommand: GetFunctionInternalCommand_1.GetFunctionInternalCommand,
    GetFunctionRecursionConfigCommand: GetFunctionRecursionConfigCommand_1.GetFunctionRecursionConfigCommand,
    GetFunctionScalingConfigCommand: GetFunctionScalingConfigCommand_1.GetFunctionScalingConfigCommand,
    GetFunctionUrlConfigCommand: GetFunctionUrlConfigCommand_1.GetFunctionUrlConfigCommand,
    GetLatestLayerVersionInfoInternalCommand: GetLatestLayerVersionInfoInternalCommand_1.GetLatestLayerVersionInfoInternalCommand,
    GetLayerVersion20181031Command: GetLayerVersion20181031Command_1.GetLayerVersion20181031Command,
    GetLayerVersionByArn20181031Command: GetLayerVersionByArn20181031Command_1.GetLayerVersionByArn20181031Command,
    GetLayerVersionInternalCommand: GetLayerVersionInternalCommand_1.GetLayerVersionInternalCommand,
    GetLayerVersionPolicy20181031Command: GetLayerVersionPolicy20181031Command_1.GetLayerVersionPolicy20181031Command,
    GetLayerVersionPolicyInternalCommand: GetLayerVersionPolicyInternalCommand_1.GetLayerVersionPolicyInternalCommand,
    GetPolicy20150331Command: GetPolicy20150331Command_1.GetPolicy20150331Command,
    GetPolicy20150331v2Command: GetPolicy20150331v2Command_1.GetPolicy20150331v2Command,
    GetProvisionedConcurrencyConfigCommand: GetProvisionedConcurrencyConfigCommand_1.GetProvisionedConcurrencyConfigCommand,
    GetPublicAccessBlockConfigCommand: GetPublicAccessBlockConfigCommand_1.GetPublicAccessBlockConfigCommand,
    GetResourcePolicyCommand: GetResourcePolicyCommand_1.GetResourcePolicyCommand,
    GetRuntimeManagementConfigCommand: GetRuntimeManagementConfigCommand_1.GetRuntimeManagementConfigCommand,
    GetVersionProvisionedConcurrencyStatusCommand: GetVersionProvisionedConcurrencyStatusCommand_1.GetVersionProvisionedConcurrencyStatusCommand,
    GetVersionSandboxSpecCommand: GetVersionSandboxSpecCommand_1.GetVersionSandboxSpecCommand,
    ImportAccountSettingsCommand: ImportAccountSettingsCommand_1.ImportAccountSettingsCommand,
    ImportAliasCommand: ImportAliasCommand_1.ImportAliasCommand,
    ImportFunctionCounterCommand: ImportFunctionCounterCommand_1.ImportFunctionCounterCommand,
    ImportFunctionUrlConfigsCommand: ImportFunctionUrlConfigsCommand_1.ImportFunctionUrlConfigsCommand,
    ImportFunctionVersionCommand: ImportFunctionVersionCommand_1.ImportFunctionVersionCommand,
    ImportLayerVersionCommand: ImportLayerVersionCommand_1.ImportLayerVersionCommand,
    ImportProvisionedConcurrencyConfigCommand: ImportProvisionedConcurrencyConfigCommand_1.ImportProvisionedConcurrencyConfigCommand,
    InformTagrisAfterResourceCreationCommand: InformTagrisAfterResourceCreationCommand_1.InformTagrisAfterResourceCreationCommand,
    Invoke20150331Command: Invoke20150331Command_1.Invoke20150331Command,
    InvokeAsyncCommand: InvokeAsyncCommand_1.InvokeAsyncCommand,
    InvokeWithResponseStreamCommand: InvokeWithResponseStreamCommand_1.InvokeWithResponseStreamCommand,
    ListAliases20150331Command: ListAliases20150331Command_1.ListAliases20150331Command,
    ListAliasesInternalCommand: ListAliasesInternalCommand_1.ListAliasesInternalCommand,
    ListCodeSigningConfigsCommand: ListCodeSigningConfigsCommand_1.ListCodeSigningConfigsCommand,
    ListDurableExecutionsCommand: ListDurableExecutionsCommand_1.ListDurableExecutionsCommand,
    ListEventSourceMappings20150331Command: ListEventSourceMappings20150331Command_1.ListEventSourceMappings20150331Command,
    ListEventSourceMappingsInternalCommand: ListEventSourceMappingsInternalCommand_1.ListEventSourceMappingsInternalCommand,
    ListEventSourcesCommand: ListEventSourcesCommand_1.ListEventSourcesCommand,
    ListFunctionAliasResourceMappingsCommand: ListFunctionAliasResourceMappingsCommand_1.ListFunctionAliasResourceMappingsCommand,
    ListFunctionCountersInternalCommand: ListFunctionCountersInternalCommand_1.ListFunctionCountersInternalCommand,
    ListFunctionEventInvokeConfigsCommand: ListFunctionEventInvokeConfigsCommand_1.ListFunctionEventInvokeConfigsCommand,
    ListFunctionResourceMappingsCommand: ListFunctionResourceMappingsCommand_1.ListFunctionResourceMappingsCommand,
    ListFunctionsCommand: ListFunctionsCommand_1.ListFunctionsCommand,
    ListFunctions20150331Command: ListFunctions20150331Command_1.ListFunctions20150331Command,
    ListFunctionsByCodeSigningConfigCommand: ListFunctionsByCodeSigningConfigCommand_1.ListFunctionsByCodeSigningConfigCommand,
    ListFunctionUrlConfigsCommand: ListFunctionUrlConfigsCommand_1.ListFunctionUrlConfigsCommand,
    ListFunctionUrlsInternalCommand: ListFunctionUrlsInternalCommand_1.ListFunctionUrlsInternalCommand,
    ListFunctionVersionResourceMappingsCommand: ListFunctionVersionResourceMappingsCommand_1.ListFunctionVersionResourceMappingsCommand,
    ListFunctionVersionsInternalCommand: ListFunctionVersionsInternalCommand_1.ListFunctionVersionsInternalCommand,
    ListLayers20181031Command: ListLayers20181031Command_1.ListLayers20181031Command,
    ListLayerVersions20181031Command: ListLayerVersions20181031Command_1.ListLayerVersions20181031Command,
    ListLayerVersionsInternalCommand: ListLayerVersionsInternalCommand_1.ListLayerVersionsInternalCommand,
    ListProvisionedConcurrencyConfigsCommand: ListProvisionedConcurrencyConfigsCommand_1.ListProvisionedConcurrencyConfigsCommand,
    ListProvisionedConcurrencyConfigsByAccountIdCommand: ListProvisionedConcurrencyConfigsByAccountIdCommand_1.ListProvisionedConcurrencyConfigsByAccountIdCommand,
    ListTags20170331Command: ListTags20170331Command_1.ListTags20170331Command,
    ListVersionsByFunction20150331Command: ListVersionsByFunction20150331Command_1.ListVersionsByFunction20150331Command,
    PublishLayerVersion20181031Command: PublishLayerVersion20181031Command_1.PublishLayerVersion20181031Command,
    PublishVersion20150331Command: PublishVersion20150331Command_1.PublishVersion20150331Command,
    PutFunctionAliasResourceMappingCommand: PutFunctionAliasResourceMappingCommand_1.PutFunctionAliasResourceMappingCommand,
    PutFunctionCodeSigningConfigCommand: PutFunctionCodeSigningConfigCommand_1.PutFunctionCodeSigningConfigCommand,
    PutFunctionConcurrency20171031Command: PutFunctionConcurrency20171031Command_1.PutFunctionConcurrency20171031Command,
    PutFunctionEventInvokeConfigCommand: PutFunctionEventInvokeConfigCommand_1.PutFunctionEventInvokeConfigCommand,
    PutFunctionRecursionConfigCommand: PutFunctionRecursionConfigCommand_1.PutFunctionRecursionConfigCommand,
    PutFunctionResourceMappingCommand: PutFunctionResourceMappingCommand_1.PutFunctionResourceMappingCommand,
    PutFunctionScalingConfigCommand: PutFunctionScalingConfigCommand_1.PutFunctionScalingConfigCommand,
    PutFunctionVersionResourceMappingCommand: PutFunctionVersionResourceMappingCommand_1.PutFunctionVersionResourceMappingCommand,
    PutProvisionedConcurrencyConfigCommand: PutProvisionedConcurrencyConfigCommand_1.PutProvisionedConcurrencyConfigCommand,
    PutPublicAccessBlockConfigCommand: PutPublicAccessBlockConfigCommand_1.PutPublicAccessBlockConfigCommand,
    PutResourcePolicyCommand: PutResourcePolicyCommand_1.PutResourcePolicyCommand,
    PutRuntimeManagementConfigCommand: PutRuntimeManagementConfigCommand_1.PutRuntimeManagementConfigCommand,
    ReconcileProvisionedConcurrencyCommand: ReconcileProvisionedConcurrencyCommand_1.ReconcileProvisionedConcurrencyCommand,
    RedriveFunctionResourceTagsCommand: RedriveFunctionResourceTagsCommand_1.RedriveFunctionResourceTagsCommand,
    RemoveEventSourceCommand: RemoveEventSourceCommand_1.RemoveEventSourceCommand,
    RemoveLayerVersionPermission20181031Command: RemoveLayerVersionPermission20181031Command_1.RemoveLayerVersionPermission20181031Command,
    RemovePermission20150331Command: RemovePermission20150331Command_1.RemovePermission20150331Command,
    RemovePermission20150331v2Command: RemovePermission20150331v2Command_1.RemovePermission20150331v2Command,
    ResetFunctionFeatureInternalCommand: ResetFunctionFeatureInternalCommand_1.ResetFunctionFeatureInternalCommand,
    ResignFunctionAliasCommand: ResignFunctionAliasCommand_1.ResignFunctionAliasCommand,
    ResignFunctionVersionCommand: ResignFunctionVersionCommand_1.ResignFunctionVersionCommand,
    RollbackFunctionCommand: RollbackFunctionCommand_1.RollbackFunctionCommand,
    RollbackTagsOwnershipFromLambdaCommand: RollbackTagsOwnershipFromLambdaCommand_1.RollbackTagsOwnershipFromLambdaCommand,
    SafeDeleteProvisionedConcurrencyConfigCommand: SafeDeleteProvisionedConcurrencyConfigCommand_1.SafeDeleteProvisionedConcurrencyConfigCommand,
    SendDurableExecutionCallbackFailureCommand: SendDurableExecutionCallbackFailureCommand_1.SendDurableExecutionCallbackFailureCommand,
    SendDurableExecutionCallbackHeartbeatCommand: SendDurableExecutionCallbackHeartbeatCommand_1.SendDurableExecutionCallbackHeartbeatCommand,
    SendDurableExecutionCallbackSuccessCommand: SendDurableExecutionCallbackSuccessCommand_1.SendDurableExecutionCallbackSuccessCommand,
    SetAccountRiskSettingsCommand: SetAccountRiskSettingsCommand_1.SetAccountRiskSettingsCommand,
    SetAccountSettings20170430Command: SetAccountSettings20170430Command_1.SetAccountSettings20170430Command,
    StopDurableExecutionCommand: StopDurableExecutionCommand_1.StopDurableExecutionCommand,
    TagResource20170331Command: TagResource20170331Command_1.TagResource20170331Command,
    TagResource20170331v2Command: TagResource20170331v2Command_1.TagResource20170331v2Command,
    TagResourceBeforeResourceCreationCommand: TagResourceBeforeResourceCreationCommand_1.TagResourceBeforeResourceCreationCommand,
    TransferTagsOwnershipToLambdaCommand: TransferTagsOwnershipToLambdaCommand_1.TransferTagsOwnershipToLambdaCommand,
    UntagResource20170331Command: UntagResource20170331Command_1.UntagResource20170331Command,
    UntagResource20170331v2Command: UntagResource20170331v2Command_1.UntagResource20170331v2Command,
    UpdateAccountSettingsInternalCommand: UpdateAccountSettingsInternalCommand_1.UpdateAccountSettingsInternalCommand,
    UpdateAlias20150331Command: UpdateAlias20150331Command_1.UpdateAlias20150331Command,
    UpdateCodeSigningConfigCommand: UpdateCodeSigningConfigCommand_1.UpdateCodeSigningConfigCommand,
    UpdateConcurrencyInProvisionedConcurrencyConfigCommand: UpdateConcurrencyInProvisionedConcurrencyConfigCommand_1.UpdateConcurrencyInProvisionedConcurrencyConfigCommand,
    UpdateEventSourceMapping20150331Command: UpdateEventSourceMapping20150331Command_1.UpdateEventSourceMapping20150331Command,
    UpdateFunctionCodeCommand: UpdateFunctionCodeCommand_1.UpdateFunctionCodeCommand,
    UpdateFunctionCode20150331Command: UpdateFunctionCode20150331Command_1.UpdateFunctionCode20150331Command,
    UpdateFunctionCode20150331v2Command: UpdateFunctionCode20150331v2Command_1.UpdateFunctionCode20150331v2Command,
    UpdateFunctionConfigurationCommand: UpdateFunctionConfigurationCommand_1.UpdateFunctionConfigurationCommand,
    UpdateFunctionConfiguration20150331Command: UpdateFunctionConfiguration20150331Command_1.UpdateFunctionConfiguration20150331Command,
    UpdateFunctionConfiguration20150331v2Command: UpdateFunctionConfiguration20150331v2Command_1.UpdateFunctionConfiguration20150331v2Command,
    UpdateFunctionEventInvokeConfigCommand: UpdateFunctionEventInvokeConfigCommand_1.UpdateFunctionEventInvokeConfigCommand,
    UpdateFunctionUrlConfigCommand: UpdateFunctionUrlConfigCommand_1.UpdateFunctionUrlConfigCommand,
    UpdateFunctionVersionResourceMappingCommand: UpdateFunctionVersionResourceMappingCommand_1.UpdateFunctionVersionResourceMappingCommand,
    UpdateProvisionedConcurrencyConfigCommand: UpdateProvisionedConcurrencyConfigCommand_1.UpdateProvisionedConcurrencyConfigCommand,
    UpdateVersionProvisionedConcurrencyStatusCommand: UpdateVersionProvisionedConcurrencyStatusCommand_1.UpdateVersionProvisionedConcurrencyStatusCommand,
    UploadFunctionCommand: UploadFunctionCommand_1.UploadFunctionCommand,
    ValidateProvisionedConcurrencyFunctionVersionCommand: ValidateProvisionedConcurrencyFunctionVersionCommand_1.ValidateProvisionedConcurrencyFunctionVersionCommand,
};
class Lambda extends LambdaClient_1.LambdaClient {
}
exports.Lambda = Lambda;
(0, smithy_client_1.createAggregatedClient)(commands, Lambda);
