import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WriteAccessWarning } from "./WriteAccessWarning";
import type { DestinationTestReport } from "./types";

function render(writeAccess: DestinationTestReport["writeAccess"]): string {
  return renderToStaticMarkup(<WriteAccessWarning writeAccess={writeAccess} />);
}

describe("WriteAccessWarning", () => {
  it("lists every finding when the credentials can change data", () => {
    const html = render({
      status: "can-write",
      findings: [
        "The database user can write table public.t.",
        "The database user is a superuser.",
      ],
    });
    assert.match(html, /These credentials can change data/);
    assert.match(html, /The database user can write table public\.t\./);
    assert.match(html, /The database user is a superuser\./);
  });

  it("shows the reason when the check could not run", () => {
    const html = render({ status: "unknown", reason: "connection refused" });
    assert.match(
      html,
      /Could not check whether these credentials can change data/,
    );
    assert.match(html, /connection refused/);
  });

  for (const writeAccess of [
    { status: "read-only" } as const,
    { status: "not-checked", reason: "r" } as const,
    undefined,
  ]) {
    it(`renders nothing for ${writeAccess?.status ?? "no result"}`, () => {
      assert.equal(render(writeAccess), "");
    });
  }
});
