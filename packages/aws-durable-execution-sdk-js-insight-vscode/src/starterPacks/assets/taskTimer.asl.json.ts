/**
 * ASL definition for the "TaskTimer" Step Functions starter pack (id "tt"):
 * waits a caller-specified number of seconds, then publishes an SNS message.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/definitions/TaskTimer.json.ts`, mainline, fetched 2026-07-23.
 * Vendored verbatim as a one-time snapshot (not live-synced to upstream).
 */
const content = `{
  "Comment": "An example of the Amazon States Language for scheduling a task.",
  "StartAt": "Wait for Timestamp",
  "QueryLanguage": "JSONata",
  "States": {
    "Wait for Timestamp": {
      "Type": "Wait",
      "Seconds": "{% $states.input.timer_seconds %}",
      "Next": "Send SNS Message"
    },
    "Send SNS Message": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Arguments": {
          "TopicArn": "{% $states.input.topic %}",
          "Message": "{% $states.input.message %}"
      },
      "Retry" : [
        {
          "ErrorEquals": [ "States.ALL" ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2.0,
          "JitterStrategy": "FULL"
        }
      ],
      "End": true
    }
  }
}`;

export default content;
