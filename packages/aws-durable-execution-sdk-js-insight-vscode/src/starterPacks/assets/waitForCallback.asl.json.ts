/**
 * ASL definition for the "WaitForCallback" Step Functions starter pack
 * (id "cbt"): sends a message to SQS with a task token, waits for an
 * external callback, and publishes a success/failure SNS notification.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/definitions/WaitForCallback.json.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot.
 */
const content = `{
  "Comment": "An example of the Amazon States Language for starting a task and waiting for a callback.",
  "QueryLanguage": "JSONata",
  "StartAt": "Start Task And Wait For Callback",
  "States": {
    "Start Task And Wait For Callback": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Arguments": {
        "QueueUrl": "https://sqs.us-east-1.amazonaws.com/000000000000/MyQueue",
        "MessageBody": {
          "MessageTitle": "Task started by Step Functions. Waiting for callback with task token.",
          "TaskToken": "{% $states.context.Task.Token %}"
        }
      },
      "Next": "Notify Success",
      "Catch": [
        {
          "ErrorEquals": [ "States.ALL" ],
          "Next": "Notify Failure"
        }
      ]
    },
    "Notify Success": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Arguments": {
        "Message": "Callback received. Task started by Step Functions succeeded.",
        "TopicArn": "arn:aws:sns:us-east-1:000000000000:MySnsTopic"
      },
      "End": true
    },
    "Notify Failure": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Arguments": {
        "Message": "Task started by Step Functions failed.",
        "TopicArn": "arn:aws:sns:us-east-1:000000000000:MySnsTopic"
      },
      "End": true
    }
  }
}`;

export default content;
