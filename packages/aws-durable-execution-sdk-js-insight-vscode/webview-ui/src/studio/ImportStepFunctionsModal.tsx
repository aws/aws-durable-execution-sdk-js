/**
 * "Import Step Functions" modal: lists the account's state machines, lets the
 * user pick one (free-text ARN entry always allowed), then triggers the host
 * conversion (ASL → `.dar`). While the host works we show the current phase;
 * on success the workflow is already on the canvas and we surface any
 * best-effort conversion notes + the faithfulness verdict before closing.
 */
import { useEffect, useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import FormField from "@cloudscape-design/components/form-field";
import Checkbox from "@cloudscape-design/components/checkbox";

export function ImportStepFunctionsModal({
  visible,
  onDismiss,
  onList,
  onImport,
  phase,
  notes,
  faithful,
}: {
  visible: boolean;
  onDismiss: () => void;
  onList: () => Promise<{ label: string; value: string }[]>;
  onImport: (arn: string, inlineLambdas: boolean) => Promise<void>;
  phase?: string;
  notes?: string[] | null;
  faithful?: boolean | null;
}) {
  const [items, setItems] = useState<{ label: string; value: string }[]>([]);
  const [listError, setListError] = useState("");
  const [arn, setArn] = useState("");
  const [inlineLambdas, setInlineLambdas] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setArn("");
    setError("");
    setDone(false);
    setListError("");
    onList()
      .then(setItems)
      .catch((e) =>
        setListError(e instanceof Error ? e.message : String(e)),
      );
  }, [visible, onList]);

  const run = async () => {
    setImporting(true);
    setError("");
    try {
      await onImport(arn.trim(), inlineLambdas);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={importing ? () => {} : onDismiss}
      header="Import Step Functions"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {done ? (
              <Button variant="primary" onClick={onDismiss}>
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="link"
                  onClick={onDismiss}
                  disabled={importing}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={importing}
                  disabled={!arn.trim() || importing}
                  onClick={run}
                >
                  Import
                </Button>
              </>
            )}
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {!done && (
          <FormField
            label="State machine"
            description="Pick a state machine, or paste any state-machine ARN. Its Amazon States Language definition is converted to a durable workflow."
          >
            <Autosuggest
              value={arn}
              onChange={({ detail }) => setArn(detail.value)}
              options={items.map((i) => ({
                value: i.value,
                description: i.label,
              }))}
              enteredTextLabel={(v) => `Use "${v}"`}
              placeholder="arn:aws:states:…:stateMachine:MyMachine"
              filteringType="auto"
              disabled={importing}
              empty={listError ? `Could not list: ${listError}` : "No state machines found"}
            />
          </FormField>
        )}

        {!done && (
          <Checkbox
            checked={inlineLambdas}
            disabled={importing}
            onChange={({ detail }) => setInlineLambdas(detail.checked)}
            description="For Lambda-invoke tasks, inline the function's code as a step when it's a self-contained Node.js handler (falls back to a durable invoke otherwise). The Lambda's IAM role, env vars, and layers are NOT imported — review inlined steps."
          >
            Inline simple Node.js Lambda tasks
          </Checkbox>
        )}

        {importing && (
          <Box>
            <SpaceBetween direction="horizontal" size="xs">
              <Spinner />
              <span>{phase || "Converting…"}</span>
            </SpaceBetween>
            <Box variant="small" color="text-status-inactive" padding={{ top: "xs" }}>
              The importer maps the ASL structure, writes each step's code, then
              validates and checks the conversion is faithful — this can take a
              little while.
            </Box>
          </Box>
        )}

        {error && (
          <Alert type="error" header="Import failed">
            {error}
          </Alert>
        )}

        {done && (
          <SpaceBetween size="s">
            <Alert
              type={faithful ? "success" : "warning"}
              header={
                faithful
                  ? "Imported and verified"
                  : "Imported (review recommended)"
              }
            >
              {faithful
                ? "The workflow was loaded onto the canvas and judged a faithful conversion of the state machine."
                : "The workflow was loaded onto the canvas. The conversion could not be fully verified as faithful — please review it against the source."}
            </Alert>
            {notes && notes.length > 0 && (
              <Box>
                <Box variant="awsui-key-label">Conversion notes</Box>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </Box>
            )}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Modal>
  );
}
