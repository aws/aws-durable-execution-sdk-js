import { resolveEventBridgeCustomEventDar } from "./assets/eventBridgeCustomEvent.dar.template";
import { validateDarJson } from "../agent";

describe("EventBridgeCustomEvent .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveEventBridgeCustomEventDar({
      region: "us-east-1",
      eventBusName: "stack-eventbridgeeventbus-abc123",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
