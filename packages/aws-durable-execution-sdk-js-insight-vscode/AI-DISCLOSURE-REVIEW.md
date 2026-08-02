# Workflow Insight VS Code Extension — AI Disclosure / Consent Wording

**Status: approved by Legal (Madi) on 2026-08-01**, with no requested changes to
the wording. The reviewer confirmed the disclosure covers what was needed
(flagging applicable terms, data use) and raised no concerns about the
third-party providers, since choosing one is under the customer's control and
runs under their own subscription.

This document is retained as the record of what was reviewed. Keep it in sync
with the copy it quotes: it is the description Legal signed off on, so if the
user-facing text changes, this file and the disclosure version both need
revisiting (see §6).

This document collects **all** user-facing text in the Workflow Insight VS Code
extension that relates to generative-AI usage: the consent notice, in-product
descriptions/tips, VS Code settings descriptions, README wording, and the
in-app enforcement messages. Text is quoted **verbatim** (formatting such as
**bold** preserved) so the wording can be reviewed exactly as users see it.

## Context for the reviewer

- The extension has four selectable AI providers: **Amazon Bedrock**,
  **GitHub Copilot**, a **self-hosted local server** (OpenAI-compatible, e.g.
  Ollama), and an **on-device model** (runs entirely on the user's machine). Two
  of these are
  **third-party / non-Bedrock** (GitHub Copilot → GitHub/Microsoft; local
  server → an endpoint the user runs) — the focus of the 3P-model question.
- AI is used only by the **Ask** and **Agent** composer modes and the
  **Visualize** page. **Query** mode uses no AI and sends nothing to any
  provider.
- What is sent to the provider for AI features: the user's **request text** and,
  in some cases, **result column names** and a **small sample of result rows**
  (for summaries / chart building). Full result sets and raw records are not
  sent.
- **Consent mechanism:** a modal notice is shown before the first AI use.
  Acceptance is stored in the `workflowInsight.aiDisclosureAcceptedVersion`
  setting. The current disclosure version is **"2"** (constant
  `AI_DISCLOSURE_VERSION` in `webview-ui/src/types.ts`, mirrored by
  `REQUIRED_AI_DISCLOSURE_VERSION` in `src/extension.ts`). Bumping the version
  re-prompts already-consented users. Clearing the setting withdraws consent.
- **Status:** the consent-modal copy is **approved as written** (see the `LEGAL:`
  note quoted in §1). `AI_DISCLOSURE_VERSION` stays at **"2"**: approval came
  with no edit to the text, so there is nothing new for already-consented users
  to agree to.

---

## 1. AI-usage consent modal (shown before first AI use)

Source: `webview-ui/src/AiConsentModal.tsx`

In-code note attached to this component:

> LEGAL: This wording was reviewed and approved by Legal (Madi) on 2026-08-01,
> with no requested changes to the text — the reviewer confirmed it covers what
> was needed (applicable terms, data use) and had no concerns about the
> third-party providers, since selecting one is under the customer's control and
> uses their own subscription.
>
> AI_DISCLOSURE_VERSION was deliberately NOT bumped: approval landed without any
> edit to the copy, so there is nothing new to re-consent to and re-prompting
> everyone would be noise. Bump it only when this text materially changes —
> e.g. a new provider, or a change to what gets sent.

**Modal title:** Workflow Insight uses generative AI

**Body:**

> The **Ask** and **Agent** modes and the **Visualize** page use a large
> language model (LLM) to turn your natural-language requests into queries, to
> summarize results, and to build charts. To do this, the extension sends your
> request text and, in some cases, limited portions of your data — such as
> result **column names** and a **small sample of result rows** used for
> summaries or chart building — to the AI model provider you have configured
> (Amazon Bedrock, GitHub Copilot, or a local model server you run).
>
> The **Query** mode does **not** use AI: it runs the query you type directly
> against your data source and sends nothing to any model provider.
>
> **Where your data goes depends on the model provider you select** in Settings:
>
> - **Amazon Bedrock** — your request and the data described above are sent to
>   Amazon Bedrock in the AWS account and region you configure, and processed
>   under your AWS agreement and Bedrock's service terms. It leaves your machine
>   and goes to AWS.
> - **GitHub Copilot** — sent to GitHub Copilot through VS Code's Language Model
>   API, under your GitHub Copilot subscription terms and privacy policy. It
>   leaves your machine and goes to GitHub/Microsoft.
> - **Local server (Ollama / OpenAI-compatible)** — sent to the endpoint you run
>   and control (for example, on your own machine or private network). Nothing
>   is sent to a third-party cloud, provided that endpoint is itself
>   local/self-hosted.
> - **On-device model** — runs entirely on your computer; your request and data
>   do not leave your machine. (Available only when running the extension from
>   source, not in the packaged build.)
>
> Your requests and data are processed by, and subject to the terms and privacy
> policy of, the model provider you select. Review those terms to confirm they
> meet your organization's requirements before sending sensitive data.
> AI-generated queries and answers may be inaccurate or incomplete — review them
> before relying on the results, and only submit content you are authorized to
> share with the selected provider.
>
> By continuing, you acknowledge this notice and consent to sending your
> requests and the data described above to your configured AI provider when you
> use these features. You can withdraw consent at any time by clearing
> `workflowInsight.aiDisclosureAcceptedVersion` in settings, and you can keep
> using the AI-free **Query** mode regardless.

**Consent checkbox (must be ticked to enable "I agree"):**

> I have read and understand this notice and agree to use the AI features on
> these terms.

**Buttons:** Cancel · I agree

---

## 2. Settings modal — "LLM" tab

Source: `webview-ui/src/SettingsModal.tsx`

**"Max Iterations" field description:**

> Most run→verify→refine rounds for one question (1–20). Higher digs harder on
> tough questions but costs more model/query calls. The loop also stops early if
> it repeats a query. Applies to every data source.

**"LLM Provider" field description:**

> Model used for the AI features (Ask, Agent, and Visualize) that convert
> questions to queries and build charts. Query mode uses no AI.

**Provider select option labels:**

- Amazon Bedrock
- GitHub Copilot (VS Code built-in)
- Local server (Ollama / OpenAI-compatible)
- Local LLM (offline, on-device)

**"How your data is used" info alert** (a provider-specific sentence is inserted
depending on the selected provider):

> When you use **Ask**, **Agent**, or **Visualize**, your request and limited
> data (result **column names** and a **small sample of rows**) are sent to the
> selected provider; **Query** mode sends nothing. [provider sentence] Data you
> send is subject to that provider's terms and privacy policy. You consent to
> this on first use; clear `workflowInsight.aiDisclosureAcceptedVersion` to
> withdraw and be re-prompted.

Provider-specific sentence inserted above:

- **Bedrock:** "With Amazon Bedrock, that data goes to Amazon Bedrock in your
  configured AWS account/region, under your AWS agreement and Bedrock terms."
- **Copilot:** "With GitHub Copilot, that data goes to GitHub/Microsoft via the
  VS Code Language Model API, under your Copilot subscription terms."
- **Local server:** "With a local server, that data goes only to the endpoint
  you run and control — no third-party cloud if it is self-hosted."
- **On-device (local):** "The on-device model runs entirely on your machine;
  your data never leaves your computer."

**"Bedrock Model ID" field description:**

> Model or inference profile ID. Pick one your account can access, or type any
> value.

**"List available models" helper text (Bedrock):**

> Uses your configured Region and AWS Profile. Shows models available in the
> Region (inference profiles + on-demand models); some may still need model
> access granted in the Bedrock console.

**Local server provider help text:**

> Runs against a local OpenAI-compatible server you host — e.g. Ollama
> (`ollama serve`), LM Studio, or a llama.cpp server. Start it and pull a model
> first (e.g. `ollama pull llama3.1`). Nothing is downloaded by the extension.

**On-device (local) provider help text:**

> Runs fully offline after a one-time download. No API keys needed.

**Copilot provider help text:**

> Uses GitHub Copilot via the VS Code Language Model API. Requires an active
> Copilot subscription. No additional configuration needed.

---

## 3. VS Code settings descriptions (Settings UI / settings.json)

Source: `package.json` → `contributes.configuration`

### `workflowInsight.llmProvider` (default: `bedrock`)

> Which LLM provider converts your natural-language questions into queries and
> builds summaries/charts. Used only by the AI features — the 'ask' and 'agent'
> modes and the Visualize page. In those features your request text and, in some
> cases, limited portions of your data (result column names and a small sample
> of rows) are sent to the provider selected here; the 'query' mode uses no AI
> and sends nothing to any provider. Data you send is subject to the terms and
> privacy policy of the selected provider — review them before sending sensitive
> data. See each option below for where your data goes.

Per-option descriptions:

- **bedrock:** "Amazon Bedrock (Converse API) — requires AWS credentials and
  model access. When you use an AI feature (Ask/Agent/Visualize), your request
  text and limited data (result column names and a small sample of rows) are
  sent to Amazon Bedrock in the AWS account and region you configure, and
  processed under your AWS agreement and the Amazon Bedrock service terms."
- **copilot:** "GitHub Copilot (VS Code Language Model API) — requires a Copilot
  subscription. AI requests and the limited data described above are sent to
  GitHub Copilot via VS Code, and are processed under your GitHub Copilot
  subscription terms and privacy policy."
- **local-server:** "Local server — an OpenAI-compatible endpoint you run
  yourself (Ollama, LM Studio, llama.cpp). AI requests are sent only to the
  endpoint you run and control (configured via workflowInsight.localServerUrl);
  nothing is sent to a third-party cloud, provided that endpoint is
  local/self-hosted."
- **local:** "Local LLM (on-device) — runs entirely on your machine; your
  request and data do not leave your computer. Downloads the model on first use
  (configurable via workflowInsight.localModel). Included in the
  platform-specific .vsix (darwin-arm64, win32-x64, win32-arm64, linux-x64).
  GPU-accelerated via Metal on macOS; CPU-only on Windows and Linux (no
  CUDA/Vulkan in the packaged build)."

### `workflowInsight.bedrockModelId` (default: `us.anthropic.claude-sonnet-5`)

> Amazon Bedrock model id (or inference profile id) used by the AI features when
> LLM Provider is 'bedrock'. Requests and the limited data described for the AI
> features are sent to this model in Amazon Bedrock in your configured AWS
> account and region, and processed under your AWS agreement and the Amazon
> Bedrock service terms. You are responsible for having access to the model and
> for the content you submit.

### `workflowInsight.localServerUrl` (default: `http://localhost:11434/v1`)

> Base URL of the OpenAI-compatible chat-completions API for the 'local-server'
> provider (e.g. Ollama at http://localhost:11434/v1); '/chat/completions' is
> appended. AI requests are sent to this endpoint only. Point it at a server you
> run and control (e.g. localhost or your private network) to keep data off
> third-party clouds; if you set it to a remote/hosted URL, your requests and
> data go to that operator under their terms.

### `workflowInsight.localServerModel` (default: `llama3.1`)

> Model name the local server should use for the 'local-server' provider (e.g.
> 'llama3.1' for Ollama). Load/pull it in your server first. Your data is
> handled entirely by that server; no data is sent to this extension's
> maintainers.

### `workflowInsight.localModel` (default: `llama-3-groq-8b-tool-use`)

> Which local model to download and run when LLM Provider is 'local'. Runs
> entirely on-device: your request and data are processed locally and do not
> leave your machine, and no data is sent to any third party or to this
> extension's maintainers. Only used for the 'local' provider; ignored for
> Bedrock/Copilot/local-server.

### `workflowInsight.agenticMaxIterations` (default: `8`)

> The maximum number of queries the assistant will run for one question before
> stopping — one per verify/refine round, or per agent-loop query with parallel
> tool calls counted individually. Higher values let it work harder on difficult
> questions but cost more model/query calls (billable). The loop also stops early
> if it starts repeating a query it already tried. This is the universal
> cost/effort guard — it applies to every data source. NOTE: it bounds the
> NUMBER of queries, not the data scanned per query. For the S3/Athena
> destination, also set a per-query scan cap on your Athena workgroup
> (bytes_scanned_cutoff_per_query) to bound scan cost.

### `workflowInsight.queryMode` (default: `agent`)

> Default mode used by the Explorer composer's Send button. Remembered across
> sessions; you can switch it per-question from the Send dropdown. Note: 'ask'
> and 'agent' use the configured LLM provider and send data to it (see
> workflowInsight.llmProvider); 'query' uses no AI and sends nothing to any
> provider.

Per-option descriptions:

- **query:** "Query: run the text you type verbatim as a read-only query (no LLM)."
- **ask:** "Ask: turn a plain-English question into one query and run it (no agent loop)."
- **agent:** "Agent: let the assistant explore across multiple queries to answer."

### `workflowInsight.aiDisclosureAcceptedVersion` (default: empty)

> Records the version of the AI-usage disclosure you accepted. Set automatically
> when you agree to the in-app AI notice before first using an AI feature
> (Ask/Agent/Visualize); the notice is re-shown when the disclosure is updated.
> Clearing this value withdraws your consent and re-prompts you before the next
> AI use. The AI-free 'query' mode remains usable regardless.

---

## 4. README — "AI Features & Data Handling" section

Source: `README.md`

> Workflow Insight uses generative AI (a large language model) for some
> features. The first time you use one, an in-app notice explains this and asks
> for your consent; you can review or withdraw it at any time (see below).
>
> - **Features that use AI:** the **Ask** and **Agent** composer modes and the
>   **Visualize** page (query generation, result summaries, chart configuration).
> - **Feature that does not:** **Query** mode runs the query you type directly
>   against your data source and sends **nothing** to any model provider.
> - **What is sent:** your request text and, in some cases, limited portions of
>   your data — result **column names** and a **small sample of result rows**
>   used for summaries or building charts. Full result sets and raw records are
>   not sent.
> - **Consent:** before the first AI use you must accept the disclosure. Your
>   acceptance is stored in `workflowInsight.aiDisclosureAcceptedVersion`; the
>   notice is shown again if it is updated. **Clearing that setting withdraws
>   consent** and re-prompts you. The AI-free **Query** mode works regardless.
>
> **Where your data goes depends on the provider you select**
> (`workflowInsight.llmProvider`):
>
> | Provider           | Where AI requests + the data above go                                                                                    |
> | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
> | **Amazon Bedrock** | Amazon Bedrock in your configured AWS account/region; under your AWS agreement + Bedrock terms                           |
> | **GitHub Copilot** | GitHub Copilot via the VS Code Language Model API; under your Copilot subscription terms                                 |
> | **Local server**   | Only the OpenAI-compatible endpoint you run and control (e.g. Ollama on localhost) — no third-party cloud if self-hosted |
> | **On-device**      | Stays entirely on your machine; nothing leaves your computer                                                             |
>
> Data you send is subject to the terms and privacy policy of the provider you
> select — review them before sending sensitive data. AI-generated queries and
> answers may be inaccurate or incomplete; review them before relying on the
> results, and only submit content you are authorized to share with the
> provider.

README also states, under what's sent in Ask/Agent modes:

> In **Ask** and **Agent** modes, the extension sends your question to the
> configured LLM provider (Bedrock, Copilot, local server, or on-device) along
> with:
>
> 1. **The exact record schema** (`WorkflowInsightRecord` fields and types)
> 2. **The query dialect** for your destination (Logs Insights / PartiQL /
>    PostgreSQL / Trino-Athena SQL)
> 3. **Few-shot examples** (proven question→query pairs)
>
> If the generated query fails, the extension automatically sends the error back
> to the model and asks it to fix the query (up to 2 retries). **Query** mode
> skips all of this — it runs your text verbatim (read-only enforced,
> row-capped).

---

## 5. In-app enforcement messages

Source: `src/extension.ts` (host-side consent gate; shown if an AI action is
attempted without a recorded, current-version consent)

- Ask / Agent path:

  > AI features require accepting the AI-usage disclosure first. Please try again
  > and accept the notice.

- Visualize path (same wording, surfaced as a chart error):

  > AI features require accepting the AI-usage disclosure first. Please try again
  > and accept the notice.

---

## 6. Legal review — questions asked and answers received

Both questions below were answered by Madi on **2026-08-01**. Kept as a record of
what was asked and what was approved.

**1. Wording review** — Is the consent-modal copy (§1) and the supporting
descriptions (§2–§5) adequate as an AI-usage disclosure and consent?

> Approved as written. "I also do not have specific recommendations on the
> disclosure text, as it includes what I was looking for (flagging applicable
> terms, data use, etc.)."

No edits were requested, so the copy is unchanged and `AI_DISCLOSURE_VERSION`
stays at "2" — see the note in §1 for why it was not bumped.

**2. Third-party (non-Bedrock) models** — Two providers send user request text +
limited data outside AWS:

- **GitHub Copilot** → GitHub/Microsoft via the VS Code Language Model API, under
  the user's own Copilot subscription terms.
- **Local server** → an OpenAI-compatible endpoint the _user_ runs and controls
  (e.g. Ollama on localhost, or any URL they configure — which could be remote).
- **On-device** stays on the user's machine; **Bedrock** stays in the user's AWS
  account.

> Approved as designed. "No concerns with the setup you have planned given the
> use of 3P models is within the customer control (and their own subscription for
> Copilot)."

---

## 7. If this changes

This file is the record of what Legal approved, so it has to stay accurate. Revisit
it — and consider bumping `AI_DISCLOSURE_VERSION` to re-prompt consented users —
when any of the following change:

- a provider is added or removed;
- what gets sent to a provider changes (today: request text, and for summaries or
  charts, result column names plus a small sample of rows);
- which features use AI (today: Ask, Agent, Visualize — Query uses none);
- the consent copy in `AiConsentModal.tsx`.
