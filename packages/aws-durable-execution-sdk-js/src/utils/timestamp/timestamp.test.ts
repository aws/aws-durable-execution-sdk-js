import { toDate } from "./timestamp";

describe("toDate", () => {
  it("returns undefined when the timestamp is absent", () => {
    expect(toDate(undefined)).toBeUndefined();
  });

  it("passes a Date through unchanged", () => {
    const date = new Date("2026-07-13T22:11:27.127Z");
    expect(toDate(date)).toBe(date);
  });

  it("parses an ISO-8601 string, as delivered on the invocation event", () => {
    expect(toDate("2026-07-13T22:11:27.127Z")).toEqual(
      new Date("2026-07-13T22:11:27.127Z"),
    );
  });

  it("preserves millisecond precision when parsing", () => {
    expect(toDate("2026-07-13T22:11:27.127Z")?.getUTCMilliseconds()).toBe(127);
  });

  it("treats an unparseable string as absent rather than an Invalid Date", () => {
    expect(toDate("not a timestamp")).toBeUndefined();
  });

  it("treats an invalid Date as absent", () => {
    expect(toDate(new Date("not a timestamp"))).toBeUndefined();
  });
});
