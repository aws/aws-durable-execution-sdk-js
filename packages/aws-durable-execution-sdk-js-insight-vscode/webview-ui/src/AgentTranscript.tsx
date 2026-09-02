import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Box from "@cloudscape-design/components/box";
import StatusIndicator, {
  type StatusIndicatorProps,
} from "@cloudscape-design/components/status-indicator";
import type { AgentStep } from "./types";

interface Props {
  steps: AgentStep[];
  /** True while the agentic loop is still running (no final results yet). */
  running: boolean;
}

const OUTCOME_STATUS: Record<
  AgentStep["outcome"],
  { type: StatusIndicatorProps.Type; label: string }
> = {
  satisfied: { type: "success", label: "Answers the question" },
  unsatisfied: { type: "warning", label: "Didn't fully answer — refining" },
  error: { type: "error", label: "Query failed — retrying" },
  analyzed: { type: "success", label: "Post-processed the results" },
  ran: { type: "in-progress", label: "Ran a query" },
  script: { type: "in-progress", label: "Ran a script" },
};

/**
 * Agentic progress view: shows each run→verify→refine iteration the assistant
 * went through. Rendered only when steps exist.
 */
export function AgentTranscript({ steps, running }: Props) {
  if (steps.length === 0) return null;

  return (
    <Container
      header={
        <Header
          variant="h3"
          description="How the assistant worked toward an answer"
        >
          Agent steps{running ? " (working…)" : ""}
        </Header>
      }
    >
      <SpaceBetween size="m">
        {steps.map((step, i) => {
          const status = OUTCOME_STATUS[step.outcome];
          // biome-ignore lint/suspicious/noArrayIndexKey: pre-existing finding surfaced by the ESLint-to-Biome migration; not triaged as part of the toolchain change
          const key = `${step.iteration}-${i}`;
          return (
            <Box key={key}>
              <SpaceBetween size="xxs">
                <StatusIndicator type={status.type}>
                  Step {step.iteration}: {status.label}
                  {step.rowCount !== undefined
                    ? ` · ${step.rowCount} row${step.rowCount === 1 ? "" : "s"}`
                    : ""}
                </StatusIndicator>
                <Box
                  variant="code"
                  fontSize="body-s"
                  color="text-body-secondary"
                >
                  {step.query}
                </Box>
                {step.detail && (
                  <Box fontSize="body-s" color="text-body-secondary">
                    {step.detail}
                  </Box>
                )}
              </SpaceBetween>
            </Box>
          );
        })}
      </SpaceBetween>
    </Container>
  );
}
