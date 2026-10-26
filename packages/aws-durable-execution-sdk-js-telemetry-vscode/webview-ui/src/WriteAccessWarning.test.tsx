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

  it("says the credentials are unconfirmed, with the reason, when nothing was found", () => {
    const html = render({
      status: "unverified",
      reason:
        "It is your responsibility to give these tools read-only credentials.",
    });
    assert.match(
      html,
      /Could not confirm that these credentials are read-only/,
    );
    assert.match(html, /It is your responsibility/);
  });

  it("renders nothing when there is no result", () => {
    assert.equal(render(undefined), "");
  });
});
