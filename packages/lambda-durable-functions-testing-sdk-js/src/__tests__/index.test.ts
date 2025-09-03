import * as indexModule from "../index";

describe("Index module", () => {
  it("should export test-runner module", () => {
    expect(typeof indexModule).toBe("object");
  });
});
