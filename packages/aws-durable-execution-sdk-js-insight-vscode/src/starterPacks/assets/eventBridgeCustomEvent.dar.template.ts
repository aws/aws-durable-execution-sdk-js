/**
 * `.dar` workflow for the "EventBridgeCustomEvent" Step Functions starter
 * pack. Hand-authored (not machine-imported) following the same convention
 * as `taskTimer.dar.template.ts` / `waitForCallback.dar.template.ts` /
 * `jobStatusPoller.dar.template.ts` / `dynamicParallelProcessing.dar.template.ts`
 * - see `helloLambda.dar.template.ts`'s header for the general "why
 * hand-author, not import" rationale.
 *
 * New structural pattern this pack exercises (none of the prior packs used
 * it): the ASL's single `events:putEvents` Task -> a `.dar` `awsSdkCall`
 * node, rather than a hand-written `step` node whose `code` manually
 * constructs an SDK client + command (as every prior pack's SNS/SQS/
 * DynamoDB calls did). `awsSdkCall` is a distinct, purpose-built node kind
 * (confirmed against `generateHandler.ts`'s `case "awsSdkCall":`): it takes
 * `clientPackage` (npm package, e.g. `"@aws-sdk/client-eventbridge"`),
 * `clientClass` (e.g. `"EventBridgeClient"`), `command` (the SDK v3 command
 * class name, e.g. `"PutEventsCommand"`), `input` (a JSON-serialized string,
 * or a JS expression string, for the command's input shape), and an optional
 * `region` - the generated handler wraps exactly this in a
 * `context.step(name, async () => { const client = new <clientClass>(...);
 * return await client.send(new <command>(<input>)); })`, so no hand-written
 * `require(...)` boilerplate is needed in `code` the way every other pack's
 * SDK-calling nodes needed it. Structurally this is the simplest pack in the
 * batch (a single node, no branching, no callbacks, no map/parallel) - the
 * real complexity here is entirely on the infra side (a genuine 3-way
 * EventBridge fan-out to Lambda/SNS/SQS - see
 * `eventBridgeCustomEvent.cfn.yaml.ts`'s header for the dual-SQS-delivery
 * caveat worth understanding when verifying this pack's real AWS run).
 *
 * Faithful to the original ASL's `Arguments.Entries[0]` shape: `Detail`,
 * `DetailType`, and `Source` are kept as the exact same hardcoded literals
 * the source ASL uses (`{ Message: "Hello from Step Functions!" }` /
 * `"MessageFromStepFunctions"` / `"my.statemachine"`) rather than made
 * input-overridable the way TaskTimer's `topic`/`message`/`timer_seconds`
 * were. Deliberate, not an oversight: TaskTimer's ASL is itself fully
 * input-driven by original design (its Wait/SNS states reference
 * `$states.input.*` directly), so mirroring that with `input.x ?? fallback`
 * was the faithful translation. This pack's ASL is NOT input-driven at all -
 * the source `Arguments.Entries[0]` are all static literals with zero
 * `$states.input` references - so making them overridable here would be an
 * enhancement beyond the source material, not a fidelity requirement, AND
 * it would work against this pack's actual purpose: verifying the real
 * 3-target EventBridge fan-out (Lambda logs, SNS, SQS) against a KNOWN,
 * fixed `Detail`/`DetailType`/`Source`/`EventBusName` makes that
 * verification simpler and deterministic (a verification script can match
 * on the exact literal `Message`/`DetailType`/`Source` without needing to
 * echo back whatever the caller happened to pass). Only `EventBusName`
 * varies - and even that varies via the resolved `{{EVENT_BUS_NAME}}`
 * placeholder (bound to the deployed stack's real bus), not the invocation
 * input, since the bus is fixed per-deployment infra, not a per-call
 * parameter.
 *
 * The node's `input` is the FULL `PutEventsCommand` input shape - i.e. the
 * ASL's `Arguments` object verbatim (`{ Entries: [...] }`), NOT just the one
 * entry - since `command`/`clientClass` name a real AWS SDK v3
 * `PutEventsCommandInput`, whose top-level shape is `{ Entries: [...] }`.
 *
 * `input` is a JSON-serialized **string**, not a nested JSON object -
 * confirmed against `generateHandler.ts`'s `emitValue()`: it only accepts a
 * string (`typeof text === "string"`), silently falling back to `"{}"` for
 * anything else (incl. a plain object), then `JSON.parse`s that string back
 * out to re-serialize it as a clean literal. A nested object would have
 * silently produced an empty `{}` input at codegen time - caught here before
 * it became a real bug, the same category of pitfall
 * `dynamicParallelProcessing.dar.template.ts`'s header documents for the
 * `map` node's `BatchResult` shape.
 *
 * REAL BUG FOUND during this pack's actual AWS verification (fixed here,
 * `validateDarJson`'s dry-run did not catch it - same pattern as every prior
 * real bug found in this batch): EventBridge's `PutEventsRequestEntry.Detail`
 * field is ITSELF a JSON-encoded string, not a nested JSON object - per the
 * real `PutEventsCommandInput` type and EventBridge's own API docs. The
 * first version of this node's `input` had `"Detail": { "Message": "..." }`
 * (a nested object, matching every other AWS SDK command used across this
 * repo's packs, where nested objects ARE the correct shape) - this is an
 * EventBridge-specific exception to that general pattern. Real execution
 * failed immediately with a `SerializationException`: `"Start of structure
 * or map found where not expected."` - the AWS SDK v3 smithy client's
 * marshaller choked because it expected a plain string value at that JSON
 * path and found a nested object instead. Fixed by double-encoding: `Detail`
 * is now the JSON-stringified text of `{ "Message": "..." }` (a string
 * containing escaped-JSON), not the object itself. Verified by round-tripping
 * the resolved `.dar`'s `input` field through two `JSON.parse` calls (once
 * for the whole `PutEventsCommandInput`, once more for `Entries[0].Detail`)
 * to confirm the final shape matches what EventBridge's real API expects.
 *
 * No Lambda invokes, no waits, no branching - the single `awsSdkCall` node
 * is both the workflow's only step and its terminal node (`"terminal": true`,
 * no outgoing edge - its `PutEventsCommand` response, including the real
 * EventBridge-assigned `EventId`s per entry, becomes the workflow's return
 * value directly, verifiable against the real event that fanned out to
 * Lambda/SNS/SQS).
 *
 * Structure (mirrors the ASL's one state, collapsed to one `.dar` node):
 *   start -> Send_Custom_Event (awsSdkCall, terminal: true:
 *            `@aws-sdk/client-eventbridge`'s `PutEventsCommand` against
 *            `{{EVENT_BUS_NAME}}`, `Entries: [{ Detail: "{\"Message\":
 *            \"Hello from Step Functions!\"}" (a JSON-encoded STRING, not a
 *            nested object - see the real-bug note above), DetailType:
 *            "MessageFromStepFunctions", EventBusName: "{{EVENT_BUS_NAME}}",
 *            Source: "my.statemachine" }]` - matches the ASL's Arguments
 *            faithfully; returns the raw PutEventsCommand response)
 *
 * Placeholders (`{{...}}`) are filled in by
 * {@link resolveEventBridgeCustomEventDar} from a deployed CFN stack's
 * outputs (see `../cfnDeploy.ts` / `eventBridgeCustomEvent.cfn.yaml.ts`).
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "EventBridgeCustomEvent",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Send_Custom_Event",
      "name": "Send Custom Event",
      "position": { "x": 40, "y": 150 },
      "kind": "awsSdkCall",
      "clientPackage": "@aws-sdk/client-eventbridge",
      "clientClass": "EventBridgeClient",
      "command": "PutEventsCommand",
      "region": "{{REGION}}",
      "input": "{\\"Entries\\":[{\\"Detail\\":\\"{\\\\\\"Message\\\\\\":\\\\\\"Hello from Step Functions!\\\\\\"}\\",\\"DetailType\\":\\"MessageFromStepFunctions\\",\\"EventBusName\\":\\"{{EVENT_BUS_NAME}}\\",\\"Source\\":\\"my.statemachine\\"}]}",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Send_Custom_Event", "source": "start", "target": "Send_Custom_Event" }
  ]
}`;

export interface EventBridgeCustomEventDarContext {
  region: string;
  eventBusName: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveEventBridgeCustomEventDar(
  ctx: EventBridgeCustomEventDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region).replace(
    /\{\{EVENT_BUS_NAME\}\}/g,
    ctx.eventBusName,
  );
}

export default DAR_TEMPLATE;
