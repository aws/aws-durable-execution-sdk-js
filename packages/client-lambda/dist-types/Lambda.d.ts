import { LambdaClient } from "./LambdaClient";
import { AddEventSourceCommandInput, AddEventSourceCommandOutput } from "./commands/AddEventSourceCommand";
import { AddLayerVersionPermission20181031CommandInput, AddLayerVersionPermission20181031CommandOutput } from "./commands/AddLayerVersionPermission20181031Command";
import { AddPermission20150331CommandInput, AddPermission20150331CommandOutput } from "./commands/AddPermission20150331Command";
import { AddPermission20150331v2CommandInput, AddPermission20150331v2CommandOutput } from "./commands/AddPermission20150331v2Command";
import { CheckpointDurableExecutionCommandInput, CheckpointDurableExecutionCommandOutput } from "./commands/CheckpointDurableExecutionCommand";
import { CreateAlias20150331CommandInput, CreateAlias20150331CommandOutput } from "./commands/CreateAlias20150331Command";
import { CreateCodeSigningConfigCommandInput, CreateCodeSigningConfigCommandOutput } from "./commands/CreateCodeSigningConfigCommand";
import { CreateEventSourceMapping20150331CommandInput, CreateEventSourceMapping20150331CommandOutput } from "./commands/CreateEventSourceMapping20150331Command";
import { CreateFunction20150331CommandInput, CreateFunction20150331CommandOutput } from "./commands/CreateFunction20150331Command";
import { CreateFunctionUrlConfigCommandInput, CreateFunctionUrlConfigCommandOutput } from "./commands/CreateFunctionUrlConfigCommand";
import { DeleteAccountSettingsInternalCommandInput, DeleteAccountSettingsInternalCommandOutput } from "./commands/DeleteAccountSettingsInternalCommand";
import { DeleteAlias20150331CommandInput, DeleteAlias20150331CommandOutput } from "./commands/DeleteAlias20150331Command";
import { DeleteCodeSigningConfigCommandInput, DeleteCodeSigningConfigCommandOutput } from "./commands/DeleteCodeSigningConfigCommand";
import { DeleteEventSourceMapping20150331CommandInput, DeleteEventSourceMapping20150331CommandOutput } from "./commands/DeleteEventSourceMapping20150331Command";
import { DeleteFunction20150331CommandInput, DeleteFunction20150331CommandOutput } from "./commands/DeleteFunction20150331Command";
import { DeleteFunctionAliasResourceMappingCommandInput, DeleteFunctionAliasResourceMappingCommandOutput } from "./commands/DeleteFunctionAliasResourceMappingCommand";
import { DeleteFunctionCodeSigningConfigCommandInput, DeleteFunctionCodeSigningConfigCommandOutput } from "./commands/DeleteFunctionCodeSigningConfigCommand";
import { DeleteFunctionCommandInput, DeleteFunctionCommandOutput } from "./commands/DeleteFunctionCommand";
import { DeleteFunctionConcurrency20171031CommandInput, DeleteFunctionConcurrency20171031CommandOutput } from "./commands/DeleteFunctionConcurrency20171031Command";
import { DeleteFunctionEventInvokeConfigCommandInput, DeleteFunctionEventInvokeConfigCommandOutput } from "./commands/DeleteFunctionEventInvokeConfigCommand";
import { DeleteFunctionInternalCommandInput, DeleteFunctionInternalCommandOutput } from "./commands/DeleteFunctionInternalCommand";
import { DeleteFunctionResourceMappingCommandInput, DeleteFunctionResourceMappingCommandOutput } from "./commands/DeleteFunctionResourceMappingCommand";
import { DeleteFunctionUrlConfigCommandInput, DeleteFunctionUrlConfigCommandOutput } from "./commands/DeleteFunctionUrlConfigCommand";
import { DeleteFunctionVersionResourceMappingCommandInput, DeleteFunctionVersionResourceMappingCommandOutput } from "./commands/DeleteFunctionVersionResourceMappingCommand";
import { DeleteFunctionVersionResourcesInternalCommandInput, DeleteFunctionVersionResourcesInternalCommandOutput } from "./commands/DeleteFunctionVersionResourcesInternalCommand";
import { DeleteLayerVersion20181031CommandInput, DeleteLayerVersion20181031CommandOutput } from "./commands/DeleteLayerVersion20181031Command";
import { DeleteMigratedLayerVersionCommandInput, DeleteMigratedLayerVersionCommandOutput } from "./commands/DeleteMigratedLayerVersionCommand";
import { DeleteProvisionedConcurrencyConfigCommandInput, DeleteProvisionedConcurrencyConfigCommandOutput } from "./commands/DeleteProvisionedConcurrencyConfigCommand";
import { DeleteResourcePolicyCommandInput, DeleteResourcePolicyCommandOutput } from "./commands/DeleteResourcePolicyCommand";
import { DisableFunctionCommandInput, DisableFunctionCommandOutput } from "./commands/DisableFunctionCommand";
import { DisablePublicAccessBlockConfigCommandInput, DisablePublicAccessBlockConfigCommandOutput } from "./commands/DisablePublicAccessBlockConfigCommand";
import { DisableReplication20170630CommandInput, DisableReplication20170630CommandOutput } from "./commands/DisableReplication20170630Command";
import { EnableReplication20170630CommandInput, EnableReplication20170630CommandOutput } from "./commands/EnableReplication20170630Command";
import { EnableReplication20170630v2CommandInput, EnableReplication20170630v2CommandOutput } from "./commands/EnableReplication20170630v2Command";
import { ExportAccountSettingsCommandInput, ExportAccountSettingsCommandOutput } from "./commands/ExportAccountSettingsCommand";
import { ExportAliasCommandInput, ExportAliasCommandOutput } from "./commands/ExportAliasCommand";
import { ExportFunctionUrlConfigsCommandInput, ExportFunctionUrlConfigsCommandOutput } from "./commands/ExportFunctionUrlConfigsCommand";
import { ExportFunctionVersionCommandInput, ExportFunctionVersionCommandOutput } from "./commands/ExportFunctionVersionCommand";
import { ExportLayerVersionCommandInput, ExportLayerVersionCommandOutput } from "./commands/ExportLayerVersionCommand";
import { ExportProvisionedConcurrencyConfigCommandInput, ExportProvisionedConcurrencyConfigCommandOutput } from "./commands/ExportProvisionedConcurrencyConfigCommand";
import { GetAccountRiskSettingsCommandInput, GetAccountRiskSettingsCommandOutput } from "./commands/GetAccountRiskSettingsCommand";
import { GetAccountSettings20150331CommandInput, GetAccountSettings20150331CommandOutput } from "./commands/GetAccountSettings20150331Command";
import { GetAccountSettings20160819CommandInput, GetAccountSettings20160819CommandOutput } from "./commands/GetAccountSettings20160819Command";
import { GetAccountSettingsInternalCommandInput, GetAccountSettingsInternalCommandOutput } from "./commands/GetAccountSettingsInternalCommand";
import { GetAlias20150331CommandInput, GetAlias20150331CommandOutput } from "./commands/GetAlias20150331Command";
import { GetAliasInternalCommandInput, GetAliasInternalCommandOutput } from "./commands/GetAliasInternalCommand";
import { GetCodeSigningConfigCommandInput, GetCodeSigningConfigCommandOutput } from "./commands/GetCodeSigningConfigCommand";
import { GetDurableExecutionCommandInput, GetDurableExecutionCommandOutput } from "./commands/GetDurableExecutionCommand";
import { GetDurableExecutionHistoryCommandInput, GetDurableExecutionHistoryCommandOutput } from "./commands/GetDurableExecutionHistoryCommand";
import { GetDurableExecutionStateCommandInput, GetDurableExecutionStateCommandOutput } from "./commands/GetDurableExecutionStateCommand";
import { GetEventSourceCommandInput, GetEventSourceCommandOutput } from "./commands/GetEventSourceCommand";
import { GetEventSourceMapping20150331CommandInput, GetEventSourceMapping20150331CommandOutput } from "./commands/GetEventSourceMapping20150331Command";
import { GetEventSourceMappingInternalCommandInput, GetEventSourceMappingInternalCommandOutput } from "./commands/GetEventSourceMappingInternalCommand";
import { GetFunction20150331CommandInput, GetFunction20150331CommandOutput } from "./commands/GetFunction20150331Command";
import { GetFunction20150331v2CommandInput, GetFunction20150331v2CommandOutput } from "./commands/GetFunction20150331v2Command";
import { GetFunctionCodeSigningConfigCommandInput, GetFunctionCodeSigningConfigCommandOutput } from "./commands/GetFunctionCodeSigningConfigCommand";
import { GetFunctionCommandInput, GetFunctionCommandOutput } from "./commands/GetFunctionCommand";
import { GetFunctionConcurrencyCommandInput, GetFunctionConcurrencyCommandOutput } from "./commands/GetFunctionConcurrencyCommand";
import { GetFunctionConfiguration20150331CommandInput, GetFunctionConfiguration20150331CommandOutput } from "./commands/GetFunctionConfiguration20150331Command";
import { GetFunctionConfiguration20150331v2CommandInput, GetFunctionConfiguration20150331v2CommandOutput } from "./commands/GetFunctionConfiguration20150331v2Command";
import { GetFunctionConfigurationCommandInput, GetFunctionConfigurationCommandOutput } from "./commands/GetFunctionConfigurationCommand";
import { GetFunctionEventInvokeConfigCommandInput, GetFunctionEventInvokeConfigCommandOutput } from "./commands/GetFunctionEventInvokeConfigCommand";
import { GetFunctionInternalCommandInput, GetFunctionInternalCommandOutput } from "./commands/GetFunctionInternalCommand";
import { GetFunctionRecursionConfigCommandInput, GetFunctionRecursionConfigCommandOutput } from "./commands/GetFunctionRecursionConfigCommand";
import { GetFunctionScalingConfigCommandInput, GetFunctionScalingConfigCommandOutput } from "./commands/GetFunctionScalingConfigCommand";
import { GetFunctionUrlConfigCommandInput, GetFunctionUrlConfigCommandOutput } from "./commands/GetFunctionUrlConfigCommand";
import { GetLatestLayerVersionInfoInternalCommandInput, GetLatestLayerVersionInfoInternalCommandOutput } from "./commands/GetLatestLayerVersionInfoInternalCommand";
import { GetLayerVersion20181031CommandInput, GetLayerVersion20181031CommandOutput } from "./commands/GetLayerVersion20181031Command";
import { GetLayerVersionByArn20181031CommandInput, GetLayerVersionByArn20181031CommandOutput } from "./commands/GetLayerVersionByArn20181031Command";
import { GetLayerVersionInternalCommandInput, GetLayerVersionInternalCommandOutput } from "./commands/GetLayerVersionInternalCommand";
import { GetLayerVersionPolicy20181031CommandInput, GetLayerVersionPolicy20181031CommandOutput } from "./commands/GetLayerVersionPolicy20181031Command";
import { GetLayerVersionPolicyInternalCommandInput, GetLayerVersionPolicyInternalCommandOutput } from "./commands/GetLayerVersionPolicyInternalCommand";
import { GetPolicy20150331CommandInput, GetPolicy20150331CommandOutput } from "./commands/GetPolicy20150331Command";
import { GetPolicy20150331v2CommandInput, GetPolicy20150331v2CommandOutput } from "./commands/GetPolicy20150331v2Command";
import { GetProvisionedConcurrencyConfigCommandInput, GetProvisionedConcurrencyConfigCommandOutput } from "./commands/GetProvisionedConcurrencyConfigCommand";
import { GetPublicAccessBlockConfigCommandInput, GetPublicAccessBlockConfigCommandOutput } from "./commands/GetPublicAccessBlockConfigCommand";
import { GetResourcePolicyCommandInput, GetResourcePolicyCommandOutput } from "./commands/GetResourcePolicyCommand";
import { GetRuntimeManagementConfigCommandInput, GetRuntimeManagementConfigCommandOutput } from "./commands/GetRuntimeManagementConfigCommand";
import { GetVersionProvisionedConcurrencyStatusCommandInput, GetVersionProvisionedConcurrencyStatusCommandOutput } from "./commands/GetVersionProvisionedConcurrencyStatusCommand";
import { GetVersionSandboxSpecCommandInput, GetVersionSandboxSpecCommandOutput } from "./commands/GetVersionSandboxSpecCommand";
import { ImportAccountSettingsCommandInput, ImportAccountSettingsCommandOutput } from "./commands/ImportAccountSettingsCommand";
import { ImportAliasCommandInput, ImportAliasCommandOutput } from "./commands/ImportAliasCommand";
import { ImportFunctionCounterCommandInput, ImportFunctionCounterCommandOutput } from "./commands/ImportFunctionCounterCommand";
import { ImportFunctionUrlConfigsCommandInput, ImportFunctionUrlConfigsCommandOutput } from "./commands/ImportFunctionUrlConfigsCommand";
import { ImportFunctionVersionCommandInput, ImportFunctionVersionCommandOutput } from "./commands/ImportFunctionVersionCommand";
import { ImportLayerVersionCommandInput, ImportLayerVersionCommandOutput } from "./commands/ImportLayerVersionCommand";
import { ImportProvisionedConcurrencyConfigCommandInput, ImportProvisionedConcurrencyConfigCommandOutput } from "./commands/ImportProvisionedConcurrencyConfigCommand";
import { InformTagrisAfterResourceCreationCommandInput, InformTagrisAfterResourceCreationCommandOutput } from "./commands/InformTagrisAfterResourceCreationCommand";
import { Invoke20150331CommandInput, Invoke20150331CommandOutput } from "./commands/Invoke20150331Command";
import { InvokeAsyncCommandInput, InvokeAsyncCommandOutput } from "./commands/InvokeAsyncCommand";
import { InvokeWithResponseStreamCommandInput, InvokeWithResponseStreamCommandOutput } from "./commands/InvokeWithResponseStreamCommand";
import { ListAliases20150331CommandInput, ListAliases20150331CommandOutput } from "./commands/ListAliases20150331Command";
import { ListAliasesInternalCommandInput, ListAliasesInternalCommandOutput } from "./commands/ListAliasesInternalCommand";
import { ListCodeSigningConfigsCommandInput, ListCodeSigningConfigsCommandOutput } from "./commands/ListCodeSigningConfigsCommand";
import { ListDurableExecutionsCommandInput, ListDurableExecutionsCommandOutput } from "./commands/ListDurableExecutionsCommand";
import { ListEventSourceMappings20150331CommandInput, ListEventSourceMappings20150331CommandOutput } from "./commands/ListEventSourceMappings20150331Command";
import { ListEventSourceMappingsInternalCommandInput, ListEventSourceMappingsInternalCommandOutput } from "./commands/ListEventSourceMappingsInternalCommand";
import { ListEventSourcesCommandInput, ListEventSourcesCommandOutput } from "./commands/ListEventSourcesCommand";
import { ListFunctionAliasResourceMappingsCommandInput, ListFunctionAliasResourceMappingsCommandOutput } from "./commands/ListFunctionAliasResourceMappingsCommand";
import { ListFunctionCountersInternalCommandInput, ListFunctionCountersInternalCommandOutput } from "./commands/ListFunctionCountersInternalCommand";
import { ListFunctionEventInvokeConfigsCommandInput, ListFunctionEventInvokeConfigsCommandOutput } from "./commands/ListFunctionEventInvokeConfigsCommand";
import { ListFunctionResourceMappingsCommandInput, ListFunctionResourceMappingsCommandOutput } from "./commands/ListFunctionResourceMappingsCommand";
import { ListFunctionUrlConfigsCommandInput, ListFunctionUrlConfigsCommandOutput } from "./commands/ListFunctionUrlConfigsCommand";
import { ListFunctionUrlsInternalCommandInput, ListFunctionUrlsInternalCommandOutput } from "./commands/ListFunctionUrlsInternalCommand";
import { ListFunctionVersionResourceMappingsCommandInput, ListFunctionVersionResourceMappingsCommandOutput } from "./commands/ListFunctionVersionResourceMappingsCommand";
import { ListFunctionVersionsInternalCommandInput, ListFunctionVersionsInternalCommandOutput } from "./commands/ListFunctionVersionsInternalCommand";
import { ListFunctions20150331CommandInput, ListFunctions20150331CommandOutput } from "./commands/ListFunctions20150331Command";
import { ListFunctionsByCodeSigningConfigCommandInput, ListFunctionsByCodeSigningConfigCommandOutput } from "./commands/ListFunctionsByCodeSigningConfigCommand";
import { ListFunctionsCommandInput, ListFunctionsCommandOutput } from "./commands/ListFunctionsCommand";
import { ListLayerVersions20181031CommandInput, ListLayerVersions20181031CommandOutput } from "./commands/ListLayerVersions20181031Command";
import { ListLayerVersionsInternalCommandInput, ListLayerVersionsInternalCommandOutput } from "./commands/ListLayerVersionsInternalCommand";
import { ListLayers20181031CommandInput, ListLayers20181031CommandOutput } from "./commands/ListLayers20181031Command";
import { ListProvisionedConcurrencyConfigsByAccountIdCommandInput, ListProvisionedConcurrencyConfigsByAccountIdCommandOutput } from "./commands/ListProvisionedConcurrencyConfigsByAccountIdCommand";
import { ListProvisionedConcurrencyConfigsCommandInput, ListProvisionedConcurrencyConfigsCommandOutput } from "./commands/ListProvisionedConcurrencyConfigsCommand";
import { ListTags20170331CommandInput, ListTags20170331CommandOutput } from "./commands/ListTags20170331Command";
import { ListVersionsByFunction20150331CommandInput, ListVersionsByFunction20150331CommandOutput } from "./commands/ListVersionsByFunction20150331Command";
import { PublishLayerVersion20181031CommandInput, PublishLayerVersion20181031CommandOutput } from "./commands/PublishLayerVersion20181031Command";
import { PublishVersion20150331CommandInput, PublishVersion20150331CommandOutput } from "./commands/PublishVersion20150331Command";
import { PutFunctionAliasResourceMappingCommandInput, PutFunctionAliasResourceMappingCommandOutput } from "./commands/PutFunctionAliasResourceMappingCommand";
import { PutFunctionCodeSigningConfigCommandInput, PutFunctionCodeSigningConfigCommandOutput } from "./commands/PutFunctionCodeSigningConfigCommand";
import { PutFunctionConcurrency20171031CommandInput, PutFunctionConcurrency20171031CommandOutput } from "./commands/PutFunctionConcurrency20171031Command";
import { PutFunctionEventInvokeConfigCommandInput, PutFunctionEventInvokeConfigCommandOutput } from "./commands/PutFunctionEventInvokeConfigCommand";
import { PutFunctionRecursionConfigCommandInput, PutFunctionRecursionConfigCommandOutput } from "./commands/PutFunctionRecursionConfigCommand";
import { PutFunctionResourceMappingCommandInput, PutFunctionResourceMappingCommandOutput } from "./commands/PutFunctionResourceMappingCommand";
import { PutFunctionScalingConfigCommandInput, PutFunctionScalingConfigCommandOutput } from "./commands/PutFunctionScalingConfigCommand";
import { PutFunctionVersionResourceMappingCommandInput, PutFunctionVersionResourceMappingCommandOutput } from "./commands/PutFunctionVersionResourceMappingCommand";
import { PutProvisionedConcurrencyConfigCommandInput, PutProvisionedConcurrencyConfigCommandOutput } from "./commands/PutProvisionedConcurrencyConfigCommand";
import { PutPublicAccessBlockConfigCommandInput, PutPublicAccessBlockConfigCommandOutput } from "./commands/PutPublicAccessBlockConfigCommand";
import { PutResourcePolicyCommandInput, PutResourcePolicyCommandOutput } from "./commands/PutResourcePolicyCommand";
import { PutRuntimeManagementConfigCommandInput, PutRuntimeManagementConfigCommandOutput } from "./commands/PutRuntimeManagementConfigCommand";
import { ReconcileProvisionedConcurrencyCommandInput, ReconcileProvisionedConcurrencyCommandOutput } from "./commands/ReconcileProvisionedConcurrencyCommand";
import { RedriveFunctionResourceTagsCommandInput, RedriveFunctionResourceTagsCommandOutput } from "./commands/RedriveFunctionResourceTagsCommand";
import { RemoveEventSourceCommandInput, RemoveEventSourceCommandOutput } from "./commands/RemoveEventSourceCommand";
import { RemoveLayerVersionPermission20181031CommandInput, RemoveLayerVersionPermission20181031CommandOutput } from "./commands/RemoveLayerVersionPermission20181031Command";
import { RemovePermission20150331CommandInput, RemovePermission20150331CommandOutput } from "./commands/RemovePermission20150331Command";
import { RemovePermission20150331v2CommandInput, RemovePermission20150331v2CommandOutput } from "./commands/RemovePermission20150331v2Command";
import { ResetFunctionFeatureInternalCommandInput, ResetFunctionFeatureInternalCommandOutput } from "./commands/ResetFunctionFeatureInternalCommand";
import { ResignFunctionAliasCommandInput, ResignFunctionAliasCommandOutput } from "./commands/ResignFunctionAliasCommand";
import { ResignFunctionVersionCommandInput, ResignFunctionVersionCommandOutput } from "./commands/ResignFunctionVersionCommand";
import { RollbackFunctionCommandInput, RollbackFunctionCommandOutput } from "./commands/RollbackFunctionCommand";
import { RollbackTagsOwnershipFromLambdaCommandInput, RollbackTagsOwnershipFromLambdaCommandOutput } from "./commands/RollbackTagsOwnershipFromLambdaCommand";
import { SafeDeleteProvisionedConcurrencyConfigCommandInput, SafeDeleteProvisionedConcurrencyConfigCommandOutput } from "./commands/SafeDeleteProvisionedConcurrencyConfigCommand";
import { SendDurableExecutionCallbackFailureCommandInput, SendDurableExecutionCallbackFailureCommandOutput } from "./commands/SendDurableExecutionCallbackFailureCommand";
import { SendDurableExecutionCallbackHeartbeatCommandInput, SendDurableExecutionCallbackHeartbeatCommandOutput } from "./commands/SendDurableExecutionCallbackHeartbeatCommand";
import { SendDurableExecutionCallbackSuccessCommandInput, SendDurableExecutionCallbackSuccessCommandOutput } from "./commands/SendDurableExecutionCallbackSuccessCommand";
import { SetAccountRiskSettingsCommandInput, SetAccountRiskSettingsCommandOutput } from "./commands/SetAccountRiskSettingsCommand";
import { SetAccountSettings20170430CommandInput, SetAccountSettings20170430CommandOutput } from "./commands/SetAccountSettings20170430Command";
import { StopDurableExecutionCommandInput, StopDurableExecutionCommandOutput } from "./commands/StopDurableExecutionCommand";
import { TagResource20170331CommandInput, TagResource20170331CommandOutput } from "./commands/TagResource20170331Command";
import { TagResource20170331v2CommandInput, TagResource20170331v2CommandOutput } from "./commands/TagResource20170331v2Command";
import { TagResourceBeforeResourceCreationCommandInput, TagResourceBeforeResourceCreationCommandOutput } from "./commands/TagResourceBeforeResourceCreationCommand";
import { TransferTagsOwnershipToLambdaCommandInput, TransferTagsOwnershipToLambdaCommandOutput } from "./commands/TransferTagsOwnershipToLambdaCommand";
import { UntagResource20170331CommandInput, UntagResource20170331CommandOutput } from "./commands/UntagResource20170331Command";
import { UntagResource20170331v2CommandInput, UntagResource20170331v2CommandOutput } from "./commands/UntagResource20170331v2Command";
import { UpdateAccountSettingsInternalCommandInput, UpdateAccountSettingsInternalCommandOutput } from "./commands/UpdateAccountSettingsInternalCommand";
import { UpdateAlias20150331CommandInput, UpdateAlias20150331CommandOutput } from "./commands/UpdateAlias20150331Command";
import { UpdateCodeSigningConfigCommandInput, UpdateCodeSigningConfigCommandOutput } from "./commands/UpdateCodeSigningConfigCommand";
import { UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput } from "./commands/UpdateConcurrencyInProvisionedConcurrencyConfigCommand";
import { UpdateEventSourceMapping20150331CommandInput, UpdateEventSourceMapping20150331CommandOutput } from "./commands/UpdateEventSourceMapping20150331Command";
import { UpdateFunctionCode20150331CommandInput, UpdateFunctionCode20150331CommandOutput } from "./commands/UpdateFunctionCode20150331Command";
import { UpdateFunctionCode20150331v2CommandInput, UpdateFunctionCode20150331v2CommandOutput } from "./commands/UpdateFunctionCode20150331v2Command";
import { UpdateFunctionCodeCommandInput, UpdateFunctionCodeCommandOutput } from "./commands/UpdateFunctionCodeCommand";
import { UpdateFunctionConfiguration20150331CommandInput, UpdateFunctionConfiguration20150331CommandOutput } from "./commands/UpdateFunctionConfiguration20150331Command";
import { UpdateFunctionConfiguration20150331v2CommandInput, UpdateFunctionConfiguration20150331v2CommandOutput } from "./commands/UpdateFunctionConfiguration20150331v2Command";
import { UpdateFunctionConfigurationCommandInput, UpdateFunctionConfigurationCommandOutput } from "./commands/UpdateFunctionConfigurationCommand";
import { UpdateFunctionEventInvokeConfigCommandInput, UpdateFunctionEventInvokeConfigCommandOutput } from "./commands/UpdateFunctionEventInvokeConfigCommand";
import { UpdateFunctionUrlConfigCommandInput, UpdateFunctionUrlConfigCommandOutput } from "./commands/UpdateFunctionUrlConfigCommand";
import { UpdateFunctionVersionResourceMappingCommandInput, UpdateFunctionVersionResourceMappingCommandOutput } from "./commands/UpdateFunctionVersionResourceMappingCommand";
import { UpdateProvisionedConcurrencyConfigCommandInput, UpdateProvisionedConcurrencyConfigCommandOutput } from "./commands/UpdateProvisionedConcurrencyConfigCommand";
import { UpdateVersionProvisionedConcurrencyStatusCommandInput, UpdateVersionProvisionedConcurrencyStatusCommandOutput } from "./commands/UpdateVersionProvisionedConcurrencyStatusCommand";
import { UploadFunctionCommandInput, UploadFunctionCommandOutput } from "./commands/UploadFunctionCommand";
import { ValidateProvisionedConcurrencyFunctionVersionCommandInput, ValidateProvisionedConcurrencyFunctionVersionCommandOutput } from "./commands/ValidateProvisionedConcurrencyFunctionVersionCommand";
import { HttpHandlerOptions as __HttpHandlerOptions } from "@smithy/types";
export interface Lambda {
    /**
     * @see {@link AddEventSourceCommand}
     */
    addEventSource(args: AddEventSourceCommandInput, options?: __HttpHandlerOptions): Promise<AddEventSourceCommandOutput>;
    addEventSource(args: AddEventSourceCommandInput, cb: (err: any, data?: AddEventSourceCommandOutput) => void): void;
    addEventSource(args: AddEventSourceCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: AddEventSourceCommandOutput) => void): void;
    /**
     * @see {@link AddLayerVersionPermission20181031Command}
     */
    addLayerVersionPermission20181031(args: AddLayerVersionPermission20181031CommandInput, options?: __HttpHandlerOptions): Promise<AddLayerVersionPermission20181031CommandOutput>;
    addLayerVersionPermission20181031(args: AddLayerVersionPermission20181031CommandInput, cb: (err: any, data?: AddLayerVersionPermission20181031CommandOutput) => void): void;
    addLayerVersionPermission20181031(args: AddLayerVersionPermission20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: AddLayerVersionPermission20181031CommandOutput) => void): void;
    /**
     * @see {@link AddPermission20150331Command}
     */
    addPermission20150331(args: AddPermission20150331CommandInput, options?: __HttpHandlerOptions): Promise<AddPermission20150331CommandOutput>;
    addPermission20150331(args: AddPermission20150331CommandInput, cb: (err: any, data?: AddPermission20150331CommandOutput) => void): void;
    addPermission20150331(args: AddPermission20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: AddPermission20150331CommandOutput) => void): void;
    /**
     * @see {@link AddPermission20150331v2Command}
     */
    addPermission20150331v2(args: AddPermission20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<AddPermission20150331v2CommandOutput>;
    addPermission20150331v2(args: AddPermission20150331v2CommandInput, cb: (err: any, data?: AddPermission20150331v2CommandOutput) => void): void;
    addPermission20150331v2(args: AddPermission20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: AddPermission20150331v2CommandOutput) => void): void;
    /**
     * @see {@link CheckpointDurableExecutionCommand}
     */
    checkpointDurableExecution(args: CheckpointDurableExecutionCommandInput, options?: __HttpHandlerOptions): Promise<CheckpointDurableExecutionCommandOutput>;
    checkpointDurableExecution(args: CheckpointDurableExecutionCommandInput, cb: (err: any, data?: CheckpointDurableExecutionCommandOutput) => void): void;
    checkpointDurableExecution(args: CheckpointDurableExecutionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CheckpointDurableExecutionCommandOutput) => void): void;
    /**
     * @see {@link CreateAlias20150331Command}
     */
    createAlias20150331(args: CreateAlias20150331CommandInput, options?: __HttpHandlerOptions): Promise<CreateAlias20150331CommandOutput>;
    createAlias20150331(args: CreateAlias20150331CommandInput, cb: (err: any, data?: CreateAlias20150331CommandOutput) => void): void;
    createAlias20150331(args: CreateAlias20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CreateAlias20150331CommandOutput) => void): void;
    /**
     * @see {@link CreateCodeSigningConfigCommand}
     */
    createCodeSigningConfig(args: CreateCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<CreateCodeSigningConfigCommandOutput>;
    createCodeSigningConfig(args: CreateCodeSigningConfigCommandInput, cb: (err: any, data?: CreateCodeSigningConfigCommandOutput) => void): void;
    createCodeSigningConfig(args: CreateCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CreateCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link CreateEventSourceMapping20150331Command}
     */
    createEventSourceMapping20150331(args: CreateEventSourceMapping20150331CommandInput, options?: __HttpHandlerOptions): Promise<CreateEventSourceMapping20150331CommandOutput>;
    createEventSourceMapping20150331(args: CreateEventSourceMapping20150331CommandInput, cb: (err: any, data?: CreateEventSourceMapping20150331CommandOutput) => void): void;
    createEventSourceMapping20150331(args: CreateEventSourceMapping20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CreateEventSourceMapping20150331CommandOutput) => void): void;
    /**
     * @see {@link CreateFunction20150331Command}
     */
    createFunction20150331(args: CreateFunction20150331CommandInput, options?: __HttpHandlerOptions): Promise<CreateFunction20150331CommandOutput>;
    createFunction20150331(args: CreateFunction20150331CommandInput, cb: (err: any, data?: CreateFunction20150331CommandOutput) => void): void;
    createFunction20150331(args: CreateFunction20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CreateFunction20150331CommandOutput) => void): void;
    /**
     * @see {@link CreateFunctionUrlConfigCommand}
     */
    createFunctionUrlConfig(args: CreateFunctionUrlConfigCommandInput, options?: __HttpHandlerOptions): Promise<CreateFunctionUrlConfigCommandOutput>;
    createFunctionUrlConfig(args: CreateFunctionUrlConfigCommandInput, cb: (err: any, data?: CreateFunctionUrlConfigCommandOutput) => void): void;
    createFunctionUrlConfig(args: CreateFunctionUrlConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: CreateFunctionUrlConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteAccountSettingsInternalCommand}
     */
    deleteAccountSettingsInternal(args: DeleteAccountSettingsInternalCommandInput, options?: __HttpHandlerOptions): Promise<DeleteAccountSettingsInternalCommandOutput>;
    deleteAccountSettingsInternal(args: DeleteAccountSettingsInternalCommandInput, cb: (err: any, data?: DeleteAccountSettingsInternalCommandOutput) => void): void;
    deleteAccountSettingsInternal(args: DeleteAccountSettingsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteAccountSettingsInternalCommandOutput) => void): void;
    /**
     * @see {@link DeleteAlias20150331Command}
     */
    deleteAlias20150331(args: DeleteAlias20150331CommandInput, options?: __HttpHandlerOptions): Promise<DeleteAlias20150331CommandOutput>;
    deleteAlias20150331(args: DeleteAlias20150331CommandInput, cb: (err: any, data?: DeleteAlias20150331CommandOutput) => void): void;
    deleteAlias20150331(args: DeleteAlias20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteAlias20150331CommandOutput) => void): void;
    /**
     * @see {@link DeleteCodeSigningConfigCommand}
     */
    deleteCodeSigningConfig(args: DeleteCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<DeleteCodeSigningConfigCommandOutput>;
    deleteCodeSigningConfig(args: DeleteCodeSigningConfigCommandInput, cb: (err: any, data?: DeleteCodeSigningConfigCommandOutput) => void): void;
    deleteCodeSigningConfig(args: DeleteCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteEventSourceMapping20150331Command}
     */
    deleteEventSourceMapping20150331(args: DeleteEventSourceMapping20150331CommandInput, options?: __HttpHandlerOptions): Promise<DeleteEventSourceMapping20150331CommandOutput>;
    deleteEventSourceMapping20150331(args: DeleteEventSourceMapping20150331CommandInput, cb: (err: any, data?: DeleteEventSourceMapping20150331CommandOutput) => void): void;
    deleteEventSourceMapping20150331(args: DeleteEventSourceMapping20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteEventSourceMapping20150331CommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionCommand}
     */
    deleteFunction(args: DeleteFunctionCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionCommandOutput>;
    deleteFunction(args: DeleteFunctionCommandInput, cb: (err: any, data?: DeleteFunctionCommandOutput) => void): void;
    deleteFunction(args: DeleteFunctionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunction20150331Command}
     */
    deleteFunction20150331(args: DeleteFunction20150331CommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunction20150331CommandOutput>;
    deleteFunction20150331(args: DeleteFunction20150331CommandInput, cb: (err: any, data?: DeleteFunction20150331CommandOutput) => void): void;
    deleteFunction20150331(args: DeleteFunction20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunction20150331CommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionAliasResourceMappingCommand}
     */
    deleteFunctionAliasResourceMapping(args: DeleteFunctionAliasResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionAliasResourceMappingCommandOutput>;
    deleteFunctionAliasResourceMapping(args: DeleteFunctionAliasResourceMappingCommandInput, cb: (err: any, data?: DeleteFunctionAliasResourceMappingCommandOutput) => void): void;
    deleteFunctionAliasResourceMapping(args: DeleteFunctionAliasResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionAliasResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionCodeSigningConfigCommand}
     */
    deleteFunctionCodeSigningConfig(args: DeleteFunctionCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionCodeSigningConfigCommandOutput>;
    deleteFunctionCodeSigningConfig(args: DeleteFunctionCodeSigningConfigCommandInput, cb: (err: any, data?: DeleteFunctionCodeSigningConfigCommandOutput) => void): void;
    deleteFunctionCodeSigningConfig(args: DeleteFunctionCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionConcurrency20171031Command}
     */
    deleteFunctionConcurrency20171031(args: DeleteFunctionConcurrency20171031CommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionConcurrency20171031CommandOutput>;
    deleteFunctionConcurrency20171031(args: DeleteFunctionConcurrency20171031CommandInput, cb: (err: any, data?: DeleteFunctionConcurrency20171031CommandOutput) => void): void;
    deleteFunctionConcurrency20171031(args: DeleteFunctionConcurrency20171031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionConcurrency20171031CommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionEventInvokeConfigCommand}
     */
    deleteFunctionEventInvokeConfig(args: DeleteFunctionEventInvokeConfigCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionEventInvokeConfigCommandOutput>;
    deleteFunctionEventInvokeConfig(args: DeleteFunctionEventInvokeConfigCommandInput, cb: (err: any, data?: DeleteFunctionEventInvokeConfigCommandOutput) => void): void;
    deleteFunctionEventInvokeConfig(args: DeleteFunctionEventInvokeConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionEventInvokeConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionInternalCommand}
     */
    deleteFunctionInternal(args: DeleteFunctionInternalCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionInternalCommandOutput>;
    deleteFunctionInternal(args: DeleteFunctionInternalCommandInput, cb: (err: any, data?: DeleteFunctionInternalCommandOutput) => void): void;
    deleteFunctionInternal(args: DeleteFunctionInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionInternalCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionResourceMappingCommand}
     */
    deleteFunctionResourceMapping(args: DeleteFunctionResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionResourceMappingCommandOutput>;
    deleteFunctionResourceMapping(args: DeleteFunctionResourceMappingCommandInput, cb: (err: any, data?: DeleteFunctionResourceMappingCommandOutput) => void): void;
    deleteFunctionResourceMapping(args: DeleteFunctionResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionUrlConfigCommand}
     */
    deleteFunctionUrlConfig(args: DeleteFunctionUrlConfigCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionUrlConfigCommandOutput>;
    deleteFunctionUrlConfig(args: DeleteFunctionUrlConfigCommandInput, cb: (err: any, data?: DeleteFunctionUrlConfigCommandOutput) => void): void;
    deleteFunctionUrlConfig(args: DeleteFunctionUrlConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionUrlConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionVersionResourceMappingCommand}
     */
    deleteFunctionVersionResourceMapping(args: DeleteFunctionVersionResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionVersionResourceMappingCommandOutput>;
    deleteFunctionVersionResourceMapping(args: DeleteFunctionVersionResourceMappingCommandInput, cb: (err: any, data?: DeleteFunctionVersionResourceMappingCommandOutput) => void): void;
    deleteFunctionVersionResourceMapping(args: DeleteFunctionVersionResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionVersionResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link DeleteFunctionVersionResourcesInternalCommand}
     */
    deleteFunctionVersionResourcesInternal(args: DeleteFunctionVersionResourcesInternalCommandInput, options?: __HttpHandlerOptions): Promise<DeleteFunctionVersionResourcesInternalCommandOutput>;
    deleteFunctionVersionResourcesInternal(args: DeleteFunctionVersionResourcesInternalCommandInput, cb: (err: any, data?: DeleteFunctionVersionResourcesInternalCommandOutput) => void): void;
    deleteFunctionVersionResourcesInternal(args: DeleteFunctionVersionResourcesInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteFunctionVersionResourcesInternalCommandOutput) => void): void;
    /**
     * @see {@link DeleteLayerVersion20181031Command}
     */
    deleteLayerVersion20181031(args: DeleteLayerVersion20181031CommandInput, options?: __HttpHandlerOptions): Promise<DeleteLayerVersion20181031CommandOutput>;
    deleteLayerVersion20181031(args: DeleteLayerVersion20181031CommandInput, cb: (err: any, data?: DeleteLayerVersion20181031CommandOutput) => void): void;
    deleteLayerVersion20181031(args: DeleteLayerVersion20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteLayerVersion20181031CommandOutput) => void): void;
    /**
     * @see {@link DeleteMigratedLayerVersionCommand}
     */
    deleteMigratedLayerVersion(args: DeleteMigratedLayerVersionCommandInput, options?: __HttpHandlerOptions): Promise<DeleteMigratedLayerVersionCommandOutput>;
    deleteMigratedLayerVersion(args: DeleteMigratedLayerVersionCommandInput, cb: (err: any, data?: DeleteMigratedLayerVersionCommandOutput) => void): void;
    deleteMigratedLayerVersion(args: DeleteMigratedLayerVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteMigratedLayerVersionCommandOutput) => void): void;
    /**
     * @see {@link DeleteProvisionedConcurrencyConfigCommand}
     */
    deleteProvisionedConcurrencyConfig(args: DeleteProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<DeleteProvisionedConcurrencyConfigCommandOutput>;
    deleteProvisionedConcurrencyConfig(args: DeleteProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: DeleteProvisionedConcurrencyConfigCommandOutput) => void): void;
    deleteProvisionedConcurrencyConfig(args: DeleteProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link DeleteResourcePolicyCommand}
     */
    deleteResourcePolicy(args: DeleteResourcePolicyCommandInput, options?: __HttpHandlerOptions): Promise<DeleteResourcePolicyCommandOutput>;
    deleteResourcePolicy(args: DeleteResourcePolicyCommandInput, cb: (err: any, data?: DeleteResourcePolicyCommandOutput) => void): void;
    deleteResourcePolicy(args: DeleteResourcePolicyCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DeleteResourcePolicyCommandOutput) => void): void;
    /**
     * @see {@link DisableFunctionCommand}
     */
    disableFunction(args: DisableFunctionCommandInput, options?: __HttpHandlerOptions): Promise<DisableFunctionCommandOutput>;
    disableFunction(args: DisableFunctionCommandInput, cb: (err: any, data?: DisableFunctionCommandOutput) => void): void;
    disableFunction(args: DisableFunctionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DisableFunctionCommandOutput) => void): void;
    /**
     * @see {@link DisablePublicAccessBlockConfigCommand}
     */
    disablePublicAccessBlockConfig(args: DisablePublicAccessBlockConfigCommandInput, options?: __HttpHandlerOptions): Promise<DisablePublicAccessBlockConfigCommandOutput>;
    disablePublicAccessBlockConfig(args: DisablePublicAccessBlockConfigCommandInput, cb: (err: any, data?: DisablePublicAccessBlockConfigCommandOutput) => void): void;
    disablePublicAccessBlockConfig(args: DisablePublicAccessBlockConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DisablePublicAccessBlockConfigCommandOutput) => void): void;
    /**
     * @see {@link DisableReplication20170630Command}
     */
    disableReplication20170630(args: DisableReplication20170630CommandInput, options?: __HttpHandlerOptions): Promise<DisableReplication20170630CommandOutput>;
    disableReplication20170630(args: DisableReplication20170630CommandInput, cb: (err: any, data?: DisableReplication20170630CommandOutput) => void): void;
    disableReplication20170630(args: DisableReplication20170630CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: DisableReplication20170630CommandOutput) => void): void;
    /**
     * @see {@link EnableReplication20170630Command}
     */
    enableReplication20170630(args: EnableReplication20170630CommandInput, options?: __HttpHandlerOptions): Promise<EnableReplication20170630CommandOutput>;
    enableReplication20170630(args: EnableReplication20170630CommandInput, cb: (err: any, data?: EnableReplication20170630CommandOutput) => void): void;
    enableReplication20170630(args: EnableReplication20170630CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: EnableReplication20170630CommandOutput) => void): void;
    /**
     * @see {@link EnableReplication20170630v2Command}
     */
    enableReplication20170630v2(args: EnableReplication20170630v2CommandInput, options?: __HttpHandlerOptions): Promise<EnableReplication20170630v2CommandOutput>;
    enableReplication20170630v2(args: EnableReplication20170630v2CommandInput, cb: (err: any, data?: EnableReplication20170630v2CommandOutput) => void): void;
    enableReplication20170630v2(args: EnableReplication20170630v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: EnableReplication20170630v2CommandOutput) => void): void;
    /**
     * @see {@link ExportAccountSettingsCommand}
     */
    exportAccountSettings(args: ExportAccountSettingsCommandInput, options?: __HttpHandlerOptions): Promise<ExportAccountSettingsCommandOutput>;
    exportAccountSettings(args: ExportAccountSettingsCommandInput, cb: (err: any, data?: ExportAccountSettingsCommandOutput) => void): void;
    exportAccountSettings(args: ExportAccountSettingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportAccountSettingsCommandOutput) => void): void;
    /**
     * @see {@link ExportAliasCommand}
     */
    exportAlias(args: ExportAliasCommandInput, options?: __HttpHandlerOptions): Promise<ExportAliasCommandOutput>;
    exportAlias(args: ExportAliasCommandInput, cb: (err: any, data?: ExportAliasCommandOutput) => void): void;
    exportAlias(args: ExportAliasCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportAliasCommandOutput) => void): void;
    /**
     * @see {@link ExportFunctionUrlConfigsCommand}
     */
    exportFunctionUrlConfigs(args: ExportFunctionUrlConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ExportFunctionUrlConfigsCommandOutput>;
    exportFunctionUrlConfigs(args: ExportFunctionUrlConfigsCommandInput, cb: (err: any, data?: ExportFunctionUrlConfigsCommandOutput) => void): void;
    exportFunctionUrlConfigs(args: ExportFunctionUrlConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportFunctionUrlConfigsCommandOutput) => void): void;
    /**
     * @see {@link ExportFunctionVersionCommand}
     */
    exportFunctionVersion(args: ExportFunctionVersionCommandInput, options?: __HttpHandlerOptions): Promise<ExportFunctionVersionCommandOutput>;
    exportFunctionVersion(args: ExportFunctionVersionCommandInput, cb: (err: any, data?: ExportFunctionVersionCommandOutput) => void): void;
    exportFunctionVersion(args: ExportFunctionVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportFunctionVersionCommandOutput) => void): void;
    /**
     * @see {@link ExportLayerVersionCommand}
     */
    exportLayerVersion(args: ExportLayerVersionCommandInput, options?: __HttpHandlerOptions): Promise<ExportLayerVersionCommandOutput>;
    exportLayerVersion(args: ExportLayerVersionCommandInput, cb: (err: any, data?: ExportLayerVersionCommandOutput) => void): void;
    exportLayerVersion(args: ExportLayerVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportLayerVersionCommandOutput) => void): void;
    /**
     * @see {@link ExportProvisionedConcurrencyConfigCommand}
     */
    exportProvisionedConcurrencyConfig(args: ExportProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<ExportProvisionedConcurrencyConfigCommandOutput>;
    exportProvisionedConcurrencyConfig(args: ExportProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: ExportProvisionedConcurrencyConfigCommandOutput) => void): void;
    exportProvisionedConcurrencyConfig(args: ExportProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ExportProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link GetAccountRiskSettingsCommand}
     */
    getAccountRiskSettings(args: GetAccountRiskSettingsCommandInput, options?: __HttpHandlerOptions): Promise<GetAccountRiskSettingsCommandOutput>;
    getAccountRiskSettings(args: GetAccountRiskSettingsCommandInput, cb: (err: any, data?: GetAccountRiskSettingsCommandOutput) => void): void;
    getAccountRiskSettings(args: GetAccountRiskSettingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAccountRiskSettingsCommandOutput) => void): void;
    /**
     * @see {@link GetAccountSettings20150331Command}
     */
    getAccountSettings20150331(): Promise<GetAccountSettings20150331CommandOutput>;
    getAccountSettings20150331(args: GetAccountSettings20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetAccountSettings20150331CommandOutput>;
    getAccountSettings20150331(args: GetAccountSettings20150331CommandInput, cb: (err: any, data?: GetAccountSettings20150331CommandOutput) => void): void;
    getAccountSettings20150331(args: GetAccountSettings20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAccountSettings20150331CommandOutput) => void): void;
    /**
     * @see {@link GetAccountSettings20160819Command}
     */
    getAccountSettings20160819(): Promise<GetAccountSettings20160819CommandOutput>;
    getAccountSettings20160819(args: GetAccountSettings20160819CommandInput, options?: __HttpHandlerOptions): Promise<GetAccountSettings20160819CommandOutput>;
    getAccountSettings20160819(args: GetAccountSettings20160819CommandInput, cb: (err: any, data?: GetAccountSettings20160819CommandOutput) => void): void;
    getAccountSettings20160819(args: GetAccountSettings20160819CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAccountSettings20160819CommandOutput) => void): void;
    /**
     * @see {@link GetAccountSettingsInternalCommand}
     */
    getAccountSettingsInternal(args: GetAccountSettingsInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetAccountSettingsInternalCommandOutput>;
    getAccountSettingsInternal(args: GetAccountSettingsInternalCommandInput, cb: (err: any, data?: GetAccountSettingsInternalCommandOutput) => void): void;
    getAccountSettingsInternal(args: GetAccountSettingsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAccountSettingsInternalCommandOutput) => void): void;
    /**
     * @see {@link GetAlias20150331Command}
     */
    getAlias20150331(args: GetAlias20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetAlias20150331CommandOutput>;
    getAlias20150331(args: GetAlias20150331CommandInput, cb: (err: any, data?: GetAlias20150331CommandOutput) => void): void;
    getAlias20150331(args: GetAlias20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAlias20150331CommandOutput) => void): void;
    /**
     * @see {@link GetAliasInternalCommand}
     */
    getAliasInternal(args: GetAliasInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetAliasInternalCommandOutput>;
    getAliasInternal(args: GetAliasInternalCommandInput, cb: (err: any, data?: GetAliasInternalCommandOutput) => void): void;
    getAliasInternal(args: GetAliasInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetAliasInternalCommandOutput) => void): void;
    /**
     * @see {@link GetCodeSigningConfigCommand}
     */
    getCodeSigningConfig(args: GetCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetCodeSigningConfigCommandOutput>;
    getCodeSigningConfig(args: GetCodeSigningConfigCommandInput, cb: (err: any, data?: GetCodeSigningConfigCommandOutput) => void): void;
    getCodeSigningConfig(args: GetCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link GetDurableExecutionCommand}
     */
    getDurableExecution(args: GetDurableExecutionCommandInput, options?: __HttpHandlerOptions): Promise<GetDurableExecutionCommandOutput>;
    getDurableExecution(args: GetDurableExecutionCommandInput, cb: (err: any, data?: GetDurableExecutionCommandOutput) => void): void;
    getDurableExecution(args: GetDurableExecutionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetDurableExecutionCommandOutput) => void): void;
    /**
     * @see {@link GetDurableExecutionHistoryCommand}
     */
    getDurableExecutionHistory(args: GetDurableExecutionHistoryCommandInput, options?: __HttpHandlerOptions): Promise<GetDurableExecutionHistoryCommandOutput>;
    getDurableExecutionHistory(args: GetDurableExecutionHistoryCommandInput, cb: (err: any, data?: GetDurableExecutionHistoryCommandOutput) => void): void;
    getDurableExecutionHistory(args: GetDurableExecutionHistoryCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetDurableExecutionHistoryCommandOutput) => void): void;
    /**
     * @see {@link GetDurableExecutionStateCommand}
     */
    getDurableExecutionState(args: GetDurableExecutionStateCommandInput, options?: __HttpHandlerOptions): Promise<GetDurableExecutionStateCommandOutput>;
    getDurableExecutionState(args: GetDurableExecutionStateCommandInput, cb: (err: any, data?: GetDurableExecutionStateCommandOutput) => void): void;
    getDurableExecutionState(args: GetDurableExecutionStateCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetDurableExecutionStateCommandOutput) => void): void;
    /**
     * @see {@link GetEventSourceCommand}
     */
    getEventSource(args: GetEventSourceCommandInput, options?: __HttpHandlerOptions): Promise<GetEventSourceCommandOutput>;
    getEventSource(args: GetEventSourceCommandInput, cb: (err: any, data?: GetEventSourceCommandOutput) => void): void;
    getEventSource(args: GetEventSourceCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetEventSourceCommandOutput) => void): void;
    /**
     * @see {@link GetEventSourceMapping20150331Command}
     */
    getEventSourceMapping20150331(args: GetEventSourceMapping20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetEventSourceMapping20150331CommandOutput>;
    getEventSourceMapping20150331(args: GetEventSourceMapping20150331CommandInput, cb: (err: any, data?: GetEventSourceMapping20150331CommandOutput) => void): void;
    getEventSourceMapping20150331(args: GetEventSourceMapping20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetEventSourceMapping20150331CommandOutput) => void): void;
    /**
     * @see {@link GetEventSourceMappingInternalCommand}
     */
    getEventSourceMappingInternal(args: GetEventSourceMappingInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetEventSourceMappingInternalCommandOutput>;
    getEventSourceMappingInternal(args: GetEventSourceMappingInternalCommandInput, cb: (err: any, data?: GetEventSourceMappingInternalCommandOutput) => void): void;
    getEventSourceMappingInternal(args: GetEventSourceMappingInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetEventSourceMappingInternalCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionCommand}
     */
    getFunction(args: GetFunctionCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionCommandOutput>;
    getFunction(args: GetFunctionCommandInput, cb: (err: any, data?: GetFunctionCommandOutput) => void): void;
    getFunction(args: GetFunctionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionCommandOutput) => void): void;
    /**
     * @see {@link GetFunction20150331Command}
     */
    getFunction20150331(args: GetFunction20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetFunction20150331CommandOutput>;
    getFunction20150331(args: GetFunction20150331CommandInput, cb: (err: any, data?: GetFunction20150331CommandOutput) => void): void;
    getFunction20150331(args: GetFunction20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunction20150331CommandOutput) => void): void;
    /**
     * @see {@link GetFunction20150331v2Command}
     */
    getFunction20150331v2(args: GetFunction20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<GetFunction20150331v2CommandOutput>;
    getFunction20150331v2(args: GetFunction20150331v2CommandInput, cb: (err: any, data?: GetFunction20150331v2CommandOutput) => void): void;
    getFunction20150331v2(args: GetFunction20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunction20150331v2CommandOutput) => void): void;
    /**
     * @see {@link GetFunctionCodeSigningConfigCommand}
     */
    getFunctionCodeSigningConfig(args: GetFunctionCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionCodeSigningConfigCommandOutput>;
    getFunctionCodeSigningConfig(args: GetFunctionCodeSigningConfigCommandInput, cb: (err: any, data?: GetFunctionCodeSigningConfigCommandOutput) => void): void;
    getFunctionCodeSigningConfig(args: GetFunctionCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionConcurrencyCommand}
     */
    getFunctionConcurrency(args: GetFunctionConcurrencyCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionConcurrencyCommandOutput>;
    getFunctionConcurrency(args: GetFunctionConcurrencyCommandInput, cb: (err: any, data?: GetFunctionConcurrencyCommandOutput) => void): void;
    getFunctionConcurrency(args: GetFunctionConcurrencyCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionConcurrencyCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionConfigurationCommand}
     */
    getFunctionConfiguration(args: GetFunctionConfigurationCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionConfigurationCommandOutput>;
    getFunctionConfiguration(args: GetFunctionConfigurationCommandInput, cb: (err: any, data?: GetFunctionConfigurationCommandOutput) => void): void;
    getFunctionConfiguration(args: GetFunctionConfigurationCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionConfigurationCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionConfiguration20150331Command}
     */
    getFunctionConfiguration20150331(args: GetFunctionConfiguration20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionConfiguration20150331CommandOutput>;
    getFunctionConfiguration20150331(args: GetFunctionConfiguration20150331CommandInput, cb: (err: any, data?: GetFunctionConfiguration20150331CommandOutput) => void): void;
    getFunctionConfiguration20150331(args: GetFunctionConfiguration20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionConfiguration20150331CommandOutput) => void): void;
    /**
     * @see {@link GetFunctionConfiguration20150331v2Command}
     */
    getFunctionConfiguration20150331v2(args: GetFunctionConfiguration20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionConfiguration20150331v2CommandOutput>;
    getFunctionConfiguration20150331v2(args: GetFunctionConfiguration20150331v2CommandInput, cb: (err: any, data?: GetFunctionConfiguration20150331v2CommandOutput) => void): void;
    getFunctionConfiguration20150331v2(args: GetFunctionConfiguration20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionConfiguration20150331v2CommandOutput) => void): void;
    /**
     * @see {@link GetFunctionEventInvokeConfigCommand}
     */
    getFunctionEventInvokeConfig(args: GetFunctionEventInvokeConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionEventInvokeConfigCommandOutput>;
    getFunctionEventInvokeConfig(args: GetFunctionEventInvokeConfigCommandInput, cb: (err: any, data?: GetFunctionEventInvokeConfigCommandOutput) => void): void;
    getFunctionEventInvokeConfig(args: GetFunctionEventInvokeConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionEventInvokeConfigCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionInternalCommand}
     */
    getFunctionInternal(args: GetFunctionInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionInternalCommandOutput>;
    getFunctionInternal(args: GetFunctionInternalCommandInput, cb: (err: any, data?: GetFunctionInternalCommandOutput) => void): void;
    getFunctionInternal(args: GetFunctionInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionInternalCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionRecursionConfigCommand}
     */
    getFunctionRecursionConfig(args: GetFunctionRecursionConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionRecursionConfigCommandOutput>;
    getFunctionRecursionConfig(args: GetFunctionRecursionConfigCommandInput, cb: (err: any, data?: GetFunctionRecursionConfigCommandOutput) => void): void;
    getFunctionRecursionConfig(args: GetFunctionRecursionConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionRecursionConfigCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionScalingConfigCommand}
     */
    getFunctionScalingConfig(args: GetFunctionScalingConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionScalingConfigCommandOutput>;
    getFunctionScalingConfig(args: GetFunctionScalingConfigCommandInput, cb: (err: any, data?: GetFunctionScalingConfigCommandOutput) => void): void;
    getFunctionScalingConfig(args: GetFunctionScalingConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionScalingConfigCommandOutput) => void): void;
    /**
     * @see {@link GetFunctionUrlConfigCommand}
     */
    getFunctionUrlConfig(args: GetFunctionUrlConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetFunctionUrlConfigCommandOutput>;
    getFunctionUrlConfig(args: GetFunctionUrlConfigCommandInput, cb: (err: any, data?: GetFunctionUrlConfigCommandOutput) => void): void;
    getFunctionUrlConfig(args: GetFunctionUrlConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetFunctionUrlConfigCommandOutput) => void): void;
    /**
     * @see {@link GetLatestLayerVersionInfoInternalCommand}
     */
    getLatestLayerVersionInfoInternal(args: GetLatestLayerVersionInfoInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetLatestLayerVersionInfoInternalCommandOutput>;
    getLatestLayerVersionInfoInternal(args: GetLatestLayerVersionInfoInternalCommandInput, cb: (err: any, data?: GetLatestLayerVersionInfoInternalCommandOutput) => void): void;
    getLatestLayerVersionInfoInternal(args: GetLatestLayerVersionInfoInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLatestLayerVersionInfoInternalCommandOutput) => void): void;
    /**
     * @see {@link GetLayerVersion20181031Command}
     */
    getLayerVersion20181031(args: GetLayerVersion20181031CommandInput, options?: __HttpHandlerOptions): Promise<GetLayerVersion20181031CommandOutput>;
    getLayerVersion20181031(args: GetLayerVersion20181031CommandInput, cb: (err: any, data?: GetLayerVersion20181031CommandOutput) => void): void;
    getLayerVersion20181031(args: GetLayerVersion20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLayerVersion20181031CommandOutput) => void): void;
    /**
     * @see {@link GetLayerVersionByArn20181031Command}
     */
    getLayerVersionByArn20181031(args: GetLayerVersionByArn20181031CommandInput, options?: __HttpHandlerOptions): Promise<GetLayerVersionByArn20181031CommandOutput>;
    getLayerVersionByArn20181031(args: GetLayerVersionByArn20181031CommandInput, cb: (err: any, data?: GetLayerVersionByArn20181031CommandOutput) => void): void;
    getLayerVersionByArn20181031(args: GetLayerVersionByArn20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLayerVersionByArn20181031CommandOutput) => void): void;
    /**
     * @see {@link GetLayerVersionInternalCommand}
     */
    getLayerVersionInternal(args: GetLayerVersionInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetLayerVersionInternalCommandOutput>;
    getLayerVersionInternal(args: GetLayerVersionInternalCommandInput, cb: (err: any, data?: GetLayerVersionInternalCommandOutput) => void): void;
    getLayerVersionInternal(args: GetLayerVersionInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLayerVersionInternalCommandOutput) => void): void;
    /**
     * @see {@link GetLayerVersionPolicy20181031Command}
     */
    getLayerVersionPolicy20181031(args: GetLayerVersionPolicy20181031CommandInput, options?: __HttpHandlerOptions): Promise<GetLayerVersionPolicy20181031CommandOutput>;
    getLayerVersionPolicy20181031(args: GetLayerVersionPolicy20181031CommandInput, cb: (err: any, data?: GetLayerVersionPolicy20181031CommandOutput) => void): void;
    getLayerVersionPolicy20181031(args: GetLayerVersionPolicy20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLayerVersionPolicy20181031CommandOutput) => void): void;
    /**
     * @see {@link GetLayerVersionPolicyInternalCommand}
     */
    getLayerVersionPolicyInternal(args: GetLayerVersionPolicyInternalCommandInput, options?: __HttpHandlerOptions): Promise<GetLayerVersionPolicyInternalCommandOutput>;
    getLayerVersionPolicyInternal(args: GetLayerVersionPolicyInternalCommandInput, cb: (err: any, data?: GetLayerVersionPolicyInternalCommandOutput) => void): void;
    getLayerVersionPolicyInternal(args: GetLayerVersionPolicyInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetLayerVersionPolicyInternalCommandOutput) => void): void;
    /**
     * @see {@link GetPolicy20150331Command}
     */
    getPolicy20150331(args: GetPolicy20150331CommandInput, options?: __HttpHandlerOptions): Promise<GetPolicy20150331CommandOutput>;
    getPolicy20150331(args: GetPolicy20150331CommandInput, cb: (err: any, data?: GetPolicy20150331CommandOutput) => void): void;
    getPolicy20150331(args: GetPolicy20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetPolicy20150331CommandOutput) => void): void;
    /**
     * @see {@link GetPolicy20150331v2Command}
     */
    getPolicy20150331v2(args: GetPolicy20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<GetPolicy20150331v2CommandOutput>;
    getPolicy20150331v2(args: GetPolicy20150331v2CommandInput, cb: (err: any, data?: GetPolicy20150331v2CommandOutput) => void): void;
    getPolicy20150331v2(args: GetPolicy20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetPolicy20150331v2CommandOutput) => void): void;
    /**
     * @see {@link GetProvisionedConcurrencyConfigCommand}
     */
    getProvisionedConcurrencyConfig(args: GetProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetProvisionedConcurrencyConfigCommandOutput>;
    getProvisionedConcurrencyConfig(args: GetProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: GetProvisionedConcurrencyConfigCommandOutput) => void): void;
    getProvisionedConcurrencyConfig(args: GetProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link GetPublicAccessBlockConfigCommand}
     */
    getPublicAccessBlockConfig(args: GetPublicAccessBlockConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetPublicAccessBlockConfigCommandOutput>;
    getPublicAccessBlockConfig(args: GetPublicAccessBlockConfigCommandInput, cb: (err: any, data?: GetPublicAccessBlockConfigCommandOutput) => void): void;
    getPublicAccessBlockConfig(args: GetPublicAccessBlockConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetPublicAccessBlockConfigCommandOutput) => void): void;
    /**
     * @see {@link GetResourcePolicyCommand}
     */
    getResourcePolicy(args: GetResourcePolicyCommandInput, options?: __HttpHandlerOptions): Promise<GetResourcePolicyCommandOutput>;
    getResourcePolicy(args: GetResourcePolicyCommandInput, cb: (err: any, data?: GetResourcePolicyCommandOutput) => void): void;
    getResourcePolicy(args: GetResourcePolicyCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetResourcePolicyCommandOutput) => void): void;
    /**
     * @see {@link GetRuntimeManagementConfigCommand}
     */
    getRuntimeManagementConfig(args: GetRuntimeManagementConfigCommandInput, options?: __HttpHandlerOptions): Promise<GetRuntimeManagementConfigCommandOutput>;
    getRuntimeManagementConfig(args: GetRuntimeManagementConfigCommandInput, cb: (err: any, data?: GetRuntimeManagementConfigCommandOutput) => void): void;
    getRuntimeManagementConfig(args: GetRuntimeManagementConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetRuntimeManagementConfigCommandOutput) => void): void;
    /**
     * @see {@link GetVersionProvisionedConcurrencyStatusCommand}
     */
    getVersionProvisionedConcurrencyStatus(args: GetVersionProvisionedConcurrencyStatusCommandInput, options?: __HttpHandlerOptions): Promise<GetVersionProvisionedConcurrencyStatusCommandOutput>;
    getVersionProvisionedConcurrencyStatus(args: GetVersionProvisionedConcurrencyStatusCommandInput, cb: (err: any, data?: GetVersionProvisionedConcurrencyStatusCommandOutput) => void): void;
    getVersionProvisionedConcurrencyStatus(args: GetVersionProvisionedConcurrencyStatusCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetVersionProvisionedConcurrencyStatusCommandOutput) => void): void;
    /**
     * @see {@link GetVersionSandboxSpecCommand}
     */
    getVersionSandboxSpec(args: GetVersionSandboxSpecCommandInput, options?: __HttpHandlerOptions): Promise<GetVersionSandboxSpecCommandOutput>;
    getVersionSandboxSpec(args: GetVersionSandboxSpecCommandInput, cb: (err: any, data?: GetVersionSandboxSpecCommandOutput) => void): void;
    getVersionSandboxSpec(args: GetVersionSandboxSpecCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: GetVersionSandboxSpecCommandOutput) => void): void;
    /**
     * @see {@link ImportAccountSettingsCommand}
     */
    importAccountSettings(args: ImportAccountSettingsCommandInput, options?: __HttpHandlerOptions): Promise<ImportAccountSettingsCommandOutput>;
    importAccountSettings(args: ImportAccountSettingsCommandInput, cb: (err: any, data?: ImportAccountSettingsCommandOutput) => void): void;
    importAccountSettings(args: ImportAccountSettingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportAccountSettingsCommandOutput) => void): void;
    /**
     * @see {@link ImportAliasCommand}
     */
    importAlias(args: ImportAliasCommandInput, options?: __HttpHandlerOptions): Promise<ImportAliasCommandOutput>;
    importAlias(args: ImportAliasCommandInput, cb: (err: any, data?: ImportAliasCommandOutput) => void): void;
    importAlias(args: ImportAliasCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportAliasCommandOutput) => void): void;
    /**
     * @see {@link ImportFunctionCounterCommand}
     */
    importFunctionCounter(args: ImportFunctionCounterCommandInput, options?: __HttpHandlerOptions): Promise<ImportFunctionCounterCommandOutput>;
    importFunctionCounter(args: ImportFunctionCounterCommandInput, cb: (err: any, data?: ImportFunctionCounterCommandOutput) => void): void;
    importFunctionCounter(args: ImportFunctionCounterCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportFunctionCounterCommandOutput) => void): void;
    /**
     * @see {@link ImportFunctionUrlConfigsCommand}
     */
    importFunctionUrlConfigs(args: ImportFunctionUrlConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ImportFunctionUrlConfigsCommandOutput>;
    importFunctionUrlConfigs(args: ImportFunctionUrlConfigsCommandInput, cb: (err: any, data?: ImportFunctionUrlConfigsCommandOutput) => void): void;
    importFunctionUrlConfigs(args: ImportFunctionUrlConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportFunctionUrlConfigsCommandOutput) => void): void;
    /**
     * @see {@link ImportFunctionVersionCommand}
     */
    importFunctionVersion(args: ImportFunctionVersionCommandInput, options?: __HttpHandlerOptions): Promise<ImportFunctionVersionCommandOutput>;
    importFunctionVersion(args: ImportFunctionVersionCommandInput, cb: (err: any, data?: ImportFunctionVersionCommandOutput) => void): void;
    importFunctionVersion(args: ImportFunctionVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportFunctionVersionCommandOutput) => void): void;
    /**
     * @see {@link ImportLayerVersionCommand}
     */
    importLayerVersion(args: ImportLayerVersionCommandInput, options?: __HttpHandlerOptions): Promise<ImportLayerVersionCommandOutput>;
    importLayerVersion(args: ImportLayerVersionCommandInput, cb: (err: any, data?: ImportLayerVersionCommandOutput) => void): void;
    importLayerVersion(args: ImportLayerVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportLayerVersionCommandOutput) => void): void;
    /**
     * @see {@link ImportProvisionedConcurrencyConfigCommand}
     */
    importProvisionedConcurrencyConfig(args: ImportProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<ImportProvisionedConcurrencyConfigCommandOutput>;
    importProvisionedConcurrencyConfig(args: ImportProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: ImportProvisionedConcurrencyConfigCommandOutput) => void): void;
    importProvisionedConcurrencyConfig(args: ImportProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ImportProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link InformTagrisAfterResourceCreationCommand}
     */
    informTagrisAfterResourceCreation(args: InformTagrisAfterResourceCreationCommandInput, options?: __HttpHandlerOptions): Promise<InformTagrisAfterResourceCreationCommandOutput>;
    informTagrisAfterResourceCreation(args: InformTagrisAfterResourceCreationCommandInput, cb: (err: any, data?: InformTagrisAfterResourceCreationCommandOutput) => void): void;
    informTagrisAfterResourceCreation(args: InformTagrisAfterResourceCreationCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: InformTagrisAfterResourceCreationCommandOutput) => void): void;
    /**
     * @see {@link Invoke20150331Command}
     */
    invoke20150331(args: Invoke20150331CommandInput, options?: __HttpHandlerOptions): Promise<Invoke20150331CommandOutput>;
    invoke20150331(args: Invoke20150331CommandInput, cb: (err: any, data?: Invoke20150331CommandOutput) => void): void;
    invoke20150331(args: Invoke20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: Invoke20150331CommandOutput) => void): void;
    /**
     * @see {@link InvokeAsyncCommand}
     */
    invokeAsync(args: InvokeAsyncCommandInput, options?: __HttpHandlerOptions): Promise<InvokeAsyncCommandOutput>;
    invokeAsync(args: InvokeAsyncCommandInput, cb: (err: any, data?: InvokeAsyncCommandOutput) => void): void;
    invokeAsync(args: InvokeAsyncCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: InvokeAsyncCommandOutput) => void): void;
    /**
     * @see {@link InvokeWithResponseStreamCommand}
     */
    invokeWithResponseStream(args: InvokeWithResponseStreamCommandInput, options?: __HttpHandlerOptions): Promise<InvokeWithResponseStreamCommandOutput>;
    invokeWithResponseStream(args: InvokeWithResponseStreamCommandInput, cb: (err: any, data?: InvokeWithResponseStreamCommandOutput) => void): void;
    invokeWithResponseStream(args: InvokeWithResponseStreamCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: InvokeWithResponseStreamCommandOutput) => void): void;
    /**
     * @see {@link ListAliases20150331Command}
     */
    listAliases20150331(args: ListAliases20150331CommandInput, options?: __HttpHandlerOptions): Promise<ListAliases20150331CommandOutput>;
    listAliases20150331(args: ListAliases20150331CommandInput, cb: (err: any, data?: ListAliases20150331CommandOutput) => void): void;
    listAliases20150331(args: ListAliases20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListAliases20150331CommandOutput) => void): void;
    /**
     * @see {@link ListAliasesInternalCommand}
     */
    listAliasesInternal(args: ListAliasesInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListAliasesInternalCommandOutput>;
    listAliasesInternal(args: ListAliasesInternalCommandInput, cb: (err: any, data?: ListAliasesInternalCommandOutput) => void): void;
    listAliasesInternal(args: ListAliasesInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListAliasesInternalCommandOutput) => void): void;
    /**
     * @see {@link ListCodeSigningConfigsCommand}
     */
    listCodeSigningConfigs(): Promise<ListCodeSigningConfigsCommandOutput>;
    listCodeSigningConfigs(args: ListCodeSigningConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ListCodeSigningConfigsCommandOutput>;
    listCodeSigningConfigs(args: ListCodeSigningConfigsCommandInput, cb: (err: any, data?: ListCodeSigningConfigsCommandOutput) => void): void;
    listCodeSigningConfigs(args: ListCodeSigningConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListCodeSigningConfigsCommandOutput) => void): void;
    /**
     * @see {@link ListDurableExecutionsCommand}
     */
    listDurableExecutions(): Promise<ListDurableExecutionsCommandOutput>;
    listDurableExecutions(args: ListDurableExecutionsCommandInput, options?: __HttpHandlerOptions): Promise<ListDurableExecutionsCommandOutput>;
    listDurableExecutions(args: ListDurableExecutionsCommandInput, cb: (err: any, data?: ListDurableExecutionsCommandOutput) => void): void;
    listDurableExecutions(args: ListDurableExecutionsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListDurableExecutionsCommandOutput) => void): void;
    /**
     * @see {@link ListEventSourceMappings20150331Command}
     */
    listEventSourceMappings20150331(): Promise<ListEventSourceMappings20150331CommandOutput>;
    listEventSourceMappings20150331(args: ListEventSourceMappings20150331CommandInput, options?: __HttpHandlerOptions): Promise<ListEventSourceMappings20150331CommandOutput>;
    listEventSourceMappings20150331(args: ListEventSourceMappings20150331CommandInput, cb: (err: any, data?: ListEventSourceMappings20150331CommandOutput) => void): void;
    listEventSourceMappings20150331(args: ListEventSourceMappings20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListEventSourceMappings20150331CommandOutput) => void): void;
    /**
     * @see {@link ListEventSourceMappingsInternalCommand}
     */
    listEventSourceMappingsInternal(args: ListEventSourceMappingsInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListEventSourceMappingsInternalCommandOutput>;
    listEventSourceMappingsInternal(args: ListEventSourceMappingsInternalCommandInput, cb: (err: any, data?: ListEventSourceMappingsInternalCommandOutput) => void): void;
    listEventSourceMappingsInternal(args: ListEventSourceMappingsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListEventSourceMappingsInternalCommandOutput) => void): void;
    /**
     * @see {@link ListEventSourcesCommand}
     */
    listEventSources(): Promise<ListEventSourcesCommandOutput>;
    listEventSources(args: ListEventSourcesCommandInput, options?: __HttpHandlerOptions): Promise<ListEventSourcesCommandOutput>;
    listEventSources(args: ListEventSourcesCommandInput, cb: (err: any, data?: ListEventSourcesCommandOutput) => void): void;
    listEventSources(args: ListEventSourcesCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListEventSourcesCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionAliasResourceMappingsCommand}
     */
    listFunctionAliasResourceMappings(args: ListFunctionAliasResourceMappingsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionAliasResourceMappingsCommandOutput>;
    listFunctionAliasResourceMappings(args: ListFunctionAliasResourceMappingsCommandInput, cb: (err: any, data?: ListFunctionAliasResourceMappingsCommandOutput) => void): void;
    listFunctionAliasResourceMappings(args: ListFunctionAliasResourceMappingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionAliasResourceMappingsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionCountersInternalCommand}
     */
    listFunctionCountersInternal(args: ListFunctionCountersInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionCountersInternalCommandOutput>;
    listFunctionCountersInternal(args: ListFunctionCountersInternalCommandInput, cb: (err: any, data?: ListFunctionCountersInternalCommandOutput) => void): void;
    listFunctionCountersInternal(args: ListFunctionCountersInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionCountersInternalCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionEventInvokeConfigsCommand}
     */
    listFunctionEventInvokeConfigs(args: ListFunctionEventInvokeConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionEventInvokeConfigsCommandOutput>;
    listFunctionEventInvokeConfigs(args: ListFunctionEventInvokeConfigsCommandInput, cb: (err: any, data?: ListFunctionEventInvokeConfigsCommandOutput) => void): void;
    listFunctionEventInvokeConfigs(args: ListFunctionEventInvokeConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionEventInvokeConfigsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionResourceMappingsCommand}
     */
    listFunctionResourceMappings(args: ListFunctionResourceMappingsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionResourceMappingsCommandOutput>;
    listFunctionResourceMappings(args: ListFunctionResourceMappingsCommandInput, cb: (err: any, data?: ListFunctionResourceMappingsCommandOutput) => void): void;
    listFunctionResourceMappings(args: ListFunctionResourceMappingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionResourceMappingsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionsCommand}
     */
    listFunctions(): Promise<ListFunctionsCommandOutput>;
    listFunctions(args: ListFunctionsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionsCommandOutput>;
    listFunctions(args: ListFunctionsCommandInput, cb: (err: any, data?: ListFunctionsCommandOutput) => void): void;
    listFunctions(args: ListFunctionsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctions20150331Command}
     */
    listFunctions20150331(): Promise<ListFunctions20150331CommandOutput>;
    listFunctions20150331(args: ListFunctions20150331CommandInput, options?: __HttpHandlerOptions): Promise<ListFunctions20150331CommandOutput>;
    listFunctions20150331(args: ListFunctions20150331CommandInput, cb: (err: any, data?: ListFunctions20150331CommandOutput) => void): void;
    listFunctions20150331(args: ListFunctions20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctions20150331CommandOutput) => void): void;
    /**
     * @see {@link ListFunctionsByCodeSigningConfigCommand}
     */
    listFunctionsByCodeSigningConfig(args: ListFunctionsByCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionsByCodeSigningConfigCommandOutput>;
    listFunctionsByCodeSigningConfig(args: ListFunctionsByCodeSigningConfigCommandInput, cb: (err: any, data?: ListFunctionsByCodeSigningConfigCommandOutput) => void): void;
    listFunctionsByCodeSigningConfig(args: ListFunctionsByCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionsByCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionUrlConfigsCommand}
     */
    listFunctionUrlConfigs(args: ListFunctionUrlConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionUrlConfigsCommandOutput>;
    listFunctionUrlConfigs(args: ListFunctionUrlConfigsCommandInput, cb: (err: any, data?: ListFunctionUrlConfigsCommandOutput) => void): void;
    listFunctionUrlConfigs(args: ListFunctionUrlConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionUrlConfigsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionUrlsInternalCommand}
     */
    listFunctionUrlsInternal(args: ListFunctionUrlsInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionUrlsInternalCommandOutput>;
    listFunctionUrlsInternal(args: ListFunctionUrlsInternalCommandInput, cb: (err: any, data?: ListFunctionUrlsInternalCommandOutput) => void): void;
    listFunctionUrlsInternal(args: ListFunctionUrlsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionUrlsInternalCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionVersionResourceMappingsCommand}
     */
    listFunctionVersionResourceMappings(args: ListFunctionVersionResourceMappingsCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionVersionResourceMappingsCommandOutput>;
    listFunctionVersionResourceMappings(args: ListFunctionVersionResourceMappingsCommandInput, cb: (err: any, data?: ListFunctionVersionResourceMappingsCommandOutput) => void): void;
    listFunctionVersionResourceMappings(args: ListFunctionVersionResourceMappingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionVersionResourceMappingsCommandOutput) => void): void;
    /**
     * @see {@link ListFunctionVersionsInternalCommand}
     */
    listFunctionVersionsInternal(args: ListFunctionVersionsInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListFunctionVersionsInternalCommandOutput>;
    listFunctionVersionsInternal(args: ListFunctionVersionsInternalCommandInput, cb: (err: any, data?: ListFunctionVersionsInternalCommandOutput) => void): void;
    listFunctionVersionsInternal(args: ListFunctionVersionsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListFunctionVersionsInternalCommandOutput) => void): void;
    /**
     * @see {@link ListLayers20181031Command}
     */
    listLayers20181031(): Promise<ListLayers20181031CommandOutput>;
    listLayers20181031(args: ListLayers20181031CommandInput, options?: __HttpHandlerOptions): Promise<ListLayers20181031CommandOutput>;
    listLayers20181031(args: ListLayers20181031CommandInput, cb: (err: any, data?: ListLayers20181031CommandOutput) => void): void;
    listLayers20181031(args: ListLayers20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListLayers20181031CommandOutput) => void): void;
    /**
     * @see {@link ListLayerVersions20181031Command}
     */
    listLayerVersions20181031(args: ListLayerVersions20181031CommandInput, options?: __HttpHandlerOptions): Promise<ListLayerVersions20181031CommandOutput>;
    listLayerVersions20181031(args: ListLayerVersions20181031CommandInput, cb: (err: any, data?: ListLayerVersions20181031CommandOutput) => void): void;
    listLayerVersions20181031(args: ListLayerVersions20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListLayerVersions20181031CommandOutput) => void): void;
    /**
     * @see {@link ListLayerVersionsInternalCommand}
     */
    listLayerVersionsInternal(args: ListLayerVersionsInternalCommandInput, options?: __HttpHandlerOptions): Promise<ListLayerVersionsInternalCommandOutput>;
    listLayerVersionsInternal(args: ListLayerVersionsInternalCommandInput, cb: (err: any, data?: ListLayerVersionsInternalCommandOutput) => void): void;
    listLayerVersionsInternal(args: ListLayerVersionsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListLayerVersionsInternalCommandOutput) => void): void;
    /**
     * @see {@link ListProvisionedConcurrencyConfigsCommand}
     */
    listProvisionedConcurrencyConfigs(args: ListProvisionedConcurrencyConfigsCommandInput, options?: __HttpHandlerOptions): Promise<ListProvisionedConcurrencyConfigsCommandOutput>;
    listProvisionedConcurrencyConfigs(args: ListProvisionedConcurrencyConfigsCommandInput, cb: (err: any, data?: ListProvisionedConcurrencyConfigsCommandOutput) => void): void;
    listProvisionedConcurrencyConfigs(args: ListProvisionedConcurrencyConfigsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListProvisionedConcurrencyConfigsCommandOutput) => void): void;
    /**
     * @see {@link ListProvisionedConcurrencyConfigsByAccountIdCommand}
     */
    listProvisionedConcurrencyConfigsByAccountId(args: ListProvisionedConcurrencyConfigsByAccountIdCommandInput, options?: __HttpHandlerOptions): Promise<ListProvisionedConcurrencyConfigsByAccountIdCommandOutput>;
    listProvisionedConcurrencyConfigsByAccountId(args: ListProvisionedConcurrencyConfigsByAccountIdCommandInput, cb: (err: any, data?: ListProvisionedConcurrencyConfigsByAccountIdCommandOutput) => void): void;
    listProvisionedConcurrencyConfigsByAccountId(args: ListProvisionedConcurrencyConfigsByAccountIdCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListProvisionedConcurrencyConfigsByAccountIdCommandOutput) => void): void;
    /**
     * @see {@link ListTags20170331Command}
     */
    listTags20170331(args: ListTags20170331CommandInput, options?: __HttpHandlerOptions): Promise<ListTags20170331CommandOutput>;
    listTags20170331(args: ListTags20170331CommandInput, cb: (err: any, data?: ListTags20170331CommandOutput) => void): void;
    listTags20170331(args: ListTags20170331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListTags20170331CommandOutput) => void): void;
    /**
     * @see {@link ListVersionsByFunction20150331Command}
     */
    listVersionsByFunction20150331(args: ListVersionsByFunction20150331CommandInput, options?: __HttpHandlerOptions): Promise<ListVersionsByFunction20150331CommandOutput>;
    listVersionsByFunction20150331(args: ListVersionsByFunction20150331CommandInput, cb: (err: any, data?: ListVersionsByFunction20150331CommandOutput) => void): void;
    listVersionsByFunction20150331(args: ListVersionsByFunction20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ListVersionsByFunction20150331CommandOutput) => void): void;
    /**
     * @see {@link PublishLayerVersion20181031Command}
     */
    publishLayerVersion20181031(args: PublishLayerVersion20181031CommandInput, options?: __HttpHandlerOptions): Promise<PublishLayerVersion20181031CommandOutput>;
    publishLayerVersion20181031(args: PublishLayerVersion20181031CommandInput, cb: (err: any, data?: PublishLayerVersion20181031CommandOutput) => void): void;
    publishLayerVersion20181031(args: PublishLayerVersion20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PublishLayerVersion20181031CommandOutput) => void): void;
    /**
     * @see {@link PublishVersion20150331Command}
     */
    publishVersion20150331(args: PublishVersion20150331CommandInput, options?: __HttpHandlerOptions): Promise<PublishVersion20150331CommandOutput>;
    publishVersion20150331(args: PublishVersion20150331CommandInput, cb: (err: any, data?: PublishVersion20150331CommandOutput) => void): void;
    publishVersion20150331(args: PublishVersion20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PublishVersion20150331CommandOutput) => void): void;
    /**
     * @see {@link PutFunctionAliasResourceMappingCommand}
     */
    putFunctionAliasResourceMapping(args: PutFunctionAliasResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionAliasResourceMappingCommandOutput>;
    putFunctionAliasResourceMapping(args: PutFunctionAliasResourceMappingCommandInput, cb: (err: any, data?: PutFunctionAliasResourceMappingCommandOutput) => void): void;
    putFunctionAliasResourceMapping(args: PutFunctionAliasResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionAliasResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionCodeSigningConfigCommand}
     */
    putFunctionCodeSigningConfig(args: PutFunctionCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionCodeSigningConfigCommandOutput>;
    putFunctionCodeSigningConfig(args: PutFunctionCodeSigningConfigCommandInput, cb: (err: any, data?: PutFunctionCodeSigningConfigCommandOutput) => void): void;
    putFunctionCodeSigningConfig(args: PutFunctionCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionConcurrency20171031Command}
     */
    putFunctionConcurrency20171031(args: PutFunctionConcurrency20171031CommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionConcurrency20171031CommandOutput>;
    putFunctionConcurrency20171031(args: PutFunctionConcurrency20171031CommandInput, cb: (err: any, data?: PutFunctionConcurrency20171031CommandOutput) => void): void;
    putFunctionConcurrency20171031(args: PutFunctionConcurrency20171031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionConcurrency20171031CommandOutput) => void): void;
    /**
     * @see {@link PutFunctionEventInvokeConfigCommand}
     */
    putFunctionEventInvokeConfig(args: PutFunctionEventInvokeConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionEventInvokeConfigCommandOutput>;
    putFunctionEventInvokeConfig(args: PutFunctionEventInvokeConfigCommandInput, cb: (err: any, data?: PutFunctionEventInvokeConfigCommandOutput) => void): void;
    putFunctionEventInvokeConfig(args: PutFunctionEventInvokeConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionEventInvokeConfigCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionRecursionConfigCommand}
     */
    putFunctionRecursionConfig(args: PutFunctionRecursionConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionRecursionConfigCommandOutput>;
    putFunctionRecursionConfig(args: PutFunctionRecursionConfigCommandInput, cb: (err: any, data?: PutFunctionRecursionConfigCommandOutput) => void): void;
    putFunctionRecursionConfig(args: PutFunctionRecursionConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionRecursionConfigCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionResourceMappingCommand}
     */
    putFunctionResourceMapping(args: PutFunctionResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionResourceMappingCommandOutput>;
    putFunctionResourceMapping(args: PutFunctionResourceMappingCommandInput, cb: (err: any, data?: PutFunctionResourceMappingCommandOutput) => void): void;
    putFunctionResourceMapping(args: PutFunctionResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionScalingConfigCommand}
     */
    putFunctionScalingConfig(args: PutFunctionScalingConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionScalingConfigCommandOutput>;
    putFunctionScalingConfig(args: PutFunctionScalingConfigCommandInput, cb: (err: any, data?: PutFunctionScalingConfigCommandOutput) => void): void;
    putFunctionScalingConfig(args: PutFunctionScalingConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionScalingConfigCommandOutput) => void): void;
    /**
     * @see {@link PutFunctionVersionResourceMappingCommand}
     */
    putFunctionVersionResourceMapping(args: PutFunctionVersionResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<PutFunctionVersionResourceMappingCommandOutput>;
    putFunctionVersionResourceMapping(args: PutFunctionVersionResourceMappingCommandInput, cb: (err: any, data?: PutFunctionVersionResourceMappingCommandOutput) => void): void;
    putFunctionVersionResourceMapping(args: PutFunctionVersionResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutFunctionVersionResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link PutProvisionedConcurrencyConfigCommand}
     */
    putProvisionedConcurrencyConfig(args: PutProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutProvisionedConcurrencyConfigCommandOutput>;
    putProvisionedConcurrencyConfig(args: PutProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: PutProvisionedConcurrencyConfigCommandOutput) => void): void;
    putProvisionedConcurrencyConfig(args: PutProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link PutPublicAccessBlockConfigCommand}
     */
    putPublicAccessBlockConfig(args: PutPublicAccessBlockConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutPublicAccessBlockConfigCommandOutput>;
    putPublicAccessBlockConfig(args: PutPublicAccessBlockConfigCommandInput, cb: (err: any, data?: PutPublicAccessBlockConfigCommandOutput) => void): void;
    putPublicAccessBlockConfig(args: PutPublicAccessBlockConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutPublicAccessBlockConfigCommandOutput) => void): void;
    /**
     * @see {@link PutResourcePolicyCommand}
     */
    putResourcePolicy(args: PutResourcePolicyCommandInput, options?: __HttpHandlerOptions): Promise<PutResourcePolicyCommandOutput>;
    putResourcePolicy(args: PutResourcePolicyCommandInput, cb: (err: any, data?: PutResourcePolicyCommandOutput) => void): void;
    putResourcePolicy(args: PutResourcePolicyCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutResourcePolicyCommandOutput) => void): void;
    /**
     * @see {@link PutRuntimeManagementConfigCommand}
     */
    putRuntimeManagementConfig(args: PutRuntimeManagementConfigCommandInput, options?: __HttpHandlerOptions): Promise<PutRuntimeManagementConfigCommandOutput>;
    putRuntimeManagementConfig(args: PutRuntimeManagementConfigCommandInput, cb: (err: any, data?: PutRuntimeManagementConfigCommandOutput) => void): void;
    putRuntimeManagementConfig(args: PutRuntimeManagementConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: PutRuntimeManagementConfigCommandOutput) => void): void;
    /**
     * @see {@link ReconcileProvisionedConcurrencyCommand}
     */
    reconcileProvisionedConcurrency(args: ReconcileProvisionedConcurrencyCommandInput, options?: __HttpHandlerOptions): Promise<ReconcileProvisionedConcurrencyCommandOutput>;
    reconcileProvisionedConcurrency(args: ReconcileProvisionedConcurrencyCommandInput, cb: (err: any, data?: ReconcileProvisionedConcurrencyCommandOutput) => void): void;
    reconcileProvisionedConcurrency(args: ReconcileProvisionedConcurrencyCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ReconcileProvisionedConcurrencyCommandOutput) => void): void;
    /**
     * @see {@link RedriveFunctionResourceTagsCommand}
     */
    redriveFunctionResourceTags(args: RedriveFunctionResourceTagsCommandInput, options?: __HttpHandlerOptions): Promise<RedriveFunctionResourceTagsCommandOutput>;
    redriveFunctionResourceTags(args: RedriveFunctionResourceTagsCommandInput, cb: (err: any, data?: RedriveFunctionResourceTagsCommandOutput) => void): void;
    redriveFunctionResourceTags(args: RedriveFunctionResourceTagsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RedriveFunctionResourceTagsCommandOutput) => void): void;
    /**
     * @see {@link RemoveEventSourceCommand}
     */
    removeEventSource(args: RemoveEventSourceCommandInput, options?: __HttpHandlerOptions): Promise<RemoveEventSourceCommandOutput>;
    removeEventSource(args: RemoveEventSourceCommandInput, cb: (err: any, data?: RemoveEventSourceCommandOutput) => void): void;
    removeEventSource(args: RemoveEventSourceCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RemoveEventSourceCommandOutput) => void): void;
    /**
     * @see {@link RemoveLayerVersionPermission20181031Command}
     */
    removeLayerVersionPermission20181031(args: RemoveLayerVersionPermission20181031CommandInput, options?: __HttpHandlerOptions): Promise<RemoveLayerVersionPermission20181031CommandOutput>;
    removeLayerVersionPermission20181031(args: RemoveLayerVersionPermission20181031CommandInput, cb: (err: any, data?: RemoveLayerVersionPermission20181031CommandOutput) => void): void;
    removeLayerVersionPermission20181031(args: RemoveLayerVersionPermission20181031CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RemoveLayerVersionPermission20181031CommandOutput) => void): void;
    /**
     * @see {@link RemovePermission20150331Command}
     */
    removePermission20150331(args: RemovePermission20150331CommandInput, options?: __HttpHandlerOptions): Promise<RemovePermission20150331CommandOutput>;
    removePermission20150331(args: RemovePermission20150331CommandInput, cb: (err: any, data?: RemovePermission20150331CommandOutput) => void): void;
    removePermission20150331(args: RemovePermission20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RemovePermission20150331CommandOutput) => void): void;
    /**
     * @see {@link RemovePermission20150331v2Command}
     */
    removePermission20150331v2(args: RemovePermission20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<RemovePermission20150331v2CommandOutput>;
    removePermission20150331v2(args: RemovePermission20150331v2CommandInput, cb: (err: any, data?: RemovePermission20150331v2CommandOutput) => void): void;
    removePermission20150331v2(args: RemovePermission20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RemovePermission20150331v2CommandOutput) => void): void;
    /**
     * @see {@link ResetFunctionFeatureInternalCommand}
     */
    resetFunctionFeatureInternal(args: ResetFunctionFeatureInternalCommandInput, options?: __HttpHandlerOptions): Promise<ResetFunctionFeatureInternalCommandOutput>;
    resetFunctionFeatureInternal(args: ResetFunctionFeatureInternalCommandInput, cb: (err: any, data?: ResetFunctionFeatureInternalCommandOutput) => void): void;
    resetFunctionFeatureInternal(args: ResetFunctionFeatureInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ResetFunctionFeatureInternalCommandOutput) => void): void;
    /**
     * @see {@link ResignFunctionAliasCommand}
     */
    resignFunctionAlias(args: ResignFunctionAliasCommandInput, options?: __HttpHandlerOptions): Promise<ResignFunctionAliasCommandOutput>;
    resignFunctionAlias(args: ResignFunctionAliasCommandInput, cb: (err: any, data?: ResignFunctionAliasCommandOutput) => void): void;
    resignFunctionAlias(args: ResignFunctionAliasCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ResignFunctionAliasCommandOutput) => void): void;
    /**
     * @see {@link ResignFunctionVersionCommand}
     */
    resignFunctionVersion(args: ResignFunctionVersionCommandInput, options?: __HttpHandlerOptions): Promise<ResignFunctionVersionCommandOutput>;
    resignFunctionVersion(args: ResignFunctionVersionCommandInput, cb: (err: any, data?: ResignFunctionVersionCommandOutput) => void): void;
    resignFunctionVersion(args: ResignFunctionVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ResignFunctionVersionCommandOutput) => void): void;
    /**
     * @see {@link RollbackFunctionCommand}
     */
    rollbackFunction(args: RollbackFunctionCommandInput, options?: __HttpHandlerOptions): Promise<RollbackFunctionCommandOutput>;
    rollbackFunction(args: RollbackFunctionCommandInput, cb: (err: any, data?: RollbackFunctionCommandOutput) => void): void;
    rollbackFunction(args: RollbackFunctionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RollbackFunctionCommandOutput) => void): void;
    /**
     * @see {@link RollbackTagsOwnershipFromLambdaCommand}
     */
    rollbackTagsOwnershipFromLambda(args: RollbackTagsOwnershipFromLambdaCommandInput, options?: __HttpHandlerOptions): Promise<RollbackTagsOwnershipFromLambdaCommandOutput>;
    rollbackTagsOwnershipFromLambda(args: RollbackTagsOwnershipFromLambdaCommandInput, cb: (err: any, data?: RollbackTagsOwnershipFromLambdaCommandOutput) => void): void;
    rollbackTagsOwnershipFromLambda(args: RollbackTagsOwnershipFromLambdaCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: RollbackTagsOwnershipFromLambdaCommandOutput) => void): void;
    /**
     * @see {@link SafeDeleteProvisionedConcurrencyConfigCommand}
     */
    safeDeleteProvisionedConcurrencyConfig(args: SafeDeleteProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<SafeDeleteProvisionedConcurrencyConfigCommandOutput>;
    safeDeleteProvisionedConcurrencyConfig(args: SafeDeleteProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: SafeDeleteProvisionedConcurrencyConfigCommandOutput) => void): void;
    safeDeleteProvisionedConcurrencyConfig(args: SafeDeleteProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SafeDeleteProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link SendDurableExecutionCallbackFailureCommand}
     */
    sendDurableExecutionCallbackFailure(args: SendDurableExecutionCallbackFailureCommandInput, options?: __HttpHandlerOptions): Promise<SendDurableExecutionCallbackFailureCommandOutput>;
    sendDurableExecutionCallbackFailure(args: SendDurableExecutionCallbackFailureCommandInput, cb: (err: any, data?: SendDurableExecutionCallbackFailureCommandOutput) => void): void;
    sendDurableExecutionCallbackFailure(args: SendDurableExecutionCallbackFailureCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SendDurableExecutionCallbackFailureCommandOutput) => void): void;
    /**
     * @see {@link SendDurableExecutionCallbackHeartbeatCommand}
     */
    sendDurableExecutionCallbackHeartbeat(args: SendDurableExecutionCallbackHeartbeatCommandInput, options?: __HttpHandlerOptions): Promise<SendDurableExecutionCallbackHeartbeatCommandOutput>;
    sendDurableExecutionCallbackHeartbeat(args: SendDurableExecutionCallbackHeartbeatCommandInput, cb: (err: any, data?: SendDurableExecutionCallbackHeartbeatCommandOutput) => void): void;
    sendDurableExecutionCallbackHeartbeat(args: SendDurableExecutionCallbackHeartbeatCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SendDurableExecutionCallbackHeartbeatCommandOutput) => void): void;
    /**
     * @see {@link SendDurableExecutionCallbackSuccessCommand}
     */
    sendDurableExecutionCallbackSuccess(args: SendDurableExecutionCallbackSuccessCommandInput, options?: __HttpHandlerOptions): Promise<SendDurableExecutionCallbackSuccessCommandOutput>;
    sendDurableExecutionCallbackSuccess(args: SendDurableExecutionCallbackSuccessCommandInput, cb: (err: any, data?: SendDurableExecutionCallbackSuccessCommandOutput) => void): void;
    sendDurableExecutionCallbackSuccess(args: SendDurableExecutionCallbackSuccessCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SendDurableExecutionCallbackSuccessCommandOutput) => void): void;
    /**
     * @see {@link SetAccountRiskSettingsCommand}
     */
    setAccountRiskSettings(args: SetAccountRiskSettingsCommandInput, options?: __HttpHandlerOptions): Promise<SetAccountRiskSettingsCommandOutput>;
    setAccountRiskSettings(args: SetAccountRiskSettingsCommandInput, cb: (err: any, data?: SetAccountRiskSettingsCommandOutput) => void): void;
    setAccountRiskSettings(args: SetAccountRiskSettingsCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SetAccountRiskSettingsCommandOutput) => void): void;
    /**
     * @see {@link SetAccountSettings20170430Command}
     */
    setAccountSettings20170430(): Promise<SetAccountSettings20170430CommandOutput>;
    setAccountSettings20170430(args: SetAccountSettings20170430CommandInput, options?: __HttpHandlerOptions): Promise<SetAccountSettings20170430CommandOutput>;
    setAccountSettings20170430(args: SetAccountSettings20170430CommandInput, cb: (err: any, data?: SetAccountSettings20170430CommandOutput) => void): void;
    setAccountSettings20170430(args: SetAccountSettings20170430CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: SetAccountSettings20170430CommandOutput) => void): void;
    /**
     * @see {@link StopDurableExecutionCommand}
     */
    stopDurableExecution(args: StopDurableExecutionCommandInput, options?: __HttpHandlerOptions): Promise<StopDurableExecutionCommandOutput>;
    stopDurableExecution(args: StopDurableExecutionCommandInput, cb: (err: any, data?: StopDurableExecutionCommandOutput) => void): void;
    stopDurableExecution(args: StopDurableExecutionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: StopDurableExecutionCommandOutput) => void): void;
    /**
     * @see {@link TagResource20170331Command}
     */
    tagResource20170331(args: TagResource20170331CommandInput, options?: __HttpHandlerOptions): Promise<TagResource20170331CommandOutput>;
    tagResource20170331(args: TagResource20170331CommandInput, cb: (err: any, data?: TagResource20170331CommandOutput) => void): void;
    tagResource20170331(args: TagResource20170331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: TagResource20170331CommandOutput) => void): void;
    /**
     * @see {@link TagResource20170331v2Command}
     */
    tagResource20170331v2(args: TagResource20170331v2CommandInput, options?: __HttpHandlerOptions): Promise<TagResource20170331v2CommandOutput>;
    tagResource20170331v2(args: TagResource20170331v2CommandInput, cb: (err: any, data?: TagResource20170331v2CommandOutput) => void): void;
    tagResource20170331v2(args: TagResource20170331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: TagResource20170331v2CommandOutput) => void): void;
    /**
     * @see {@link TagResourceBeforeResourceCreationCommand}
     */
    tagResourceBeforeResourceCreation(args: TagResourceBeforeResourceCreationCommandInput, options?: __HttpHandlerOptions): Promise<TagResourceBeforeResourceCreationCommandOutput>;
    tagResourceBeforeResourceCreation(args: TagResourceBeforeResourceCreationCommandInput, cb: (err: any, data?: TagResourceBeforeResourceCreationCommandOutput) => void): void;
    tagResourceBeforeResourceCreation(args: TagResourceBeforeResourceCreationCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: TagResourceBeforeResourceCreationCommandOutput) => void): void;
    /**
     * @see {@link TransferTagsOwnershipToLambdaCommand}
     */
    transferTagsOwnershipToLambda(args: TransferTagsOwnershipToLambdaCommandInput, options?: __HttpHandlerOptions): Promise<TransferTagsOwnershipToLambdaCommandOutput>;
    transferTagsOwnershipToLambda(args: TransferTagsOwnershipToLambdaCommandInput, cb: (err: any, data?: TransferTagsOwnershipToLambdaCommandOutput) => void): void;
    transferTagsOwnershipToLambda(args: TransferTagsOwnershipToLambdaCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: TransferTagsOwnershipToLambdaCommandOutput) => void): void;
    /**
     * @see {@link UntagResource20170331Command}
     */
    untagResource20170331(args: UntagResource20170331CommandInput, options?: __HttpHandlerOptions): Promise<UntagResource20170331CommandOutput>;
    untagResource20170331(args: UntagResource20170331CommandInput, cb: (err: any, data?: UntagResource20170331CommandOutput) => void): void;
    untagResource20170331(args: UntagResource20170331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UntagResource20170331CommandOutput) => void): void;
    /**
     * @see {@link UntagResource20170331v2Command}
     */
    untagResource20170331v2(args: UntagResource20170331v2CommandInput, options?: __HttpHandlerOptions): Promise<UntagResource20170331v2CommandOutput>;
    untagResource20170331v2(args: UntagResource20170331v2CommandInput, cb: (err: any, data?: UntagResource20170331v2CommandOutput) => void): void;
    untagResource20170331v2(args: UntagResource20170331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UntagResource20170331v2CommandOutput) => void): void;
    /**
     * @see {@link UpdateAccountSettingsInternalCommand}
     */
    updateAccountSettingsInternal(args: UpdateAccountSettingsInternalCommandInput, options?: __HttpHandlerOptions): Promise<UpdateAccountSettingsInternalCommandOutput>;
    updateAccountSettingsInternal(args: UpdateAccountSettingsInternalCommandInput, cb: (err: any, data?: UpdateAccountSettingsInternalCommandOutput) => void): void;
    updateAccountSettingsInternal(args: UpdateAccountSettingsInternalCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateAccountSettingsInternalCommandOutput) => void): void;
    /**
     * @see {@link UpdateAlias20150331Command}
     */
    updateAlias20150331(args: UpdateAlias20150331CommandInput, options?: __HttpHandlerOptions): Promise<UpdateAlias20150331CommandOutput>;
    updateAlias20150331(args: UpdateAlias20150331CommandInput, cb: (err: any, data?: UpdateAlias20150331CommandOutput) => void): void;
    updateAlias20150331(args: UpdateAlias20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateAlias20150331CommandOutput) => void): void;
    /**
     * @see {@link UpdateCodeSigningConfigCommand}
     */
    updateCodeSigningConfig(args: UpdateCodeSigningConfigCommandInput, options?: __HttpHandlerOptions): Promise<UpdateCodeSigningConfigCommandOutput>;
    updateCodeSigningConfig(args: UpdateCodeSigningConfigCommandInput, cb: (err: any, data?: UpdateCodeSigningConfigCommandOutput) => void): void;
    updateCodeSigningConfig(args: UpdateCodeSigningConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateCodeSigningConfigCommandOutput) => void): void;
    /**
     * @see {@link UpdateConcurrencyInProvisionedConcurrencyConfigCommand}
     */
    updateConcurrencyInProvisionedConcurrencyConfig(args: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput>;
    updateConcurrencyInProvisionedConcurrencyConfig(args: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput) => void): void;
    updateConcurrencyInProvisionedConcurrencyConfig(args: UpdateConcurrencyInProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateConcurrencyInProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link UpdateEventSourceMapping20150331Command}
     */
    updateEventSourceMapping20150331(args: UpdateEventSourceMapping20150331CommandInput, options?: __HttpHandlerOptions): Promise<UpdateEventSourceMapping20150331CommandOutput>;
    updateEventSourceMapping20150331(args: UpdateEventSourceMapping20150331CommandInput, cb: (err: any, data?: UpdateEventSourceMapping20150331CommandOutput) => void): void;
    updateEventSourceMapping20150331(args: UpdateEventSourceMapping20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateEventSourceMapping20150331CommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionCodeCommand}
     */
    updateFunctionCode(args: UpdateFunctionCodeCommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionCodeCommandOutput>;
    updateFunctionCode(args: UpdateFunctionCodeCommandInput, cb: (err: any, data?: UpdateFunctionCodeCommandOutput) => void): void;
    updateFunctionCode(args: UpdateFunctionCodeCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionCodeCommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionCode20150331Command}
     */
    updateFunctionCode20150331(args: UpdateFunctionCode20150331CommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionCode20150331CommandOutput>;
    updateFunctionCode20150331(args: UpdateFunctionCode20150331CommandInput, cb: (err: any, data?: UpdateFunctionCode20150331CommandOutput) => void): void;
    updateFunctionCode20150331(args: UpdateFunctionCode20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionCode20150331CommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionCode20150331v2Command}
     */
    updateFunctionCode20150331v2(args: UpdateFunctionCode20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionCode20150331v2CommandOutput>;
    updateFunctionCode20150331v2(args: UpdateFunctionCode20150331v2CommandInput, cb: (err: any, data?: UpdateFunctionCode20150331v2CommandOutput) => void): void;
    updateFunctionCode20150331v2(args: UpdateFunctionCode20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionCode20150331v2CommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionConfigurationCommand}
     */
    updateFunctionConfiguration(args: UpdateFunctionConfigurationCommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionConfigurationCommandOutput>;
    updateFunctionConfiguration(args: UpdateFunctionConfigurationCommandInput, cb: (err: any, data?: UpdateFunctionConfigurationCommandOutput) => void): void;
    updateFunctionConfiguration(args: UpdateFunctionConfigurationCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionConfigurationCommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionConfiguration20150331Command}
     */
    updateFunctionConfiguration20150331(args: UpdateFunctionConfiguration20150331CommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionConfiguration20150331CommandOutput>;
    updateFunctionConfiguration20150331(args: UpdateFunctionConfiguration20150331CommandInput, cb: (err: any, data?: UpdateFunctionConfiguration20150331CommandOutput) => void): void;
    updateFunctionConfiguration20150331(args: UpdateFunctionConfiguration20150331CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionConfiguration20150331CommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionConfiguration20150331v2Command}
     */
    updateFunctionConfiguration20150331v2(args: UpdateFunctionConfiguration20150331v2CommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionConfiguration20150331v2CommandOutput>;
    updateFunctionConfiguration20150331v2(args: UpdateFunctionConfiguration20150331v2CommandInput, cb: (err: any, data?: UpdateFunctionConfiguration20150331v2CommandOutput) => void): void;
    updateFunctionConfiguration20150331v2(args: UpdateFunctionConfiguration20150331v2CommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionConfiguration20150331v2CommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionEventInvokeConfigCommand}
     */
    updateFunctionEventInvokeConfig(args: UpdateFunctionEventInvokeConfigCommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionEventInvokeConfigCommandOutput>;
    updateFunctionEventInvokeConfig(args: UpdateFunctionEventInvokeConfigCommandInput, cb: (err: any, data?: UpdateFunctionEventInvokeConfigCommandOutput) => void): void;
    updateFunctionEventInvokeConfig(args: UpdateFunctionEventInvokeConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionEventInvokeConfigCommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionUrlConfigCommand}
     */
    updateFunctionUrlConfig(args: UpdateFunctionUrlConfigCommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionUrlConfigCommandOutput>;
    updateFunctionUrlConfig(args: UpdateFunctionUrlConfigCommandInput, cb: (err: any, data?: UpdateFunctionUrlConfigCommandOutput) => void): void;
    updateFunctionUrlConfig(args: UpdateFunctionUrlConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionUrlConfigCommandOutput) => void): void;
    /**
     * @see {@link UpdateFunctionVersionResourceMappingCommand}
     */
    updateFunctionVersionResourceMapping(args: UpdateFunctionVersionResourceMappingCommandInput, options?: __HttpHandlerOptions): Promise<UpdateFunctionVersionResourceMappingCommandOutput>;
    updateFunctionVersionResourceMapping(args: UpdateFunctionVersionResourceMappingCommandInput, cb: (err: any, data?: UpdateFunctionVersionResourceMappingCommandOutput) => void): void;
    updateFunctionVersionResourceMapping(args: UpdateFunctionVersionResourceMappingCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateFunctionVersionResourceMappingCommandOutput) => void): void;
    /**
     * @see {@link UpdateProvisionedConcurrencyConfigCommand}
     */
    updateProvisionedConcurrencyConfig(args: UpdateProvisionedConcurrencyConfigCommandInput, options?: __HttpHandlerOptions): Promise<UpdateProvisionedConcurrencyConfigCommandOutput>;
    updateProvisionedConcurrencyConfig(args: UpdateProvisionedConcurrencyConfigCommandInput, cb: (err: any, data?: UpdateProvisionedConcurrencyConfigCommandOutput) => void): void;
    updateProvisionedConcurrencyConfig(args: UpdateProvisionedConcurrencyConfigCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateProvisionedConcurrencyConfigCommandOutput) => void): void;
    /**
     * @see {@link UpdateVersionProvisionedConcurrencyStatusCommand}
     */
    updateVersionProvisionedConcurrencyStatus(args: UpdateVersionProvisionedConcurrencyStatusCommandInput, options?: __HttpHandlerOptions): Promise<UpdateVersionProvisionedConcurrencyStatusCommandOutput>;
    updateVersionProvisionedConcurrencyStatus(args: UpdateVersionProvisionedConcurrencyStatusCommandInput, cb: (err: any, data?: UpdateVersionProvisionedConcurrencyStatusCommandOutput) => void): void;
    updateVersionProvisionedConcurrencyStatus(args: UpdateVersionProvisionedConcurrencyStatusCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UpdateVersionProvisionedConcurrencyStatusCommandOutput) => void): void;
    /**
     * @see {@link UploadFunctionCommand}
     */
    uploadFunction(args: UploadFunctionCommandInput, options?: __HttpHandlerOptions): Promise<UploadFunctionCommandOutput>;
    uploadFunction(args: UploadFunctionCommandInput, cb: (err: any, data?: UploadFunctionCommandOutput) => void): void;
    uploadFunction(args: UploadFunctionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: UploadFunctionCommandOutput) => void): void;
    /**
     * @see {@link ValidateProvisionedConcurrencyFunctionVersionCommand}
     */
    validateProvisionedConcurrencyFunctionVersion(args: ValidateProvisionedConcurrencyFunctionVersionCommandInput, options?: __HttpHandlerOptions): Promise<ValidateProvisionedConcurrencyFunctionVersionCommandOutput>;
    validateProvisionedConcurrencyFunctionVersion(args: ValidateProvisionedConcurrencyFunctionVersionCommandInput, cb: (err: any, data?: ValidateProvisionedConcurrencyFunctionVersionCommandOutput) => void): void;
    validateProvisionedConcurrencyFunctionVersion(args: ValidateProvisionedConcurrencyFunctionVersionCommandInput, options: __HttpHandlerOptions, cb: (err: any, data?: ValidateProvisionedConcurrencyFunctionVersionCommandOutput) => void): void;
}
/**
 * AWS Gir API Service
 *     - currently support GET/POST/PUT/DELETE for the Invoke API
 * @public
 */
export declare class Lambda extends LambdaClient implements Lambda {
}
