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
  unwrapEvent: (event: unknown) => { example: string; event: any };
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
  test("puts the original payload back into a durable event", () => {
    const { example, event } = unwrapEvent(
      durableEvent(
        JSON.stringify({ __example: "map-basic", __payload: { items: [1] } }),
      ),
    );

    expect(example).toBe("map-basic");
    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBe('{"items":[1]}');
  });

  test("leaves no InputPayload when the test sent no payload", () => {
    const { event } = unwrapEvent(
      durableEvent(JSON.stringify({ __example: "hello-world" })),
    );

    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBeUndefined();
  });

  test("returns the payload as the event of a non-durable function", () => {
    const { example, event } = unwrapEvent({
      __example: "non-durable",
      __payload: { failure: false },
    });

    expect(example).toBe("non-durable");
    expect(event).toEqual({ failure: false });
  });

  test.each([
    ["no example name", { __payload: {} }],
    ["a path in the example name", { __example: "../x" }],
  ])("fails on %s", (_, payload) => {
    expect(() => unwrapEvent(durableEvent(JSON.stringify(payload)))).toThrow(
      /needs \{ __example, __payload \}/,
    );
  });
});
