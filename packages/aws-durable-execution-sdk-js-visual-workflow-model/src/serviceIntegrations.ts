/**
 * Registry of AWS "Run a Job" service integrations (the Step Functions `.sync`
 * pattern): start an asynchronous job, then poll a describe/get API until it
 * reaches a terminal status. One `awsJob` node references a preset by `key`; the
 * CDK generator expands it into a `step` (start) + `waitForCondition` (poll),
 * and the Studio renders one palette entry per preset under the "Jobs" section.
 *
 * Adding a service = adding one entry here (+ a codegen/permission test). No new
 * node kinds or code paths.
 */

/** How to start the job and where to find its identifier in the start result. */
export interface JobStartSpec {
  /** AWS SDK v3 command class, e.g. `StartJobRunCommand`. */
  command: string;
  /**
   * Property-access suffix into the start result that yields the job id, e.g.
   * `JobRunId`, `build.id`, `tasks[0].taskArn`. Emitted as `started.<idPath>`.
   */
  idPath: string;
}

/** How to poll for completion and read the job status. */
export interface JobPollSpec {
  /** AWS SDK v3 command class, e.g. `GetJobRunCommand`. */
  command: string;
  /**
   * JS expression (a string) for the poll command input. In scope: `startInput`
   * (the start command input) and `jobId`. E.g.
   * `{ JobName: startInput.JobName, RunId: jobId }`.
   */
  inputExpr: string;
  /**
   * Property-access suffix into the poll result that yields the status, e.g.
   * `JobRun.JobRunState`. Emitted as `res.<statusPath>`.
   */
  statusPath: string;
  /**
   * Optional property-access suffix for the value the node returns on success.
   * Defaults to the whole poll result when omitted.
   */
  resultPath?: string;
}

/** A resource kind a `resource` param can be picked from (live account lookup). */
export type ResourceKind =
  | "glueJob"
  | "batchJobQueue"
  | "batchJobDefinition"
  | "codebuildProject"
  | "stateMachineArn"
  | "ecsCluster"
  | "ecsTaskDefinition";

/** The editor control for a start-input parameter. */
export type JobParamType = "string" | "text" | "number" | "json" | "resource";

/** One structured field of an integration's start input. */
export interface JobParamField {
  /** Key in the start-input object, e.g. "JobName". */
  name: string;
  /** Human label, e.g. "Glue job name". */
  label: string;
  type: JobParamType;
  required?: boolean;
  description?: string;
  placeholder?: string;
  /** For `type: "resource"` — which account resource to pick from (Phase 2). */
  resource?: ResourceKind;
}

/** One "Run a Job" service integration preset. */
export interface ServiceIntegration {
  /** Stable registry key, `<service>.<startOperation>`. */
  key: string;
  /** Human label for the palette / inspector, e.g. "AWS Glue — Start Job Run". */
  label: string;
  /** Short palette label, e.g. "Glue Job". */
  shortLabel: string;
  /** IAM service prefix + `@aws-sdk/client-<service>` suffix, e.g. `glue`. */
  service: string;
  /** AWS SDK v3 client package, e.g. `@aws-sdk/client-glue`. */
  clientPackage: string;
  /** AWS SDK v3 client class, e.g. `GlueClient`. */
  clientClass: string;
  start: JobStartSpec;
  poll: JobPollSpec;
  /** Structured start-input fields (drives the inspector form; optional). */
  startParams?: JobParamField[];
  /** Terminal statuses meaning success. */
  success: string[];
  /** Terminal statuses meaning failure (node throws). */
  failure: string[];
  /** The status the polling state is seeded with before the first poll. */
  initialStatus: string;
  /** Default seconds between polls (overridable per node). */
  defaultPollSeconds: number;
  /** Conservative upper bound (seconds) used for execution-timeout inference. */
  maxWaitSeconds: number;
  /** IAM actions the node needs (start + poll, plus any extras). */
  iamActions: string[];
  /** Optional caveats (special endpoints, extra permissions, …). */
  notes?: string;
}

/**
 * The preset registry. Tier-1 services are added here; further services are
 * appended one at a time (see docs/workflow-studio-service-integrations.md).
 */
export const SERVICE_INTEGRATIONS: Record<string, ServiceIntegration> = {
  "glue.startJobRun": {
    key: "glue.startJobRun",
    label: "AWS Glue — Start Job Run",
    shortLabel: "Glue Job",
    service: "glue",
    clientPackage: "@aws-sdk/client-glue",
    clientClass: "GlueClient",
    start: { command: "StartJobRunCommand", idPath: "JobRunId" },
    startParams: [
      {
        name: "JobName",
        label: "Glue job name",
        type: "resource",
        resource: "glueJob",
        required: true,
        placeholder: "my-etl-job",
      },
      {
        name: "Arguments",
        label: "Job arguments",
        type: "json",
        description: "Optional map of --key/value job arguments.",
      },
    ],
    poll: {
      command: "GetJobRunCommand",
      inputExpr: "{ JobName: startInput.JobName, RunId: jobId }",
      statusPath: "JobRun.JobRunState",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED", "TIMEOUT", "ERROR", "STOPPED"],
    initialStatus: "STARTING",
    defaultPollSeconds: 10,
    maxWaitSeconds: 2 * 3600,
    iamActions: ["glue:StartJobRun", "glue:GetJobRun"],
  },

  "batch.submitJob": {
    key: "batch.submitJob",
    label: "AWS Batch — Submit Job",
    shortLabel: "Batch Job",
    service: "batch",
    clientPackage: "@aws-sdk/client-batch",
    clientClass: "BatchClient",
    start: { command: "SubmitJobCommand", idPath: "jobId" },
    startParams: [
      {
        name: "jobName",
        label: "Job name",
        type: "string",
        required: true,
        placeholder: "my-batch-job",
      },
      {
        name: "jobQueue",
        label: "Job queue",
        type: "resource",
        resource: "batchJobQueue",
        required: true,
      },
      {
        name: "jobDefinition",
        label: "Job definition",
        type: "resource",
        resource: "batchJobDefinition",
        required: true,
      },
      {
        name: "parameters",
        label: "Parameters",
        type: "json",
        description: "Optional map of job parameters.",
      },
    ],
    poll: {
      command: "DescribeJobsCommand",
      inputExpr: "{ jobs: [jobId] }",
      statusPath: "jobs[0].status",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED"],
    initialStatus: "SUBMITTED",
    defaultPollSeconds: 30,
    maxWaitSeconds: 24 * 3600,
    iamActions: ["batch:SubmitJob", "batch:DescribeJobs"],
  },

  "codebuild.startBuild": {
    key: "codebuild.startBuild",
    label: "AWS CodeBuild — Start Build",
    shortLabel: "CodeBuild",
    service: "codebuild",
    clientPackage: "@aws-sdk/client-codebuild",
    clientClass: "CodeBuildClient",
    start: { command: "StartBuildCommand", idPath: "build.id" },
    startParams: [
      {
        name: "projectName",
        label: "Project name",
        type: "resource",
        resource: "codebuildProject",
        required: true,
      },
      {
        name: "environmentVariablesOverride",
        label: "Environment variable overrides",
        type: "json",
        description: "Optional array of { name, value, type } overrides.",
      },
    ],
    poll: {
      command: "BatchGetBuildsCommand",
      inputExpr: "{ ids: [jobId] }",
      statusPath: "builds[0].buildStatus",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED", "FAULT", "TIMED_OUT", "STOPPED"],
    initialStatus: "IN_PROGRESS",
    defaultPollSeconds: 15,
    maxWaitSeconds: 8 * 3600,
    iamActions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
  },

  "athena.startQueryExecution": {
    key: "athena.startQueryExecution",
    label: "Amazon Athena — Start Query Execution",
    shortLabel: "Athena Query",
    service: "athena",
    clientPackage: "@aws-sdk/client-athena",
    clientClass: "AthenaClient",
    start: {
      command: "StartQueryExecutionCommand",
      idPath: "QueryExecutionId",
    },
    startParams: [
      {
        name: "QueryString",
        label: "SQL query",
        type: "text",
        required: true,
        placeholder: "SELECT * FROM my_table LIMIT 10",
      },
      {
        name: "QueryExecutionContext",
        label: "Query context",
        type: "json",
        description: 'Optional { "Database": "...", "Catalog": "..." }.',
      },
      {
        name: "ResultConfiguration",
        label: "Result configuration",
        type: "json",
        description: 'Optional { "OutputLocation": "s3://..." }.',
      },
    ],
    poll: {
      command: "GetQueryExecutionCommand",
      inputExpr: "{ QueryExecutionId: jobId }",
      statusPath: "QueryExecution.Status.State",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED", "CANCELLED"],
    initialStatus: "QUEUED",
    defaultPollSeconds: 5,
    maxWaitSeconds: 3600,
    iamActions: ["athena:StartQueryExecution", "athena:GetQueryExecution"],
    notes:
      "Athena also needs the query's underlying data permissions (S3/Glue), which are not inferred here.",
  },

  "sfn.startExecution": {
    key: "sfn.startExecution",
    label: "AWS Step Functions — Start Execution",
    shortLabel: "State Machine",
    service: "sfn",
    clientPackage: "@aws-sdk/client-sfn",
    clientClass: "SFNClient",
    start: { command: "StartExecutionCommand", idPath: "executionArn" },
    startParams: [
      {
        name: "stateMachineArn",
        label: "State machine",
        type: "resource",
        resource: "stateMachineArn",
        required: true,
      },
      {
        name: "input",
        label: "Input",
        type: "text",
        description: "JSON input string passed to the state machine.",
        placeholder: "{}",
      },
      { name: "name", label: "Execution name", type: "string" },
    ],
    poll: {
      command: "DescribeExecutionCommand",
      inputExpr: "{ executionArn: jobId }",
      statusPath: "status",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED", "TIMED_OUT", "ABORTED"],
    initialStatus: "RUNNING",
    defaultPollSeconds: 10,
    maxWaitSeconds: 24 * 3600,
    // Step Functions' IAM prefix is `states`, not the client name `sfn`.
    iamActions: ["states:StartExecution", "states:DescribeExecution"],
  },

  "ecs.runTask": {
    key: "ecs.runTask",
    label: "Amazon ECS/Fargate — Run Task",
    shortLabel: "ECS Task",
    service: "ecs",
    clientPackage: "@aws-sdk/client-ecs",
    clientClass: "ECSClient",
    start: { command: "RunTaskCommand", idPath: "tasks[0].taskArn" },
    startParams: [
      {
        name: "cluster",
        label: "Cluster",
        type: "resource",
        resource: "ecsCluster",
        required: true,
      },
      {
        name: "taskDefinition",
        label: "Task definition",
        type: "resource",
        resource: "ecsTaskDefinition",
        required: true,
      },
      {
        name: "launchType",
        label: "Launch type",
        type: "string",
        placeholder: "FARGATE",
      },
      {
        name: "networkConfiguration",
        label: "Network configuration",
        type: "json",
        description: "Optional awsvpcConfiguration for Fargate tasks.",
      },
    ],
    poll: {
      command: "DescribeTasksCommand",
      inputExpr: "{ cluster: startInput.cluster, tasks: [jobId] }",
      statusPath: "tasks[0].lastStatus",
    },
    // A task ends at STOPPED whether it succeeded or failed; there is no
    // distinct failure lastStatus, so completion = STOPPED and container exit
    // codes must be inspected for task-level failures.
    success: ["STOPPED"],
    failure: [],
    initialStatus: "PROVISIONING",
    defaultPollSeconds: 15,
    maxWaitSeconds: 24 * 3600,
    iamActions: ["ecs:RunTask", "ecs:DescribeTasks"],
    notes:
      "Completes when the task reaches STOPPED — inspect container exit codes for failures. RunTask usually also needs iam:PassRole for the task/execution roles (not inferred). Include `cluster` in the start input.",
  },

  "databrew.startJobRun": {
    key: "databrew.startJobRun",
    label: "AWS Glue DataBrew — Start Job Run",
    shortLabel: "DataBrew Job",
    service: "databrew",
    clientPackage: "@aws-sdk/client-databrew",
    clientClass: "DataBrewClient",
    start: { command: "StartJobRunCommand", idPath: "RunId" },
    poll: {
      command: "DescribeJobRunCommand",
      inputExpr: "{ Name: startInput.Name, RunId: jobId }",
      statusPath: "State",
    },
    success: ["SUCCEEDED"],
    failure: ["FAILED", "TIMEOUT", "STOPPED"],
    initialStatus: "STARTING",
    defaultPollSeconds: 15,
    maxWaitSeconds: 8 * 3600,
    iamActions: ["databrew:StartJobRun", "databrew:DescribeJobRun"],
  },

  "emrServerless.startJobRun": {
    key: "emrServerless.startJobRun",
    label: "Amazon EMR Serverless — Start Job Run",
    shortLabel: "EMR Serverless",
    service: "emr-serverless",
    clientPackage: "@aws-sdk/client-emr-serverless",
    clientClass: "EMRServerlessClient",
    start: { command: "StartJobRunCommand", idPath: "jobRunId" },
    poll: {
      command: "GetJobRunCommand",
      inputExpr: "{ applicationId: startInput.applicationId, jobRunId: jobId }",
      statusPath: "jobRun.state",
    },
    success: ["SUCCESS"],
    failure: ["FAILED", "CANCELLED"],
    initialStatus: "SUBMITTED",
    defaultPollSeconds: 15,
    maxWaitSeconds: 12 * 3600,
    iamActions: ["emr-serverless:StartJobRun", "emr-serverless:GetJobRun"],
    notes:
      "Start input needs applicationId, executionRoleArn and jobDriver. The execution role also needs iam:PassRole (not inferred).",
  },

  "emrContainers.startJobRun": {
    key: "emrContainers.startJobRun",
    label: "Amazon EMR on EKS — Start Job Run",
    shortLabel: "EMR on EKS",
    service: "emr-containers",
    clientPackage: "@aws-sdk/client-emr-containers",
    clientClass: "EMRContainersClient",
    start: { command: "StartJobRunCommand", idPath: "id" },
    poll: {
      command: "DescribeJobRunCommand",
      inputExpr: "{ virtualClusterId: startInput.virtualClusterId, id: jobId }",
      statusPath: "jobRun.state",
    },
    success: ["COMPLETED"],
    failure: ["FAILED", "CANCELLED"],
    initialStatus: "PENDING",
    defaultPollSeconds: 15,
    maxWaitSeconds: 12 * 3600,
    iamActions: ["emr-containers:StartJobRun", "emr-containers:DescribeJobRun"],
    notes:
      "Start input needs virtualClusterId, executionRoleArn and jobDriver (iam:PassRole also required, not inferred).",
  },

  "emr.addJobFlowSteps": {
    key: "emr.addJobFlowSteps",
    label: "Amazon EMR — Add Job Flow Steps",
    shortLabel: "EMR Step",
    service: "emr",
    clientPackage: "@aws-sdk/client-emr",
    clientClass: "EMRClient",
    start: { command: "AddJobFlowStepsCommand", idPath: "StepIds[0]" },
    poll: {
      command: "DescribeStepCommand",
      inputExpr: "{ ClusterId: startInput.JobFlowId, StepId: jobId }",
      statusPath: "Step.Status.State",
    },
    success: ["COMPLETED"],
    failure: ["CANCELLED", "FAILED", "INTERRUPTED"],
    initialStatus: "PENDING",
    defaultPollSeconds: 15,
    maxWaitSeconds: 12 * 3600,
    // EMR's IAM prefix is `elasticmapreduce`, not the client name `emr`.
    iamActions: [
      "elasticmapreduce:AddJobFlowSteps",
      "elasticmapreduce:DescribeStep",
    ],
    notes:
      "Start input needs JobFlowId (the running cluster) and Steps. The cluster must already exist.",
  },

  "sagemaker.createTrainingJob": {
    key: "sagemaker.createTrainingJob",
    label: "Amazon SageMaker AI — Create Training Job",
    shortLabel: "SageMaker Train",
    service: "sagemaker",
    clientPackage: "@aws-sdk/client-sagemaker",
    clientClass: "SageMakerClient",
    start: { command: "CreateTrainingJobCommand", idPath: "TrainingJobArn" },
    poll: {
      command: "DescribeTrainingJobCommand",
      // SageMaker polls by the name supplied in the start input, not by an id
      // returned from Create*.
      inputExpr: "{ TrainingJobName: startInput.TrainingJobName }",
      statusPath: "TrainingJobStatus",
    },
    success: ["Completed"],
    failure: ["Failed", "Stopped"],
    initialStatus: "InProgress",
    defaultPollSeconds: 30,
    maxWaitSeconds: 24 * 3600,
    iamActions: [
      "sagemaker:CreateTrainingJob",
      "sagemaker:DescribeTrainingJob",
    ],
    notes:
      "Start input needs TrainingJobName, AlgorithmSpecification, RoleArn, etc. RoleArn also requires iam:PassRole (not inferred).",
  },

  "sagemaker.createTransformJob": {
    key: "sagemaker.createTransformJob",
    label: "Amazon SageMaker AI — Create Transform Job",
    shortLabel: "SageMaker Transform",
    service: "sagemaker",
    clientPackage: "@aws-sdk/client-sagemaker",
    clientClass: "SageMakerClient",
    start: {
      command: "CreateTransformJobCommand",
      idPath: "TransformJobArn",
    },
    poll: {
      command: "DescribeTransformJobCommand",
      inputExpr: "{ TransformJobName: startInput.TransformJobName }",
      statusPath: "TransformJobStatus",
    },
    success: ["Completed"],
    failure: ["Failed", "Stopped"],
    initialStatus: "InProgress",
    defaultPollSeconds: 30,
    maxWaitSeconds: 24 * 3600,
    iamActions: [
      "sagemaker:CreateTransformJob",
      "sagemaker:DescribeTransformJob",
    ],
    notes: "RoleArn requires iam:PassRole (not inferred).",
  },

  "sagemaker.createProcessingJob": {
    key: "sagemaker.createProcessingJob",
    label: "Amazon SageMaker AI — Create Processing Job",
    shortLabel: "SageMaker Process",
    service: "sagemaker",
    clientPackage: "@aws-sdk/client-sagemaker",
    clientClass: "SageMakerClient",
    start: {
      command: "CreateProcessingJobCommand",
      idPath: "ProcessingJobArn",
    },
    poll: {
      command: "DescribeProcessingJobCommand",
      inputExpr: "{ ProcessingJobName: startInput.ProcessingJobName }",
      statusPath: "ProcessingJobStatus",
    },
    success: ["Completed"],
    failure: ["Failed", "Stopped"],
    initialStatus: "InProgress",
    defaultPollSeconds: 30,
    maxWaitSeconds: 24 * 3600,
    iamActions: [
      "sagemaker:CreateProcessingJob",
      "sagemaker:DescribeProcessingJob",
    ],
    notes: "RoleArn requires iam:PassRole (not inferred).",
  },

  "mediaconvert.createJob": {
    key: "mediaconvert.createJob",
    label: "AWS Elemental MediaConvert — Create Job",
    shortLabel: "MediaConvert",
    service: "mediaconvert",
    clientPackage: "@aws-sdk/client-mediaconvert",
    clientClass: "MediaConvertClient",
    start: { command: "CreateJobCommand", idPath: "Job.Id" },
    poll: {
      command: "GetJobCommand",
      inputExpr: "{ Id: jobId }",
      statusPath: "Job.Status",
    },
    success: ["COMPLETE"],
    failure: ["CANCELED", "ERROR"],
    initialStatus: "SUBMITTED",
    defaultPollSeconds: 15,
    maxWaitSeconds: 12 * 3600,
    iamActions: ["mediaconvert:CreateJob", "mediaconvert:GetJob"],
    notes:
      "MediaConvert uses an account-specific endpoint — set the Region and, if needed, pass an endpoint via a custom client. The job Role also needs iam:PassRole (not inferred).",
  },

  "bedrock.createModelCustomizationJob": {
    key: "bedrock.createModelCustomizationJob",
    label: "Amazon Bedrock — Create Model Customization Job",
    shortLabel: "Bedrock Job",
    service: "bedrock",
    clientPackage: "@aws-sdk/client-bedrock",
    clientClass: "BedrockClient",
    start: {
      command: "CreateModelCustomizationJobCommand",
      idPath: "jobArn",
    },
    poll: {
      command: "GetModelCustomizationJobCommand",
      inputExpr: "{ jobIdentifier: jobId }",
      statusPath: "status",
    },
    success: ["Completed"],
    failure: ["Failed", "Stopped"],
    initialStatus: "InProgress",
    defaultPollSeconds: 30,
    maxWaitSeconds: 24 * 3600,
    iamActions: [
      "bedrock:CreateModelCustomizationJob",
      "bedrock:GetModelCustomizationJob",
    ],
    notes:
      "Start input needs jobName, customModelName, baseModelIdentifier, roleArn and training data config. roleArn also requires iam:PassRole (not inferred).",
  },
};

/** Ordered list of presets (for palette rendering). */
export const SERVICE_INTEGRATION_LIST: ServiceIntegration[] =
  Object.values(SERVICE_INTEGRATIONS);

/** Look up a preset by key. */
export function getServiceIntegration(
  key: string | undefined,
): ServiceIntegration | undefined {
  return key ? SERVICE_INTEGRATIONS[key] : undefined;
}
