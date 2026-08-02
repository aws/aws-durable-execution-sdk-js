/**
 * ASL definition for the "NestingPatternMainStateMachine" state machine —
 * the PARENT workflow of the "NestedWorkflow" Step Functions starter pack.
 * Demonstrates three ways of composing Step Functions state machines
 * (fire-and-continue, wait-for-completion, wait-for-callback) against the
 * SAME nested "NestingPatternAnotherStateMachine" (see
 * `nestedWorkflowChild.asl.json.ts`).
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/definitions/NestingPattern.json.ts` (the
 * "NestingPatternMainStateMachine" half of that pack's two state machines),
 * mainline, fetched 2026-07-23. Vendored verbatim as a one-time snapshot.
 */
const content = `{
  "Comment": "An example of combining workflows using a Step Functions StartExecution task state with various integration patterns.",
  "StartAt": "Start new workflow and continue",
  "QueryLanguage": "JSONata",
  "States": {
    "Start new workflow and continue": {
      "Comment": "Start an execution of another Step Functions state machine and continue",
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::states:startExecution",
      "Next": "Start in parallel",
      "Arguments": {
        "StateMachineArn": "\${NestingPatternAnotherStateMachineArn}",
        "Input": { "NeedCallback": false, "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID": "{% $states.context.Execution.Id %}" }
      }
    },
    "Start in parallel": {
      "Comment": "Start two executions of the same state machine in parallel",
      "Type": "Parallel",
      "End": true,
      "Branches": [
        {
          "StartAt": "Start new workflow and wait for completion",
          "States": {
            "Start new workflow and wait for completion": {
              "Comment": "Start an execution and wait for its completion",
              "Type": "Task",
              "Resource": "arn:\${AWS::Partition}:states:::states:startExecution.sync:2",
              "End": true,
              "Arguments": {
                "StateMachineArn": "\${NestingPatternAnotherStateMachineArn}",
                "Input": { "NeedCallback": false, "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID": "{% $states.context.Execution.Id %}" }
              },
              "Output": "{% $states.result.Output %}"
            }
          }
        },
        {
          "StartAt": "Start new workflow and wait for callback",
          "States": {
            "Start new workflow and wait for callback": {
              "Comment": "Start an execution and wait for it to call back with a task token",
              "Type": "Task",
              "Resource": "arn:\${AWS::Partition}:states:::states:startExecution.waitForTaskToken",
              "End": true,
              "Arguments": {
                "StateMachineArn": "\${NestingPatternAnotherStateMachineArn}",
                "Input": { "NeedCallback": true, "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID": "{% $states.context.Execution.Id %}", "TaskToken": "{% $states.context.Task.Token %}" }
              }
            }
          }
        }
      ]
    }
  }
}`;

export default content;
