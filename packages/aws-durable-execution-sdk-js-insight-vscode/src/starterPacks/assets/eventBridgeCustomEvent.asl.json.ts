/**
 * ASL definition for the "EventBridgeCustomEvent" Step Functions starter
 * pack: sends a single custom event to an Amazon EventBridge event bus.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/EventBridgeCustomEvent.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template, with its `${eventBusName}` `Fn::Sub`
 * placeholder substituted back to the original sample's literal
 * `${eventBusName}` ASL intrinsic placeholder - i.e. left as the plain ASL
 * document's own `${AWS::Partition}`-style substitutions, matching the other
 * starter packs' `.asl.json.ts` convention of vendoring the plain ASL
 * document rather than its CFN-embedded form).
 */
const content = `{
  "Comment": "An example of the Amazon States Language for sending a custom event to Amazon EventBridge",
  "StartAt": "Send a custom event",
  "QueryLanguage": "JSONata",
  "States": {
    "Send a custom event": {
      "Resource": "arn:\${AWS::Partition}:states:::events:putEvents",
      "Type": "Task",
      "Arguments": {
        "Entries": [
          {
            "Detail": { "Message": "Hello from Step Functions!" },
            "DetailType": "MessageFromStepFunctions",
            "EventBusName": "\${eventBusName}",
            "Source": "my.statemachine"
          }
        ]
      },
      "End": true
    }
  }
}`;

export default content;
