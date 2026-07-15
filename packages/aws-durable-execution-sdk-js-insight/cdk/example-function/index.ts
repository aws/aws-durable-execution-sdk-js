import {
  DurableContext,
  withDurableExecution,
  createRetryStrategy,
} from "@aws/durable-execution-sdk-js";
import {
  workflowInsight,
  CloudWatchLogsExporter,
  DynamoDBExporter,
  AuroraExporter,
  RedshiftExporter,
  OpenSearchExporter,
  SQSExporter,
  S3Exporter,
} from "@aws/durable-execution-sdk-js-insight";

/**
 * Example durable function: Insurance Claim Processing workflow.
 *
 * Demonstrates a multi-step claim workflow with:
 * - Retry strategy with short backoff on each step
 * - Random transient failures (~30% chance per step)
 * - Claim decision logic: APPROVED / REJECTED / MORE_DOCUMENTS_REQUIRED
 */

const exporters = [
  ...(process.env.INSIGHT_LOG_GROUP
    ? [
        new CloudWatchLogsExporter({
          logGroupName: process.env.INSIGHT_LOG_GROUP,
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_DYNAMODB_TABLE
    ? [
        new DynamoDBExporter({
          tableName: process.env.INSIGHT_DYNAMODB_TABLE,
          sortKey: undefined, // upsert mode: one item per execution
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_AURORA_RESOURCE_ARN
    ? [
        new AuroraExporter({
          resourceArn: process.env.INSIGHT_AURORA_RESOURCE_ARN,
          secretArn: process.env.INSIGHT_AURORA_SECRET_ARN!,
          database: process.env.INSIGHT_AURORA_DATABASE ?? "postgres",
          table: process.env.INSIGHT_AURORA_TABLE ?? "workflow_insight",
          engine: "postgresql",
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_REDSHIFT_WORKGROUP
    ? [
        new RedshiftExporter({
          workgroupName: process.env.INSIGHT_REDSHIFT_WORKGROUP,
          database: process.env.INSIGHT_REDSHIFT_DATABASE ?? "dev",
          table: process.env.INSIGHT_REDSHIFT_TABLE ?? "workflow_insight",
          schema: process.env.INSIGHT_REDSHIFT_SCHEMA ?? "public",
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_OPENSEARCH_ENDPOINT
    ? [
        new OpenSearchExporter({
          endpoint: process.env.INSIGHT_OPENSEARCH_ENDPOINT,
          indexName: process.env.INSIGHT_OPENSEARCH_INDEX ?? "workflow-insight",
          region: process.env.AWS_REGION!,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_SQS_QUEUE_URL
    ? [
        new SQSExporter({
          queueUrl: process.env.INSIGHT_SQS_QUEUE_URL,
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
  ...(process.env.INSIGHT_S3_BUCKET
    ? [
        new S3Exporter({
          bucket: process.env.INSIGHT_S3_BUCKET,
          region: process.env.AWS_REGION,
        }),
      ]
    : []),
];

/** Simulates a transient failure ~30% of the time */
function maybeFailTransient(stepName: string): void {
  if (Math.random() < 0.3) {
    throw new Error(
      `Transient failure in ${stepName}: service temporarily unavailable`,
    );
  }
}

type ClaimDecision = "APPROVED" | "REJECTED" | "MORE_DOCUMENTS_REQUIRED";

const retryStrategy = createRetryStrategy({
  maxAttempts: 4,
  initialDelay: { seconds: 1 },
  maxDelay: { seconds: 5 },
  backoffRate: 2,
});

export const handler = withDurableExecution(
  async (
    event: {
      customerName: string;
      insuranceClaimNumber: string;
      claimAmount: number;
      claimType: string;
    },
    context: DurableContext,
  ) => {
    // Step 1: Validate the claim
    const validation = await context.step(
      "validateClaim",
      async () => {
        maybeFailTransient("validateClaim");

        const isValid = event.claimAmount > 0 && event.claimAmount < 1_000_000;
        const riskScore = Math.round(Math.random() * 100);
        const missingDocs =
          event.claimAmount > 25_000 && Math.random() < 0.4
            ? ["police-report", "photo-evidence"]
            : [];

        return {
          valid: isValid,
          riskScore,
          flagged: event.claimAmount > 50_000,
          missingDocuments: missingDocs,
        };
      },
      { retryStrategy },
    );

    // Early exit: invalid claim
    if (!validation.valid) {
      return {
        claimNumber: event.insuranceClaimNumber,
        customerName: event.customerName,
        claimType: event.claimType,
        decision: "REJECTED" as ClaimDecision,
        reason: "Invalid claim amount",
        validation,
      };
    }

    // Early exit: missing documentation
    if (validation.missingDocuments.length > 0) {
      const docRequest = await context.step(
        "requestDocuments",
        async () => {
          maybeFailTransient("requestDocuments");
          return {
            requestId: `DOC-${Date.now()}`,
            documentsRequested: validation.missingDocuments,
            deadline: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            notifiedVia: "email",
          };
        },
        { retryStrategy },
      );

      return {
        claimNumber: event.insuranceClaimNumber,
        customerName: event.customerName,
        claimType: event.claimType,
        decision: "MORE_DOCUMENTS_REQUIRED" as ClaimDecision,
        reason: `Missing: ${validation.missingDocuments.join(", ")}`,
        validation,
        documentRequest: docRequest,
      };
    }

    // Step 2: Check policy coverage
    const coverage = await context.step(
      "checkPolicyCoverage",
      async () => {
        maybeFailTransient("checkPolicyCoverage");
        return {
          policyId: `POL-${event.customerName.replace(/\s/g, "").substring(0, 6).toUpperCase()}-001`,
          covered: Math.random() > 0.15, // 15% chance not covered
          deductible: event.claimAmount > 10_000 ? 1000 : 500,
          maxPayout: 500_000,
        };
      },
      { retryStrategy },
    );

    // Reject if not covered
    if (!coverage.covered) {
      return {
        claimNumber: event.insuranceClaimNumber,
        customerName: event.customerName,
        claimType: event.claimType,
        decision: "REJECTED" as ClaimDecision,
        reason: "Claim type not covered under current policy",
        validation,
        coverage,
      };
    }

    // Step 3: Fraud detection
    const fraudCheck = await context.step(
      "fraudDetection",
      async () => {
        maybeFailTransient("fraudDetection");
        const fraudScore = validation.riskScore * 0.6 + Math.random() * 40;
        return {
          score: Math.round(fraudScore),
          flagged: fraudScore > 80,
          checks: ["identity-verified", "claim-history", "pattern-analysis"],
        };
      },
      { retryStrategy },
    );

    // Reject if fraud detected
    if (fraudCheck.flagged) {
      return {
        claimNumber: event.insuranceClaimNumber,
        customerName: event.customerName,
        claimType: event.claimType,
        decision: "REJECTED" as ClaimDecision,
        reason: "Fraud detection flagged",
        validation,
        coverage,
        fraudCheck,
      };
    }

    // Step 4: Assess and calculate payout
    const assessment = await context.step(
      "assessClaim",
      async () => {
        maybeFailTransient("assessClaim");
        const approvedAmount = Math.min(
          event.claimAmount - coverage.deductible,
          coverage.maxPayout,
        );
        return {
          assessorId: `ASR-${Math.floor(Math.random() * 9000) + 1000}`,
          approvedAmount: Math.max(0, approvedAmount),
          adjustmentReason:
            validation.riskScore > 70 ? "high-risk-adjustment" : "standard",
        };
      },
      { retryStrategy },
    );

    // Step 5: Process payment
    const payment = await context.step(
      "processPayment",
      async () => {
        maybeFailTransient("processPayment");
        return {
          paymentId: `PAY-${Date.now()}`,
          amount: assessment.approvedAmount,
          method:
            assessment.approvedAmount > 10_000 ? "wire-transfer" : "check",
          scheduledDate: new Date(
            Date.now() + 3 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        };
      },
      { retryStrategy },
    );

    // Step 6: Notify customer
    const notification = await context.step(
      "notifyCustomer",
      async () => {
        maybeFailTransient("notifyCustomer");
        return {
          notificationId: `NTF-${Date.now()}`,
          channel: "email",
          sentAt: new Date().toISOString(),
          message: `Claim ${event.insuranceClaimNumber} approved for $${assessment.approvedAmount.toFixed(2)}`,
        };
      },
      { retryStrategy },
    );

    return {
      claimNumber: event.insuranceClaimNumber,
      customerName: event.customerName,
      claimType: event.claimType,
      decision: "APPROVED" as ClaimDecision,
      validation,
      coverage,
      fraudCheck,
      assessment,
      payment,
      notification,
    };
  },
  {
    plugins: [workflowInsight({ exporters })],
  },
);
