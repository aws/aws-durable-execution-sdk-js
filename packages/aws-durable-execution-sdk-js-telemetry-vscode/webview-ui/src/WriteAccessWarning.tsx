import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { DestinationTestReport } from "./types";

/**
 * The warning under "Test connection" when queries could change data.
 *
 * - `can-write`: names each way a query could change data.
 * - `unknown`: the check itself failed, so the reason is shown.
 * - `read-only`, `not-checked`, or no result: renders nothing.
 *
 * It never blocks saving; the MCP server is the host that gates queries.
 */
export function WriteAccessWarning({
  writeAccess,
}: {
  writeAccess: DestinationTestReport["writeAccess"];
}) {
  if (writeAccess?.status === "can-write") {
    return (
      <Alert type="warning" header="These credentials can change data">
        <SpaceBetween size="xxs">
          <Box>
            Queries here are written by a model. The explorer refuses queries
            that are not read-only, but that check reads query text and cannot
            block every write. Use credentials that can only read. See "Required
            IAM Permissions" in the README.
          </Box>
          {writeAccess.findings.map((f) => (
            <Box key={f} variant="span">
              • {f}
            </Box>
          ))}
        </SpaceBetween>
      </Alert>
    );
  }
  if (writeAccess?.status === "unknown") {
    return (
      <Alert
        type="warning"
        header="Could not check whether these credentials can change data"
      >
        {writeAccess.reason}
      </Alert>
    );
  }
  return null;
}
