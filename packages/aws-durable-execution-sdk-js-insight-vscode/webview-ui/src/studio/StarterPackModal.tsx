/**
 * "Deploy Starter Pack" modal: explains the real, billable AWS resources a
 * starter pack's supporting infrastructure creates, deploys it (via the host
 * CFN orchestration), and on success shows the resulting `.dar` for review
 * before the user chooses to load it onto the canvas. Mirrors
 * ImportStepFunctionsModal's progress/error/done structure and Cloudscape
 * component choices.
 *
 * This modal's job ends at loading the workflow onto the canvas — deploying
 * it as a durable Lambda remains a separate, existing, user-triggered action
 * via Studio's own "Save"/"Deploy…" flow (the plan's two-deploy design).
 */
import { useEffect, useState } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Button from "@cloudscape-design/components/button";
import Alert from "@cloudscape-design/components/alert";
import Spinner from "@cloudscape-design/components/spinner";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import type { StarterPackId, StarterPackInfraProgress } from "../types";
import { STARTER_PACKS_METADATA } from "./StarterPackPickerModal";

export function StarterPackModal({
  visible,
  packId,
  onDismiss,
  onDeployInfra,
  onCancel,
  onLoadDar,
  progress,
}: {
  visible: boolean;
  /** Which starter pack to deploy (chosen in `StarterPackPickerModal`). */
  packId: StarterPackId;
  onDismiss: () => void;
  /** Deploy the starter pack's CFN infra and resolve the resulting `.dar`. */
  onDeployInfra: (packId: StarterPackId) => Promise<string>;
  /** Cancels the in-flight deploy (host deletes the in-progress CFN stack). */
  onCancel?: () => void;
  /** Parse the `.dar` and load it onto the canvas (switches to the Studio view). */
  onLoadDar: (dar: string) => void;
  /** Current progress (message + resource counts) while `onDeployInfra` is running. */
  progress?: StarterPackInfraProgress | null;
}) {
  const metadata = STARTER_PACKS_METADATA.find((p) => p.id === packId);
  const [deploying, setDeploying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState("");
  const [dar, setDar] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDeploying(false);
    setCancelling(false);
    setCancelled(false);
    setError("");
    setDar(null);
  }, [visible]);

  const run = async () => {
    setDeploying(true);
    setCancelling(false);
    setCancelled(false);
    setError("");
    try {
      const result = await onDeployInfra(packId);
      setDar(result);
    } catch (e) {
      const cancelledError =
        e instanceof Error && (e as { cancelled?: boolean }).cancelled;
      if (cancelledError) {
        setCancelled(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setDeploying(false);
      setCancelling(false);
    }
  };

  const cancel = () => {
    if (!onCancel) return;
    setCancelling(true);
    onCancel();
  };

  const loadOntoCanvas = () => {
    if (!dar) return;
    onLoadDar(dar);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      onDismiss={deploying ? () => {} : onDismiss}
      header={`Deploy Starter Pack (${metadata?.title ?? packId})`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {dar ? (
              <>
                <Button variant="link" onClick={onDismiss}>
                  Close
                </Button>
                <Button variant="primary" onClick={loadOntoCanvas}>
                  Load onto canvas
                </Button>
              </>
            ) : deploying ? (
              <Button
                loading={cancelling}
                disabled={cancelling || !onCancel}
                onClick={cancel}
              >
                Cancel deploy
              </Button>
            ) : (
              <>
                <Button variant="link" onClick={onDismiss}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={run}>
                  {metadata?.hasInfra === false
                    ? "Prepare workflow"
                    : "Deploy infrastructure"}
                </Button>
              </>
            )}
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {!dar && metadata?.hasInfra === false ? (
          <Alert type="info" header="No supporting infrastructure needed">
            This starter pack needs no CloudFormation stack — there's nothing
            to provision beyond the durable Lambda itself, which is granted
            the permissions it needs (e.g. Bedrock model access) when you
            deploy it from Studio's own Save/Deploy… flow. Clicking below
            just builds the workflow for you to review; it does not create
            any AWS resources by itself.
          </Alert>
        ) : (
          !dar && (
            <Alert type="warning" header="This creates real AWS resources">
              Deploying this starter pack creates a CloudFormation stack in
              your configured AWS account/region with{" "}
              <b>
                {metadata
                  ? metadata.resourceSummary.join(", ")
                  : "real AWS resources"}
              </b>
              . These are real, billable resources — not a preview. The stack
              stays in your account until you delete it yourself (e.g. from
              the CloudFormation console).
            </Alert>
          )
        )}

        {!dar && (
          <Box variant="p" color="text-status-inactive">
            {metadata?.hasInfra === false ? (
              <>
                This builds the {metadata?.title ?? packId} durable workflow
                for you to review before loading it onto the canvas. Loading
                it does <b>not</b> deploy it as a durable Lambda — that
                remains a separate step using Studio's own Save/Deploy… flow
                once you're ready.
              </>
            ) : (
              <>
                Once the infrastructure is ready, this builds the{" "}
                {metadata?.title ?? packId} durable workflow wired up to the
                deployed resources and lets you review it before loading it
                onto the canvas. Loading it does <b>not</b> deploy it as a
                durable Lambda — that remains a separate step using Studio's
                own Save/Deploy… flow once you're ready.
              </>
            )}
          </Box>
        )}

        {deploying && (
          <Box>
            {progress?.resources && progress.resources.total > 0 ? (
              <ProgressBar
                value={Math.round(
                  (progress.resources.completed / progress.resources.total) *
                    100,
                )}
                label="Creating infrastructure…"
                description={
                  cancelling
                    ? "Cancelling — deleting the stack…"
                    : progress.resources.currentResource
                      ? `Creating ${progress.resources.currentResource}… (${progress.resources.completed}/${progress.resources.total} resources created)`
                      : `${progress.resources.completed}/${progress.resources.total} resources created`
                }
              />
            ) : (
              <SpaceBetween direction="horizontal" size="xs">
                <Spinner />
                <span>
                  {cancelling
                    ? "Cancelling — deleting the stack…"
                    : progress?.message || "Deploying…"}
                </span>
              </SpaceBetween>
            )}
            {!cancelling && metadata?.hasInfra !== false && (
              <Box
                variant="small"
                color="text-status-inactive"
                padding={{ top: "xs" }}
              >
                This creates the CloudFormation stack and waits for it to
                reach a stable state — this can take a few minutes. You can
                cancel at any time; the stack will be deleted.
              </Box>
            )}
          </Box>
        )}

        {cancelled && (
          <Alert type="info" header="Deploy cancelled">
            The deployment was cancelled and the CloudFormation stack has
            been deleted.
          </Alert>
        )}

        {error && (
          <Alert type="error" header="Deploy failed">
            {error}
          </Alert>
        )}

        {dar && (
          <Alert
            type="success"
            header={
              metadata?.hasInfra === false
                ? "Workflow ready"
                : "Infrastructure deployed"
            }
          >
            The {metadata?.title ?? packId} workflow is ready. Click "Load
            onto canvas" to bring it into Studio for review — it will not be
            deployed as a durable Lambda until you explicitly do so from
            Studio's own Save/Deploy… action.
          </Alert>
        )}
      </SpaceBetween>
    </Modal>
  );
}
