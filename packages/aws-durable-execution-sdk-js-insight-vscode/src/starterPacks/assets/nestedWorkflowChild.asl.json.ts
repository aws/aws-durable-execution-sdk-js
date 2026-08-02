/**
 * ASL definition for the "NestingPatternAnotherStateMachine" state machine —
 * the CHILD workflow of the "NestedWorkflow" Step Functions starter pack.
 * Runs two simulated long-running jobs back-to-back; if invoked with
 * `NeedCallback: true`, sends a callback (task token in the original ASL)
 * right after the first job completes.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/definitions/NestingPattern.json.ts` (the
 * "NestingPatternAnotherStateMachine" half of that pack's two state
 * machines), mainline, fetched 2026-07-23. Vendored verbatim as a one-time
 * snapshot.
 */
const content = `{
  "StartAt": "First long-running job",
  "QueryLanguage": "JSONata",
  "States": {
    "First long-running job": { "Type": "Wait", "Seconds": 1, "Next": "Need callback?" },
    "Need callback?": {
      "Type": "Choice",
      "Default": "Second long-running job",
      "Choices": [{ "Next": "Callback", "Condition": "{% $states.input.NeedCallback %}" }]
    },
    "Callback": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::aws-sdk:sfn:sendTaskSuccess",
      "Next": "Second long-running job",
      "Arguments": { "Output": "\\"Callback right after the first long-running job is completed\\"", "TaskToken": "{%$states.context.Execution.Input.TaskToken %}" }
    },
    "Second long-running job": { "Type": "Wait", "Seconds": 1, "Next": "Report completion" },
    "Report completion": { "Type": "Pass", "Output": "The whole execution is completed including both long-running jobs", "End": true }
  }
}`;

export default content;
