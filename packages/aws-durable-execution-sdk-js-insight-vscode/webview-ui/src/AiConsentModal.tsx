import { useState } from "react";
import type { HostCapabilities } from "./types";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import SpaceBetween from "@cloudscape-design/components/space-between";
import TextContent from "@cloudscape-design/components/text-content";

interface Props {
  /**
   * What the current host supports. The disclosure enumerates where data can
   * go, so it must not name a provider this host cannot use — the desktop app
   * has no Copilot.
   */
  capabilities: HostCapabilities;
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/*
 * AI-usage disclosure shown before the first use of any AI feature (Ask, Agent,
 * or the Visualize page). Consent is persisted (workflowInsight.aiDisclosureAcceptedVersion)
 * so it's asked once per disclosure version.
 *
 * LEGAL: the copy below is reviewed and approved. Treat it as approved text
 * rather than ordinary prose to tidy up in passing — it is what users are
 * consenting to. Changing which providers are named, or what is said about where
 * data goes, needs Legal review again *and* a bump of AI_DISCLOSURE_VERSION in
 * types.ts so already-consented users re-accept. That constant documents the test
 * to apply to a given edit.
 */
export function AiConsentModal({ visible, capabilities, onAccept, onDecline }: Props) {
  const [agreed, setAgreed] = useState(false);

  return (
    <Modal
      visible={visible}
      onDismiss={onDecline}
      header="Workflow Insight uses generative AI"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDecline}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!agreed} onClick={onAccept}>
              I agree
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <TextContent>
          <p>
            The <b>Ask</b> and <b>Agent</b> modes and the <b>Visualize</b> page
            use a large language model (LLM) to turn your natural-language
            requests into queries, to summarize results, and to build charts. To
            do this, the extension sends your request text and, in some cases,
            limited portions of your data — such as result <b>column names</b>{" "}
            and a <b>small sample of result rows</b> used for summaries or chart
            building — to the AI model provider you have configured (Amazon
            Bedrock,{capabilities.copilot ? " GitHub Copilot," : ""} or a local
            model server you run).
          </p>
          <p>
            The <b>Query</b> mode does <b>not</b> use AI: it runs the query you
            type directly against your data source and sends nothing to any
            model provider.
          </p>
          <p>
            <b>Where your data goes depends on the model provider you select</b>{" "}
            in Settings:
          </p>
          <ul>
            <li>
              <b>Amazon Bedrock</b> — your request and the data described above
              are sent to Amazon Bedrock in the AWS account and region you
              configure, and processed under your AWS agreement and Bedrock&rsquo;s
              service terms. It leaves your machine and goes to AWS.
            </li>
            {capabilities.copilot && (
              <li>
                <b>GitHub Copilot</b> — sent to GitHub Copilot through VS
                Code&rsquo;s Language Model API, under your GitHub Copilot
                subscription terms and privacy policy. It leaves your machine
                and goes to GitHub/Microsoft.
              </li>
            )}
            <li>
              <b>Local server (Ollama / OpenAI-compatible)</b> — sent to the
              endpoint you run and control (for example, on your own machine or
              private network). Nothing is sent to a third-party cloud, provided
              that endpoint is itself local/self-hosted.
            </li>
            {capabilities.localLlm && (
              <li>
                <b>On-device model</b> — runs entirely on your computer; your
                request and data do not leave your machine.
              </li>
            )}
          </ul>
          <p>
            Your requests and data are processed by, and subject to the terms
            and privacy policy of, the model provider you select. Review those
            terms to confirm they meet your organization&rsquo;s requirements
            before sending sensitive data. AI-generated queries and answers may
            be inaccurate or incomplete — review them before relying on the
            results, and only submit content you are authorized to share with
            the selected provider.
          </p>
          <p>
            By continuing, you acknowledge this notice and consent to sending
            your requests and the data described above to your configured AI
            provider when you use these features. You can withdraw consent at
            any time by clearing{" "}
            <code>workflowInsight.aiDisclosureAcceptedVersion</code> in settings,
            and you can keep using the AI-free <b>Query</b> mode regardless.
          </p>
        </TextContent>
        <Checkbox
          checked={agreed}
          onChange={({ detail }) => setAgreed(detail.checked)}
        >
          I have read and understand this notice and agree to use the AI
          features on these terms.
        </Checkbox>
      </SpaceBetween>
    </Modal>
  );
}
