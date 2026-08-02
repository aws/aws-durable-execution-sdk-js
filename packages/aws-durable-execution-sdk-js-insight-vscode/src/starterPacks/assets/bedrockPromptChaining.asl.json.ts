/**
 * ASL definition for the "BedrockPromptChaining" Step Functions starter
 * pack: chains a sequence of Amazon Bedrock model invocations together,
 * feeding each response into the next prompt.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/BedrockPromptChaining.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template's `BedrockStateMachine` resource, matching
 * the other starter packs' `.asl.json.ts` convention of vendoring the plain
 * ASL document rather than its CFN-embedded form).
 *
 * See `bedrockPromptChaining.dar.template.ts`'s header for why this ASL's
 * `Initialize` -> `Has Prompt?` -> `Invoke model with prompt` -> (loop back
 * to `Has Prompt?`) -> `Success` cycle - a variable-length sequential loop
 * driven by `input.prompts.length` - collapses to a single `.dar` `step`
 * node containing a plain JS `for` loop, rather than a multi-node `.dar`
 * structure.
 */
const content = `{
  "Comment": "An example of using Bedrock to chain prompts and their responses together.",
  "StartAt": "Initialize",
  "QueryLanguage": "JSONata",
  "States": {
    "Initialize": {
      "Type": "Pass",
      "Next": "Has Prompt?",
      "Assign": {
        "counter": "{% $count($states.input.prompts) %}",
        "conversation_history": [""],
        "input_prompts": "{% $reverse($states.input.prompts) %}"
      }
    },
    "Has Prompt?": {
      "Type": "Choice",
      "Choices": [{ "Next": "Invoke model with prompt", "Condition": "{% $counter > 0 %}" }],
      "Default": "Success"
    },
    "Success": { "Type": "Succeed", "Output": "{% $join($conversation_history[[1..$count($conversation_history)]], '.') %}" },
    "Invoke model with prompt": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::bedrock:invokeModel",
      "Arguments": {
        "ModelId": "amazon.nova-lite-v1:0",
        "Body": {
          "messages": [{ "role": "user", "content": [{ "text": "{% $conversation_history[-1] & '.' & $input_prompts[$counter - 1] %}" }] }],
          "inferenceConfig": { "maxTokens": 250 }
        },
        "ContentType": "application/json",
        "Accept": "application/json"
      },
      "Assign": {
        "conversation_history": "{% $append($conversation_history, $states.result.Body.output.message.content[0].text) %}",
        "counter": "{% $counter - 1 %}"
      },
      "Next": "Has Prompt?"
    }
  }
}`;

export default content;
