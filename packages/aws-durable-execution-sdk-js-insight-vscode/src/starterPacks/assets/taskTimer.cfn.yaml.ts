/**
 * CloudFormation template for the "TaskTimer" Step Functions starter pack
 * (id "tt"), STRIPPED of its original Step-Functions-specific orchestration.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/TaskTimer.yaml.ts`, mainline, fetched 2026-07-23.
 * Vendored as a one-time snapshot (not live-synced to upstream).
 *
 * Changes from the original template:
 *  1. Removed `TaskTimerStateMachine` (`AWS::StepFunctions::StateMachine`)
 *     and `StatesExecutionRole` (its now-orphaned execution role) - we
 *     deploy the workflow as a durable Lambda instead (see
 *     `taskTimer.dar.template.ts`), which needs its own IAM permissions
 *     (auto-inferred + attached by the existing `deployWorkflow()` in
 *     `../deploy.ts`, not this template).
 *  2. `SNSTopic` (renamed from the original's implicit logical id, unchanged
 *     properties) is the only resource left - this pack's infra is
 *     genuinely minimal (no Lambdas, no queues).
 *  3. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `SNSTopicArn`, which the imported `.dar`
 *     workflow references as its default topic (the workflow's real input
 *     shape still lets a caller override `topic`/`message`/`timer_seconds`
 *     per-invocation, matching the original ASL's fully input-driven design).
 */
const content = `---
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  Workflow Studio "TaskTimer" starter pack infra (stripped of the original
  Step Functions state machine - see taskTimer.cfn.yaml.ts's header comment
  for what changed and why).
Resources:
  SNSTopic:
    Type: "AWS::SNS::Topic"
    Properties:
      DisplayName: "WorkflowStudio-TaskTimerTopic"
Outputs:
  SNSTopicArn:
    Value: !Ref SNSTopic
`;

export default content;
