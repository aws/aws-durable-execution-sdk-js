/**
 * "Edit a durable function" modal: lists durable functions with an embedded
 * `.dar` (searchable, scrollable) and loads the picked one onto the Studio
 * canvas. Shared by both hosts so the desktop app gets the same experience as
 * the extension — Electron's native `dialog.showMessageBox` only supports a
 * handful of plain buttons with no scrolling, which broke down once an
 * account had more than a few editable functions.
 */
import { useEffect, useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import FormField from "@cloudscape-design/components/form-field";

export function EditFunctionModal({
  visible,
  onDismiss,
  onList,
  onOpen,
}: {
  visible: boolean;
  onDismiss: () => void;
  onList: () => Promise<{ label: string; value: string }[]>;
  /** Fire-and-forget: the host loads the workflow and switches to the Studio
   *  canvas on success, or shows its own error dialog on failure (same path
   *  as the Functions page's "Edit" button). */
  onOpen: (functionName: string) => void;
}) {
  const [items, setItems] = useState<{ label: string; value: string }[]>([]);
  const [listError, setListError] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setListError("");
    setLoading(true);
    onList()
      .then(setItems)
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [visible, onList]);

  const run = () => {
    onOpen(name.trim());
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Edit a durable function"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={run}>
              Open
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField
          label="Durable function"
          description="Only functions deployed from Workflow Studio (or the CDK construct) with workflow embedding enabled are listed."
        >
          <Autosuggest
            value={name}
            onChange={({ detail }) => setName(detail.value)}
            options={items.map((i) => ({ value: i.value, label: i.label }))}
            enteredTextLabel={(v) => `Use "${v}"`}
            placeholder="Function name"
            filteringType="auto"
            statusType={loading ? "loading" : "finished"}
            empty={
              listError
                ? `Could not list: ${listError}`
                : "No editable durable functions found"
            }
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
