import { fitsRunHook, MAX_RUN_HOOK_PAYLOAD_LENGTH } from "../shared";

// The cases mirror e2e/probe-service.mjs. The service accepted 4,096 code
// points in each script and rejected 4,097, whatever the bytes or code units.
describe("fitsRunHook", () => {
  const limit = MAX_RUN_HOOK_PAYLOAD_LENGTH;

  it.each<[string, string, boolean]>([
    ["4,096 ASCII characters", "x".repeat(limit), true],
    ["4,097 ASCII characters", "x".repeat(limit + 1), false],
    // 12,288 bytes. A byte count would reject it.
    ["4,096 CJK code points", "日".repeat(limit), true],
    ["4,097 CJK code points", "日".repeat(limit + 1), false],
    // 8,192 code units. A code unit count would reject it.
    ["4,096 emoji code points", "😀".repeat(limit), true],
    ["4,097 emoji code points", "😀".repeat(limit + 1), false],
    // The reviewer's case: 1,800 "日" in a JSON document.
    [
      "1,800 CJK code points in JSON",
      JSON.stringify({ input: "日".repeat(1_800) }),
      true,
    ],
    // Longer than twice the limit in code units, so no count is needed.
    ["8,193 code units", "x".repeat(2 * limit + 1), false],
  ])("%s", (_label, payload, expected) => {
    expect(fitsRunHook(payload)).toBe(expected);
  });

  it("counts a mix of 1-unit and 2-unit code points", () => {
    const fits = `${"😀".repeat(2_000)}${"a".repeat(limit - 2_000)}`;
    expect(fits.length).toBe(limit + 2_000);
    expect(fitsRunHook(fits)).toBe(true);
    expect(fitsRunHook(`${fits}a`)).toBe(false);
  });
});
