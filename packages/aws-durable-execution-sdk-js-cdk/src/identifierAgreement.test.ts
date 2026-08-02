import { RESERVED, toIdentifier as cdkToIdentifier } from "./identifiers";
// Both packages now re-export identifiers from
// `@aws/durable-execution-sdk-js-visual-workflow-model`; this test guards that
// the re-export wiring on each side stays pointed at that single source.
import {
  RESERVED_IDENTIFIERS as studioReserved,
  toIdentifier as studioToIdentifier,
} from "../../aws-durable-execution-sdk-js-insight-vscode/webview-ui/src/studioModel/model";

const SAMPLES = [
  "StepA",
  "my step",
  "my-step",
  "1st thing",
  "",
  "a.b.c",
  "évent",
  "__weird__",
  "return",
  "event",
];

describe("Studio ↔ CDK identifier agreement", () => {
  it("toIdentifier produces identical results", () => {
    for (const name of SAMPLES) {
      expect(studioToIdentifier(name)).toBe(cdkToIdentifier(name));
    }
  });

  it("reserved identifier sets are identical", () => {
    expect([...studioReserved].sort()).toEqual([...RESERVED].sort());
  });
});
