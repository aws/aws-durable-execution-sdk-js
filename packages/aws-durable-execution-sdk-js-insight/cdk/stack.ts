import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as glue from "aws-cdk-lib/aws-glue";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import * as path from "path";
import * as config from "./config.json";

/**
 * Props for the Insight destinations stack.
 */
export interface InsightDestinationsStackProps extends cdk.StackProps {
  /**
   * Role ARNs of durable functions discovered at synth time (via ListFunctions
   * in app.ts). Populated only when config.lambda.discoverDurableFunctions is true.
   * The Insight permissions policy is attached directly to these roles.
   */
  discoveredRoleArns?: string[];
}

export class InsightDestinationsStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: InsightDestinationsStackProps,
  ) {
    super(scope, id, props);

    const policyStatements: iam.PolicyStatement[] = [];

    // Example function's execution role is created up front (when enabled) so
    // its ARN is available to destination access policies (e.g. OpenSearch).
    // No explicit roleName — CDK auto-generates a unique name so the stack can
    // be deployed multiple times without collisions.
    const exampleRole = config.lambda.createExampleFunction
      ? new iam.Role(this, "ExampleFunctionRole", {
          assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              "service-role/AWSLambdaBasicExecutionRole",
            ),
            // Grants lambda:CheckpointDurableExecutions and
            // lambda:GetDurableExecutionState — required for the SDK to persist
            // and resume durable execution state (see AGENTS.md IAM section).
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              "service-role/AWSLambdaBasicDurableExecutionRolePolicy",
            ),
          ],
        })
      : undefined;

    // --- CloudWatch Logs ---
    let logGroup: logs.LogGroup | undefined;
    if (config.destinations.cloudwatchLogs.enabled) {
      logGroup = new logs.LogGroup(this, "InsightLogGroup", {
        logGroupName: config.destinations.cloudwatchLogs.logGroupName,
        retention: config.destinations.cloudwatchLogs
          .retentionDays as logs.RetentionDays,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      policyStatements.push(
        new iam.PolicyStatement({
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogStreams",
          ],
          resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
        }),
      );
    }

    // --- DynamoDB ---
    let ddbTable: dynamodb.Table | undefined;
    if (config.destinations.dynamodb.enabled) {
      ddbTable = new dynamodb.Table(this, "InsightTable", {
        tableName: config.destinations.dynamodb.tableName,
        partitionKey: {
          name: "pk",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
          resources: [ddbTable.tableArn],
        }),
      );
    }

    // --- Aurora Serverless v2 ---
    let auroraCluster: rds.DatabaseCluster | undefined;
    if (config.destinations.aurora.enabled) {
      const vpc = new ec2.Vpc(this, "InsightVpc", {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [
          {
            name: "isolated",
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          },
        ],
      });

      auroraCluster = new rds.DatabaseCluster(this, "InsightAuroraCluster", {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        serverlessV2MinCapacity: config.destinations.aurora.minCapacity,
        serverlessV2MaxCapacity: config.destinations.aurora.maxCapacity,
        writer: rds.ClusterInstance.serverlessV2("writer"),
        defaultDatabaseName: config.destinations.aurora.databaseName,
        enableDataApi: true,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // Custom Resource to create the table via RDS Data API
      // Table name is interpolated from operator-controlled config (not user input).
      const createTableSql = `
        CREATE TABLE IF NOT EXISTS ${config.destinations.aurora.tableName} (
          execution_arn VARCHAR(256) PRIMARY KEY,
          execution_name VARCHAR(128),
          function_name VARCHAR(128),
          status VARCHAR(20),
          start_time TIMESTAMPTZ,
          end_time TIMESTAMPTZ,
          duration_ms BIGINT,
          record_json JSONB,
          emitted_at TIMESTAMPTZ
        );
      `;

      const auroraCreateTable = new cr.AwsCustomResource(
        this,
        "AuroraCreateTable",
        {
          onCreate: {
            service: "RDSDataService",
            action: "executeStatement",
            parameters: {
              resourceArn: auroraCluster.clusterArn,
              secretArn: auroraCluster.secret!.secretArn,
              database: config.destinations.aurora.databaseName,
              sql: createTableSql,
            },
            physicalResourceId: cr.PhysicalResourceId.of(
              `aurora-create-table-${config.destinations.aurora.tableName}`,
            ),
          },
          onUpdate: {
            service: "RDSDataService",
            action: "executeStatement",
            parameters: {
              resourceArn: auroraCluster.clusterArn,
              secretArn: auroraCluster.secret!.secretArn,
              database: config.destinations.aurora.databaseName,
              sql: createTableSql,
            },
            physicalResourceId: cr.PhysicalResourceId.of(
              `aurora-create-table-${config.destinations.aurora.tableName}`,
            ),
          },
          policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
              actions: ["rds-data:ExecuteStatement"],
              resources: [auroraCluster.clusterArn],
            }),
            new iam.PolicyStatement({
              actions: ["secretsmanager:GetSecretValue"],
              resources: [auroraCluster.secret!.secretArn],
            }),
          ]),
        },
      );

      // The cluster resource reaches CREATE_COMPLETE before its writer instance
      // is ready to serve queries, so the RDS Data API can fail with "Cannot
      // find DBInstance in DBCluster" if the custom resource only depends on
      // the cluster (CDK's automatic dependency inference, since the custom
      // resource references auroraCluster.clusterArn/secret, does not reach the
      // writer instance construct). Depend on the writer explicitly.
      const writerInstance = auroraCluster.node.findChild("writer");
      auroraCreateTable.node.addDependency(writerInstance);

      policyStatements.push(
        new iam.PolicyStatement({
          actions: [
            "rds-data:ExecuteStatement",
            "rds-data:BatchExecuteStatement",
          ],
          resources: [auroraCluster.clusterArn],
        }),
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [auroraCluster.secret!.secretArn],
        }),
      );

      new cdk.CfnOutput(this, "AuroraClusterArn", {
        value: auroraCluster.clusterArn,
      });
      new cdk.CfnOutput(this, "AuroraSecretArn", {
        value: auroraCluster.secret!.secretArn,
      });
    }

    // --- S3 ---
    let insightBucket: s3.Bucket | undefined;
    if (config.destinations.s3.enabled) {
      insightBucket = new s3.Bucket(this, "InsightBucket", {
        bucketName: config.destinations.s3.bucketName,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["s3:PutObject"],
          resources: [`${insightBucket.bucketArn}/*`],
        }),
      );

      new cdk.CfnOutput(this, "InsightBucketName", {
        value: insightBucket.bucketName,
      });

      // Pre-provision the Glue database/table so the workflow-insight-vscode
      // extension's Athena+S3 destination is queryable immediately after
      // `cdk deploy` — no manual `CREATE DATABASE`/`CREATE TABLE` step, and no
      // dependency on the extension's own best-effort auto-create-on-save
      // (which can only create the *table*, not the database — it assumes
      // the database already exists, since a customer typically already has
      // one). Column/partitioning shape mirrors S3Exporter's exact output
      // (see packages/aws-durable-execution-sdk-js-insight-vscode/src/athena.ts
      // buildCreateTableDdl, which customers use for their own buckets).
      const glueDatabase = new glue.CfnDatabase(this, "InsightGlueDatabase", {
        catalogId: this.account,
        databaseInput: {
          name: config.destinations.s3.glueDatabaseName,
        },
      });

      const glueTable = new glue.CfnTable(this, "InsightGlueTable", {
        catalogId: this.account,
        databaseName: config.destinations.s3.glueDatabaseName,
        tableInput: {
          name: config.destinations.s3.glueTableName,
          tableType: "EXTERNAL_TABLE",
          // Partition projection (see the matching properties in
          // aws-durable-execution-sdk-js-insight-vscode/src/athena.ts's
          // buildCreateTableDdl, which customers use for their own buckets)
          // — Athena computes valid year/month/day partitions and their S3
          // locations from these properties instead of calling Glue's
          // GetPartitions, so today's partition is queryable the moment
          // S3Exporter writes today's first record, with no MSCK REPAIR
          // TABLE / partition-discovery step needed (and none possible —
          // Athena disallows ADD PARTITION/MSCK REPAIR on a
          // projection-enabled table).
          parameters: {
            has_encrypted_data: "false",
            "projection.enabled": "true",
            "projection.year.type": "integer",
            "projection.year.range": "2024,2030",
            "projection.month.type": "integer",
            "projection.month.range": "1,12",
            "projection.month.digits": "2",
            "projection.day.type": "integer",
            "projection.day.range": "1,31",
            "projection.day.digits": "2",
            "storage.location.template": `${insightBucket.s3UrlForObject(
              "workflow-insight/",
            )}year=\${year}/month=\${month}/day=\${day}`,
          },
          partitionKeys: [
            { name: "year", type: "string" },
            { name: "month", type: "string" },
            { name: "day", type: "string" },
          ],
          storageDescriptor: {
            location: insightBucket.s3UrlForObject("workflow-insight/"),
            inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
            outputFormat:
              "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
            serdeInfo: {
              serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
              parameters: { "ignore.malformed.json": "true" },
            },
            columns: [
              { name: "recordtype", type: "string" },
              { name: "schemaversion", type: "string" },
              { name: "emittedat", type: "string" },
              { name: "executionarn", type: "string" },
              { name: "executionname", type: "string" },
              { name: "functionname", type: "string" },
              { name: "functionqualifier", type: "string" },
              { name: "region", type: "string" },
              { name: "accountid", type: "string" },
              { name: "status", type: "string" },
              { name: "starttime", type: "string" },
              { name: "endtime", type: "string" },
              { name: "durationms", type: "bigint" },
              { name: "input", type: "string" },
              { name: "output", type: "string" },
              {
                name: "error",
                type: "struct<name:string,message:string>",
              },
              {
                name: "operations",
                // Written lowercase (subtype, parentid, durationms, ...)
                // to match the same struct in
                // aws-durable-execution-sdk-js-insight-vscode/src/athena.ts's
                // buildCreateTableDdl exactly — Hive/Glue identifiers are
                // case-insensitive and get folded to lowercase regardless of
                // how they're written here, so this was never functionally
                // different from the WorkflowInsightRecord's own camelCase
                // field names, but keeping both DDL definitions in the same
                // casing avoids them drifting into visually different text
                // describing an identical schema.
                type: "array<struct<id:string,name:string,type:string,subtype:string,parentid:string,status:string,starttime:string,endtime:string,durationms:bigint,attempt:int,error:struct<name:string,message:string>,result:string,truncated:boolean>>",
              },
              { name: "truncated", type: "boolean" },
              { name: "droppedoperations", type: "int" },
              { name: "droppedinput", type: "boolean" },
              { name: "droppedoutput", type: "boolean" },
            ],
          },
        },
      });
      glueTable.addDependency(glueDatabase);

      new cdk.CfnOutput(this, "InsightGlueDatabaseName", {
        value: config.destinations.s3.glueDatabaseName,
      });
      new cdk.CfnOutput(this, "InsightGlueTableName", {
        value: config.destinations.s3.glueTableName,
      });
    }

    // --- Redshift Serverless ---
    if (config.destinations.redshift.enabled) {
      const namespace = new cdk.CfnResource(this, "RedshiftNamespace", {
        type: "AWS::RedshiftServerless::Namespace",
        properties: {
          NamespaceName: config.destinations.redshift.namespaceName,
          DbName: config.destinations.redshift.databaseName,
          AdminUsername: "admin",
          ManageAdminPassword: true,
        },
      });

      const workgroup = new cdk.CfnResource(this, "RedshiftWorkgroup", {
        type: "AWS::RedshiftServerless::Workgroup",
        properties: {
          WorkgroupName: config.destinations.redshift.workgroupName,
          NamespaceName: config.destinations.redshift.namespaceName,
          BaseCapacity: 8,
          PubliclyAccessible: false,
          // WorkflowInsightRecord uses camelCase JSON keys (functionName,
          // durationMs, executionArn, input.claimType, ...). Redshift's default
          // (enable_case_sensitive_identifier=false) folds SUPER path
          // identifiers to lowercase, so record_json.functionName silently
          // resolves to NULL. Enabling case-sensitive identifiers lets queries
          // reach the camelCase attributes via double-quoted paths, e.g.
          // record_json."functionName", record_json."input"."claimType".
          ConfigParameters: [
            {
              ParameterKey: "enable_case_sensitive_identifier",
              ParameterValue: "true",
            },
          ],
        },
      });
      workgroup.addDependency(namespace);

      // Custom Resource to create the table via Redshift Data API
      // Table/schema names are interpolated from operator-controlled config (not user input).
      const fqTable = `${config.destinations.redshift.schema}.${config.destinations.redshift.tableName}`;
      const createRedshiftTableSql = `
        CREATE TABLE IF NOT EXISTS ${fqTable} (
          execution_arn VARCHAR(512) PRIMARY KEY,
          execution_name VARCHAR(256),
          function_name VARCHAR(128),
          status VARCHAR(20),
          start_time TIMESTAMPTZ,
          end_time TIMESTAMPTZ,
          duration_ms BIGINT,
          record_json SUPER,
          emitted_at TIMESTAMPTZ
        );
        GRANT ALL ON ${fqTable} TO PUBLIC;
      `;

      // Use a Provider-backed custom resource that polls DescribeStatement
      // until the CREATE TABLE completes. The Redshift Data API is async —
      // ExecuteStatement returns immediately without confirming success.
      const redshiftTableFn = new lambdaNode.NodejsFunction(
        this,
        "RedshiftCreateTableHandler",
        {
          runtime: lambda.Runtime.NODEJS_22_X,
          handler: "handler",
          entry: path.join(__dirname, "redshift-create-table.ts"),
          timeout: cdk.Duration.minutes(3),
          initialPolicy: [
            new iam.PolicyStatement({
              actions: [
                "redshift-data:ExecuteStatement",
                "redshift-data:DescribeStatement",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              actions: ["redshift-serverless:GetCredentials"],
              resources: [
                `arn:${this.partition}:redshift-serverless:${this.region}:${this.account}:workgroup/*`,
              ],
            }),
          ],
          bundling: {
            format: lambdaNode.OutputFormat.ESM,
            mainFields: ["module", "main"],
            banner:
              'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
            minify: true,
          },
        },
      );

      const redshiftTableProvider = new cr.Provider(
        this,
        "RedshiftCreateTableProvider",
        { onEventHandler: redshiftTableFn },
      );

      const redshiftCreateTable = new cdk.CustomResource(
        this,
        "RedshiftCreateTable",
        {
          serviceToken: redshiftTableProvider.serviceToken,
          properties: {
            WorkgroupName: config.destinations.redshift.workgroupName,
            Database: config.destinations.redshift.databaseName,
            Sql: createRedshiftTableSql,
          },
        },
      );
      redshiftCreateTable.node.addDependency(workgroup);

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["redshift-data:ExecuteStatement"],
          resources: [
            `arn:${this.partition}:redshift-serverless:${this.region}:${this.account}:workgroup/*`,
          ],
        }),
        new iam.PolicyStatement({
          actions: ["redshift-serverless:GetCredentials"],
          resources: [
            `arn:${this.partition}:redshift-serverless:${this.region}:${this.account}:workgroup/*`,
          ],
        }),
      );
    }

    // --- OpenSearch ---
    let openSearchEndpoint: string | undefined;
    if (config.destinations.opensearch.enabled) {
      const domain = new opensearch.Domain(this, "InsightOpenSearch", {
        domainName: config.destinations.opensearch.domainName,
        version: opensearch.EngineVersion.OPENSEARCH_2_11,
        capacity: {
          dataNodeInstanceType: "t3.small.search",
          dataNodes: 1,
        },
        ebs: {
          volumeSize: 10,
        },
        encryptionAtRest: { enabled: true },
        nodeToNodeEncryption: true,
        enforceHttps: true,
        accessPolicies: [
          new iam.PolicyStatement({
            actions: ["es:ESHttpPut", "es:ESHttpPost", "es:ESHttpGet"],
            principals: [new iam.AnyPrincipal()],
            resources: [
              `arn:${this.partition}:es:${this.region}:${this.account}:domain/${config.destinations.opensearch.domainName}/*`,
            ],
            conditions: {
              StringLike: {
                // All principal ARNs are known at synth time (explicit roleNames,
                // synth-time discovered roles, and the example function role).
                "aws:PrincipalArn": [
                  ...config.lambda.roleNames.map(
                    (r) =>
                      `arn:${this.partition}:iam::${this.account}:role/${r}`,
                  ),
                  ...(props?.discoveredRoleArns ?? []),
                  ...(exampleRole ? [exampleRole.roleArn] : []),
                ],
              },
            },
          }),
        ],
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["es:ESHttpPut", "es:ESHttpPost"],
          resources: [`${domain.domainArn}/*`],
        }),
      );

      // Endpoint (hostname, no scheme) — exposed to the example function so its
      // OpenSearchExporter can index records, and output for the extension.
      openSearchEndpoint = domain.domainEndpoint;
      new cdk.CfnOutput(this, "OpenSearchEndpoint", {
        value: `https://${domain.domainEndpoint}`,
      });
    }

    // --- Firehose ---
    if (config.destinations.firehose.enabled) {
      const firehoseBucket = new s3.Bucket(this, "FirehoseBucket", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      const firehoseRole = new iam.Role(this, "FirehoseRole", {
        assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
      });
      firehoseBucket.grantReadWrite(firehoseRole);

      const stream = new firehose.CfnDeliveryStream(
        this,
        "InsightFirehoseStream",
        {
          deliveryStreamName: config.destinations.firehose.streamName,
          extendedS3DestinationConfiguration: {
            bucketArn: firehoseBucket.bucketArn,
            roleArn: firehoseRole.roleArn,
            bufferingHints: {
              intervalInSeconds:
                config.destinations.firehose.bufferIntervalSeconds,
              sizeInMBs: config.destinations.firehose.bufferSizeMB,
            },
          },
        },
      );

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
          resources: [stream.attrArn],
        }),
      );
    }

    // --- SQS ---
    let sqsQueue: sqs.Queue | undefined;
    if (config.destinations.sqs.enabled) {
      const queueProps: sqs.QueueProps = {
        queueName: config.destinations.sqs.fifo
          ? `${config.destinations.sqs.queueName}.fifo`
          : config.destinations.sqs.queueName,
        fifo: config.destinations.sqs.fifo,
        contentBasedDeduplication: config.destinations.sqs.fifo
          ? true
          : undefined,
      };

      sqsQueue = new sqs.Queue(this, "InsightQueue", queueProps);

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["sqs:SendMessage"],
          resources: [sqsQueue.queueArn],
        }),
      );
    }

    // --- EventBridge ---
    if (config.destinations.eventbridge.enabled) {
      let eventBusArn: string;

      if (config.destinations.eventbridge.eventBusName === "default") {
        eventBusArn = `arn:${this.partition}:events:${this.region}:${this.account}:event-bus/default`;
      } else {
        const bus = new events.EventBus(this, "InsightEventBus", {
          eventBusName: config.destinations.eventbridge.eventBusName,
        });
        eventBusArn = bus.eventBusArn;
      }

      policyStatements.push(
        new iam.PolicyStatement({
          actions: ["events:PutEvents"],
          resources: [eventBusArn],
        }),
      );
    }

    // --- Resolve target roles ---
    const targetRoles: iam.IRole[] = [];

    // Explicitly listed role names
    if (config.lambda.roleNames.length > 0) {
      for (const roleName of config.lambda.roleNames) {
        targetRoles.push(
          iam.Role.fromRoleName(this, `Role-${roleName}`, roleName),
        );
      }
    }

    // Discover durable functions and grant to their roles.
    // Discovery runs at synth time (see app.ts) via ListFunctions, so the
    // exact role ARNs are known here and the policy is attached directly —
    // no runtime Lambda or iam:PutRolePolicy grant required.
    const discoveredRoleArns = props?.discoveredRoleArns ?? [];
    for (const roleArn of discoveredRoleArns) {
      const roleName = roleArn.split("/").pop()!;
      targetRoles.push(
        iam.Role.fromRoleArn(this, `DiscoveredRole-${roleName}`, roleArn, {
          mutable: true,
        }),
      );
    }

    // --- Create example durable function ---
    if (config.lambda.createExampleFunction && exampleRole) {
      targetRoles.push(exampleRole);

      const envVars: Record<string, string> = {};
      if (config.destinations.cloudwatchLogs.enabled) {
        envVars.INSIGHT_LOG_GROUP =
          config.destinations.cloudwatchLogs.logGroupName;
      }
      if (config.destinations.dynamodb.enabled) {
        envVars.INSIGHT_DYNAMODB_TABLE = config.destinations.dynamodb.tableName;
      }
      if (config.destinations.aurora.enabled && auroraCluster) {
        envVars.INSIGHT_AURORA_RESOURCE_ARN = auroraCluster.clusterArn;
        envVars.INSIGHT_AURORA_SECRET_ARN = auroraCluster.secret!.secretArn;
        envVars.INSIGHT_AURORA_DATABASE =
          config.destinations.aurora.databaseName;
        envVars.INSIGHT_AURORA_TABLE = config.destinations.aurora.tableName;
      }
      if (config.destinations.sqs.enabled && sqsQueue) {
        envVars.INSIGHT_SQS_QUEUE_URL = sqsQueue.queueUrl;
      }
      if (config.destinations.s3.enabled && insightBucket) {
        envVars.INSIGHT_S3_BUCKET = insightBucket.bucketName;
      }
      if (config.destinations.redshift.enabled) {
        // Serverless workgroup — the exporter authenticates via IAM
        // (redshift-serverless:GetCredentials, granted in the policy block
        // above), so no secret is passed here.
        envVars.INSIGHT_REDSHIFT_WORKGROUP =
          config.destinations.redshift.workgroupName;
        envVars.INSIGHT_REDSHIFT_DATABASE =
          config.destinations.redshift.databaseName;
        envVars.INSIGHT_REDSHIFT_TABLE = config.destinations.redshift.tableName;
        envVars.INSIGHT_REDSHIFT_SCHEMA = config.destinations.redshift.schema;
      }
      if (config.destinations.opensearch.enabled && openSearchEndpoint) {
        // OpenSearchExporter signs requests with SigV4 using the function's
        // role (granted es:ESHttpPut/Post above and allow-listed in the domain
        // access policy). Endpoint needs the https:// scheme.
        envVars.INSIGHT_OPENSEARCH_ENDPOINT = `https://${openSearchEndpoint}`;
      }

      const exampleFn = new lambdaNode.NodejsFunction(
        this,
        "InsightExampleFunction",
        {
          runtime: lambda.Runtime.NODEJS_22_X,
          handler: "handler",
          entry: path.join(__dirname, "example-function", "index.ts"),
          role: exampleRole,
          timeout: cdk.Duration.seconds(30),
          environment: envVars,
          // Required: durable execution must be enabled on the function resource
          // itself (see AGENTS.md IaC checklist) — without this, invocations are
          // rejected with "Unexpected payload provided to start the durable
          // execution." executionTimeout bounds the whole execution (including
          // wait time), separate from the per-invocation `timeout` above.
          durableConfig: {
            executionTimeout: cdk.Duration.hours(1),
            retentionPeriod: cdk.Duration.days(7),
          },
          bundling: {
            format: lambdaNode.OutputFormat.ESM,
            mainFields: ["module", "main"],
            banner:
              'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
            minify: true,
            sourceMap: true,
          },
        },
      );

      new cdk.CfnOutput(this, "ExampleFunctionArn", {
        value: exampleFn.functionArn,
      });
      new cdk.CfnOutput(this, "ExampleFunctionName", {
        value: exampleFn.functionName,
      });

      // --- Auto-invoke: dispatcher Lambda + EventBridge schedule ---
      if (config.lambda.autoInvoke.enabled) {
        const dispatcherFn = new lambdaNode.NodejsFunction(
          this,
          "InsightDispatcherFunction",
          {
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: "handler",
            entry: path.join(__dirname, "dispatcher", "index.ts"),
            timeout: cdk.Duration.seconds(15),
            environment: {
              // Durable functions require a qualified identifier to invoke
              // (version, alias, or $LATEST) — an unqualified name is rejected.
              // $LATEST is fine for this getting-started demo; production
              // invocations should target a published version or alias.
              TARGET_FUNCTION_NAME: `${exampleFn.functionName}:$LATEST`,
            },
            bundling: {
              format: lambdaNode.OutputFormat.ESM,
              mainFields: ["module", "main"],
              banner:
                'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
              minify: true,
            },
          },
        );

        // Grant the dispatcher permission to invoke the example function
        exampleFn.grantInvoke(dispatcherFn);

        // EventBridge rule to trigger the dispatcher on a schedule
        const rule = new events.Rule(this, "InsightDispatchRule", {
          schedule: events.Schedule.rate(
            cdk.Duration.minutes(config.lambda.autoInvoke.rateMinutes),
          ),
        });
        rule.addTarget(new targets.LambdaFunction(dispatcherFn));

        new cdk.CfnOutput(this, "DispatcherFunctionName", {
          value: dispatcherFn.functionName,
        });
        new cdk.CfnOutput(this, "DispatchRuleName", {
          value: rule.ruleName,
        });
      }
    }

    // --- Attach all policy statements to target roles ---
    if (policyStatements.length > 0 && targetRoles.length > 0) {
      new iam.Policy(this, "InsightDestinationPolicy", {
        policyName: "WorkflowInsightDestinations",
        statements: policyStatements,
        roles: targetRoles,
      });
    }
  }
}
