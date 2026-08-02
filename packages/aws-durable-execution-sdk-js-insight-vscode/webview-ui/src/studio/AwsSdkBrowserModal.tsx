import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Spinner from "@cloudscape-design/components/spinner";
import SpaceBetween from "@cloudscape-design/components/space-between";
import {
  AWS_SDK_SERVICES,
  isAwsSdkClientPackage,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { useEffect, useMemo, useState } from "react";
import type { InboundMessage, SdkAction } from "../types";
import { postMessage } from "../vscode";

export interface AwsSdkCallPayload {
  clientPackage: string;
  clientClass: string;
  command: string;
  input: string;
  name: string;
}

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onAdd: (payload: AwsSdkCallPayload) => void;
  /** When set, the modal opens drilled straight into this service's operations. */
  initialClientPackage?: string | null;
}

/** camelCase/PascalCase operation name -> a kebab-ish node name. */
function nodeName(operation: string): string {
  return operation
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Two-step picker: choose a service (searchable directory, or type any
 * `@aws-sdk/client-*` package), then choose an operation. The host loads the
 * client on demand, lists operations, and reflects the picked operation's input
 * into a JSON skeleton, which we drop into a new `awsSdkCall` node.
 */
export function AwsSdkBrowserModal({
  visible,
  onDismiss,
  onAdd,
  initialClientPackage,
}: Props) {
  const [filter, setFilter] = useState("");
  const [freeText, setFreeText] = useState("");
  const [clientPackage, setClientPackage] = useState<string | null>(null);
  const [clientClass, setClientClass] = useState<string>("");
  const [actions, setActions] = useState<SdkAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  // Reset when closed.
  useEffect(() => {
    if (!visible) {
      setFilter("");
      setFreeText("");
      setClientPackage(null);
      setClientClass("");
      setActions([]);
      setLoading(false);
      setError("");
      setPendingCommand(null);
    }
  }, [visible]);

  // Opened straight into a service (from the palette) — load its operations.
  useEffect(() => {
    if (visible && initialClientPackage) {
      setError("");
      setActions([]);
      setFilter("");
      setClientPackage(initialClientPackage);
      setLoading(true);
      postMessage({
        type: "listSdkActions",
        clientPackage: initialClientPackage,
      });
    }
  }, [visible, initialClientPackage]);

  // Listen for host reflection responses (correlated by clientPackage/command).
  useEffect(() => {
    const onMessage = (event: MessageEvent<InboundMessage>) => {
      const msg = event.data;
      if (msg.type === "sdkActions" && msg.clientPackage === clientPackage) {
        setLoading(false);
        if (msg.error) setError(msg.error);
        else {
          setActions(msg.actions ?? []);
          setClientClass(msg.clientClass ?? "");
        }
      } else if (
        msg.type === "sdkActionShape" &&
        msg.clientPackage === clientPackage &&
        msg.command === pendingCommand
      ) {
        setPendingCommand(null);
        if (msg.error) {
          setError(msg.error);
          return;
        }
        onAdd({
          clientPackage: msg.clientPackage,
          clientClass,
          command: msg.command,
          input: JSON.stringify(msg.skeleton ?? {}, null, 2),
          name: nodeName(msg.command.replace(/Command$/, "")),
        });
        onDismiss();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clientPackage, clientClass, pendingCommand, onAdd, onDismiss]);

  const selectService = (pkg: string) => {
    setError("");
    setActions([]);
    setFilter("");
    setClientPackage(pkg);
    setLoading(true);
    postMessage({ type: "listSdkActions", clientPackage: pkg });
  };

  const pickAction = (command: string) => {
    if (!clientPackage) return;
    setError("");
    setPendingCommand(command);
    postMessage({ type: "reflectSdkAction", clientPackage, command });
  };

  const filteredServices = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return AWS_SDK_SERVICES;
    return AWS_SDK_SERVICES.filter(
      (s) => s.label.toLowerCase().includes(q) || s.service.includes(q),
    );
  }, [filter]);

  const filteredActions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.name.toLowerCase().includes(q));
  }, [filter, actions]);

  const freeTextValid = isAwsSdkClientPackage(freeText.trim());

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Add AWS SDK method"
      footer={
        <Box float="right">
          <Button variant="link" onClick={onDismiss}>
            Cancel
          </Button>
        </Box>
      }
    >
      <SpaceBetween size="s">
        {error && <Alert type="error">{error}</Alert>}

        {clientPackage === null ? (
          <>
            <Box>Choose an AWS service, then an operation.</Box>
            <Input
              value={filter}
              onChange={({ detail }) => setFilter(detail.value)}
              placeholder="Search services (e.g. DynamoDB, S3)"
              type="search"
            />
            <SpaceBetween size="xxs" direction="horizontal">
              <Input
                value={freeText}
                onChange={({ detail }) => setFreeText(detail.value)}
                placeholder="…or a client package: @aws-sdk/client-ec2"
              />
              <Button
                disabled={!freeTextValid}
                onClick={() => selectService(freeText.trim())}
              >
                Load
              </Button>
            </SpaceBetween>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              <SpaceBetween size="xxs">
                {filteredServices.map((s) => (
                  <Button
                    key={s.clientPackage}
                    variant="link"
                    onClick={() => selectService(s.clientPackage)}
                  >
                    {s.label}
                  </Button>
                ))}
              </SpaceBetween>
            </div>
          </>
        ) : (
          <>
            <SpaceBetween size="xs" direction="horizontal">
              <Button
                iconName="angle-left"
                variant="link"
                onClick={() => {
                  setClientPackage(null);
                  setActions([]);
                  setError("");
                  setFilter("");
                }}
              >
                Services
              </Button>
              <Box variant="strong" padding={{ top: "xxs" }}>
                {clientPackage}
              </Box>
            </SpaceBetween>
            {loading ? (
              <Box textAlign="center" padding="m">
                <Spinner /> Loading operations…
              </Box>
            ) : (
              <>
                <Input
                  value={filter}
                  onChange={({ detail }) => setFilter(detail.value)}
                  placeholder="Search operations (e.g. PutItem)"
                  type="search"
                />
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  <SpaceBetween size="xxs">
                    {filteredActions.map((a) => (
                      <Button
                        key={a.command}
                        variant="link"
                        loading={pendingCommand === a.command}
                        onClick={() => pickAction(a.command)}
                      >
                        {a.name}
                      </Button>
                    ))}
                    {filteredActions.length === 0 && (
                      <Box color="text-status-inactive">No operations.</Box>
                    )}
                  </SpaceBetween>
                </div>
              </>
            )}
          </>
        )}
      </SpaceBetween>
    </Modal>
  );
}
