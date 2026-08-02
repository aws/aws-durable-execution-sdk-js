/**
 * Validation UI for the Workflow Studio:
 *   - ValidationSummary: a status indicator (green when valid; clickable
 *     error/warning otherwise) shown above the Properties panel.
 *   - ValidationModal: the details dialog listing each issue, with links that
 *     select the offending node.
 * They're separate exports so each renders in its natural place (the summary
 * inside the right-column stack, the modal as a top-level sibling).
 */
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ValidationIssue } from "../studioTypes";

export function ValidationSummary({
  issues,
  hasErrors,
  onView,
}: {
  issues: ValidationIssue[];
  hasErrors: boolean;
  onView: () => void;
}) {
  if (issues.length === 0) {
    return <StatusIndicator type="success">Workflow is valid</StatusIndicator>;
  }
  return (
    <span role="button" style={{ cursor: "pointer" }} onClick={onView}>
      <StatusIndicator type={hasErrors ? "error" : "warning"}>
        {issues.length} validation {issues.length === 1 ? "issue" : "issues"} —
        view
      </StatusIndicator>
    </span>
  );
}

export function ValidationModal({
  open,
  issues,
  onClose,
  onSelectNode,
}: {
  open: boolean;
  issues: ValidationIssue[];
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  return (
    <Modal
      visible={open}
      onDismiss={onClose}
      header="Validation"
      footer={
        <Box float="right">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </Box>
      }
    >
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {issues.map((issue, i) => {
          const target = issue.nodeId ?? issue.nodeIds?.[0];
          return (
            <li key={i} style={{ marginBottom: 6 }}>
              {target ? (
                <Link
                  onFollow={() => {
                    onSelectNode(target);
                    onClose();
                  }}
                >
                  {issue.message}
                </Link>
              ) : (
                issue.message
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
