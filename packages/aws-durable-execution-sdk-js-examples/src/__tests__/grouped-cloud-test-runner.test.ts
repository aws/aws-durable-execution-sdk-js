import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GroupedCloudDurableTestRunner } from "../utils/test-helper";

/** The Payload of the Invoke call that run() sends. */
async function sentPayload(payload?: unknown) {
  const send = vi.fn().mockRejectedValue(new Error("stop after invoke"));
  const runner = new GroupedCloudDurableTestRunner(
    {
      client: { send } as unknown as LambdaClient,
      functionName: "MapGroup-22x-NodeJS:$LATEST",
    },
    "map-basic",
  );

  await expect(
    runner.run(payload === undefined ? undefined : { payload }),
  ).rejects.toThrow("stop after invoke");

  const command = send.mock.calls[0][0] as InvokeCommand;
  return JSON.parse(command.input.Payload as string);
}

describe("GroupedCloudDurableTestRunner", () => {
  test("wraps the payload with the example name", async () => {
    expect(await sentPayload({ a: 1 })).toEqual({
      __example: "map-basic",
      __payload: { a: 1 },
    });
  });

  test("sends no __payload when there is no payload", async () => {
    expect(await sentPayload()).toEqual({ __example: "map-basic" });
  });

  // CloudDurableTestRunner sends no payload when it is falsy, so the
  // example gets {} there. The wrapper must give the same.
  test("sends no __payload when the payload is falsy", async () => {
    expect(await sentPayload(0)).toEqual({ __example: "map-basic" });
  });
});
