import { describe, it, expect } from "vitest";
import * as indexModule from "../index";

describe("Index module", () => {
  it("should export test-runner module", () => {
    expect(typeof indexModule).toBe("object");
  });
});
