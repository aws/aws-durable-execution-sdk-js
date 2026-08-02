/**
 * ASL definition for the "JobStatusPoller" Step Functions starter pack:
 * submits an AWS Batch job, then polls its status in a Wait/Choice loop
 * until it reaches a terminal state.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/JobStatusPoller.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template, with its `${submitJobArn}`/`${checkJobArn}`
 * `Fn::Sub` placeholders substituted back to the original sample's literal
 * `"My Lambda"` `FunctionName`, matching the other starter packs' `.asl.json.ts`
 * convention of vendoring the plain ASL document rather than its CFN-embedded
 * form).
 */
const content = `{
  "Comment": "An example of the Amazon States Language that runs an AWS Batch job and monitors the job until it completes.",
  "StartAt": "Submit Job",
  "QueryLanguage": "JSONata",
  "States": {
    "Submit Job": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::lambda:invoke",
      "Arguments": { "FunctionName": "My Lambda", "Payload": "{% $states.input %}" },
      "Output": "{% $merge([$states.input, $states.result.Payload]) %}",
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 1, "MaxAttempts": 3, "BackoffRate": 2, "JitterStrategy": "FULL" }],
      "Next": "Wait X Seconds"
    },
    "Wait X Seconds": { "Type": "Wait", "Seconds": "{% $states.input.wait_time %}", "Next": "Get Job Status" },
    "Get Job Status": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::lambda:invoke",
      "Arguments": { "FunctionName": "My Lambda", "Payload": { "jobId": "{% $states.input.jobId %}" } },
      "Output": "{% $merge([$states.input, {'status': $states.result.Payload}]) %}",
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 1, "MaxAttempts": 3, "BackoffRate": 2, "JitterStrategy": "FULL" }],
      "Next": "Job Complete?"
    },
    "Job Complete?": {
      "Type": "Choice",
      "Choices": [
        { "Next": "Job Failed", "Condition": "{% $states.input.status = 'FAILED' %}" },
        { "Next": "Get Final Job Status", "Condition": "{% $states.input.status = 'SUCCEEDED' %}" }
      ],
      "Default": "Wait X Seconds"
    },
    "Job Failed": { "Type": "Fail", "Cause": "AWS Batch Job Failed", "Error": "DescribeJob returned FAILED" },
    "Get Final Job Status": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::lambda:invoke",
      "Arguments": { "FunctionName": "My Lambda", "Payload": {"jobId": "{% $states.input.jobId %}"} },
      "Output": "{% $states.result.Payload %}",
      "End": true
    }
  }
}`;

export default content;
