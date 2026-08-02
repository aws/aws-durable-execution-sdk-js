import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The update path must converge only what the generated bundle REQUIRES.
 *
 * Runtime and Handler are required: the bundle is built for this runtime and
 * `index.handler`, and leaving a pre-existing function on its old values made it
 * fail at invoke time. Timeout, MemorySize and Role are not required, and they are
 * exactly the knobs an operator tunes on a live function — an earlier fix set
 * Timeout: 60 and MemorySize: 256 here, which silently reset a CDK-created or
 * hand-tuned function (memory 1024 -> 256, timeout 300 -> 60) on every redeploy
 * from Studio.
 *
 * Asserted against the source because the deploy path has no SDK-command mocking
 * to hook, and this regression is invisible until someone redeploys onto a tuned
 * function in production.
 */
describe("deploy update path does not reset user-tuned settings", () => {
  const src = readFileSync(join(__dirname, "deploy.ts"), "utf-8");
  /** The UpdateFunctionConfigurationCommand argument object. */
  const updateBlock = (() => {
    const start = src.indexOf("new UpdateFunctionConfigurationCommand({");
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("}),", start));
  })();

  it("converges Runtime and Handler, which the bundle requires", () => {
    expect(updateBlock).toContain("Runtime: RUNTIME");
    expect(updateBlock).toContain('Handler: "index.handler"');
  });

  it.each(["Timeout:", "MemorySize:", "Role:"])(
    "does not set %s on update",
    (field) => {
      expect(updateBlock).not.toContain(field);
    },
  );

  it("still sets them when creating the function", () => {
    const createBlock = src.slice(src.indexOf("createWithRetry(lambda, {"));
    expect(createBlock).toContain("Timeout: 60");
    expect(createBlock).toContain("MemorySize: 256");
  });
});
