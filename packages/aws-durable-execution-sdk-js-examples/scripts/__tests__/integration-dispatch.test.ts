import {
  copyFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { unwrapEvent } = require("../integration-dispatch.cjs") as {
  unwrapEvent: (
    event: unknown,
    groupExamples: string[],
  ) => { example: string; event: any };
};

describe("integration-dispatch module load", () => {
  test("loads the GROUP_EXAMPLES examples when the module loads", () => {
    const dir = realpathSync(
      mkdtempSync(path.join(tmpdir(), "integration-dispatch-")),
    );
    try {
      const dispatcher = path.join(dir, "integration-dispatch.js");
      copyFileSync(
        path.join(__dirname, "../integration-dispatch.cjs"),
        dispatcher,
      );
      for (const name of ["example-a", "example-b", "example-c"]) {
        writeFileSync(
          path.join(dir, `${name}.js`),
          "exports.handler = () => {};",
        );
      }
      vi.stubEnv("GROUP_EXAMPLES", "example-a,example-b");

      require(dispatcher);

      expect(require.cache[path.join(dir, "example-a.js")]).toBeDefined();
      expect(require.cache[path.join(dir, "example-b.js")]).toBeDefined();
      expect(require.cache[path.join(dir, "example-c.js")]).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const durableEvent = (inputPayload?: string) => ({
  DurableExecutionArn: "arn",
  CheckpointToken: "token",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION",
        ExecutionDetails: { InputPayload: inputPayload },
      },
    ],
  },
});

describe("integration-dispatch", () => {
  const group = ["hello-world", "map-basic"];

  test("puts the original payload back into a durable event", () => {
    const { example, event } = unwrapEvent(
      durableEvent(
        JSON.stringify({ __example: "map-basic", __payload: { items: [1] } }),
      ),
      group,
    );

    expect(example).toBe("map-basic");
    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBe('{"items":[1]}');
  });

  test("leaves no InputPayload when the test sent no payload", () => {
    const { event } = unwrapEvent(
      durableEvent(JSON.stringify({ __example: "hello-world" })),
      group,
    );

    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBeUndefined();
  });

  test("fails with the ownFunction hint when the event has no EXECUTION operation", () => {
    expect(() =>
      unwrapEvent(
        { InitialExecutionState: { Operations: [], NextMarker: "next" } },
        group,
      ),
    ).toThrow(/no EXECUTION operation.*Set ownFunction: true/);
  });

  test("fails with the ownFunction hint when the payload names no example", () => {
    expect(() =>
      unwrapEvent(durableEvent(JSON.stringify({ functionName: "x" })), group),
    ).toThrow(/has no __example.*set ownFunction: true/);
  });

  test("fails when the example is not in this function", () => {
    expect(() =>
      unwrapEvent(durableEvent(JSON.stringify({ __example: "../x" })), group),
    ).toThrow(
      'Example "../x" is not in this function. Its examples are: hello-world, map-basic.',
    );
  });
});
