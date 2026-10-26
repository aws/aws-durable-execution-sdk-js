import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { DestinationTestReport } from "./types";

/**
 * The warning under "Test connection". Every passing test shows one.
 *
 * - `can-write`: names each way a query could change data.
 * - `unverified`: the check found nothing, could not look, or failed. That
 *   does not mean the credentials are read-only, so the warning says checking
 *   them is the customer's responsibility and shows the reason.
 * - No result (a check failed earlier): renders nothing.
 *
 * It never blocks saving; the MCP server is the host that asks for consent.
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
  if (writeAccess?.status === "unverified") {
    return (
      <Alert
        type="warning"
        header="Could not confirm that these credentials are read-only"
      >
        {writeAccess.reason}
      </Alert>
    );
  }
  return null;
}
