import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useEffect, useState } from "react";

interface Props {
  visible: boolean;
  functionName: string;
  initialPayload?: string;
  initialName?: string;
  starting: boolean;
  error?: string;
  onDismiss: () => void;
  onStart: (payload: string, executionName?: string) => void;
}

/** Invokes a durable function asynchronously with a JSON payload. */
export function StartExecutionModal({
  visible,
  functionName,
  initialPayload,
  initialName,
  starting,
  error,
  onDismiss,
  onStart,
}: Props) {
  const [payload, setPayload] = useState(initialPayload ?? "{}");
  const [name, setName] = useState(initialName ?? "");
  // Re-seed the form every time the modal opens, so it reflects the execution
  // it was opened from rather than whatever was typed last time.
  useEffect(() => {
    if (visible) {
      setPayload(initialPayload ?? "{}");
      setName(initialName ?? "");
    }
  }, [visible, initialPayload, initialName]);

  let jsonError: string | undefined;
  try {
    JSON.parse(payload.trim() || "{}");
  } catch (err) {
    jsonError = err instanceof Error ? err.message : String(err);
  }

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Start execution"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={starting}
              disabled={!!jsonError}
              onClick={() => onStart(payload, name.trim() || undefined)}
            >
              Start
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="s">
        <Box>
          Invokes <b>{functionName}</b> asynchronously and opens the new
          execution.
        </Box>
        {error && <Alert type="error">{error}</Alert>}
        <FormField
          label="Execution name (optional)"
          description="Reusing a name does not start a duplicate execution."
        >
          <Input
            value={name}
            onChange={({ detail }) => setName(detail.value)}
            placeholder="order-12345"
          />
        </FormField>
        <FormField label="Input payload (JSON)" errorText={jsonError}>
          <Textarea
            value={payload}
            onChange={({ detail }) => setPayload(detail.value)}
            rows={8}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
