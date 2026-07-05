import * as vscode from "vscode";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { buildSystemPrompt } from "./schema";
import {
  parseVerdict,
  buildVerifyInstruction,
  buildAnalysisPrompt,
  type ResultVerdict,
} from "./verdict";

export interface GeneratedQuery {
  query: string;
  explanation: string;
  timeRangeMs: number;
  suggestedCharts?: string[];
  /**
   * Set when the model chose to return raw rows for a follow-up
   * post-processing step to interpret, rather than expressing the whole
   * answer in the query language.
   */
  postProcess?: boolean;
  /** What the post-processing step should extract from the raw rows. */
  postProcessGoal?: string;
}

const DEFAULT_TIME_RANGE_MS = 86_400_000;

const EMIT_QUERY_TOOL: Tool = {
  toolSpec: {
    name: "emit_query",
    description: "Return the query that answers the user's question.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          query: { type: "string", description: "The query string." },
          explanation: {
            type: "string",
            description: "One sentence explaining what the query does.",
          },
          timeRangeMs: {
            type: "number",
            description:
              "Time range in milliseconds. Omit if not mentioned (default 24h).",
          },
          suggestedCharts: {
            type: "array",
            items: { type: "string" },
            description:
              "List of chart types suitable for visualizing this query's results. Values: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot. Pick 2-4 most appropriate based on the data shape (e.g., aggregation with GROUP BY → bar/pie; time series → line/area; two numeric columns → scatter; distribution → histogram/boxplot).",
          },
          postProcess: {
            type: "boolean",
            description:
              "Set true ONLY when the question can't be answered cleanly in the query language and is better served by returning the raw relevant column(s) for the relevant rows and letting a follow-up step read them to produce the answer. When true, `query` should just fetch that raw data (e.g. SELECT input FROM t ORDER BY ... LIMIT n). Leave false/omitted for normal queries that already produce the answer.",
          },
          postProcessGoal: {
            type: "string",
            description:
              "When postProcess is true: a short description of what to extract or compute from the returned rows (e.g. 'the distinct set of top-level keys across all input JSON objects').",
          },
        },
        required: ["query", "explanation"],
      },
    },
  },
};

export type LlmProvider = "bedrock" | "copilot" | "local";

// ─── Result verification (agentic / "advanced" mode) ─────────────────────────

const JUDGE_TOOL: Tool = {
  toolSpec: {
    name: "judge_result",
    description:
      "Decide whether the query results answer the user's question, and if not, suggest how to fix the query.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          satisfied: {
            type: "boolean",
            description:
              "true if the results genuinely answer the question. An empty result set can still be a correct answer (e.g. 'no failures today') — only mark unsatisfied if the query looks like it targets the wrong field/shape/filter.",
          },
          reason: {
            type: "string",
            description: "One sentence explaining the verdict.",
          },
          suggestion: {
            type: "string",
            description:
              "If not satisfied, a concrete change to the query that would better answer the question.",
          },
        },
        required: ["satisfied", "reason"],
      },
    },
  },
};

interface VerifyOptions {
  provider: LlmProvider;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
  question: string;
  query: string;
  columns: string[];
  rowCount: number;
  sampleRows: string[][];
}

/**
 * Ask the model whether a query's results answer the user's question.
 * Advanced-mode only. Any failure resolves to "satisfied" so verification can
 * never block a legitimate result from being shown.
 */
export async function verifyResult(
  opts: VerifyOptions,
): Promise<ResultVerdict> {
  const instruction = buildVerifyInstruction(opts);
  try {
    if (opts.provider === "bedrock") {
      const client = new BedrockRuntimeClient({
        region: opts.region,
        credentials: opts.credentials,
      });
      const response = await client.send(
        new ConverseCommand({
          modelId: opts.modelId,
          messages: [{ role: "user", content: [{ text: instruction }] }],
          toolConfig: {
            tools: [JUDGE_TOOL],
            toolChoice: { tool: { name: "judge_result" } },
          },
          inferenceConfig: { maxTokens: 512, temperature: 0 },
        }),
      );
      const blocks: ContentBlock[] = response.output?.message?.content ?? [];
      const toolUse = blocks.find((b) => "toolUse" in b && b.toolUse)?.toolUse;
      const input = toolUse?.input as
        | { satisfied?: unknown; reason?: unknown; suggestion?: unknown }
        | undefined;
      if (input && typeof input.satisfied === "boolean") {
        return {
          satisfied: input.satisfied,
          reason:
            typeof input.reason === "string" && input.reason.trim()
              ? input.reason.trim()
              : "No reason provided.",
          suggestion:
            typeof input.suggestion === "string" && input.suggestion.trim()
              ? input.suggestion.trim()
              : undefined,
        };
      }
      return { satisfied: true, reason: "No verdict returned; accepting." };
    }

    if (opts.provider === "copilot") {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models.length === 0) {
        return { satisfied: true, reason: "No judge model available." };
      }
      const response = await models[0].sendRequest(
        [
          vscode.LanguageModelChatMessage.User(
            `${instruction}\n\nRespond with ONLY JSON: {"satisfied": true|false, "reason": "...", "suggestion": "..."}`,
          ),
        ],
        {},
        new vscode.CancellationTokenSource().token,
      );
      let text = "";
      for await (const chunk of response.text) text += chunk;
      return parseVerdict(text);
    }

    // local
    const { model } = await getLocalModel();
    const { LlamaChatSession } = await import("node-llama-cpp");
    const context = await model.createContext();
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });
    const text = await session.prompt(
      `${instruction}\n\nRespond with ONLY JSON: {"satisfied": true|false, "reason": "...", "suggestion": "..."}`,
    );
    await context.dispose();
    return parseVerdict(text);
  } catch {
    // Never let a judge failure hide results or wedge the loop.
    return {
      satisfied: true,
      reason: "Verification failed; accepting the results as-is.",
    };
  }
}

// ─── Result post-processing / analysis (agentic "advanced" mode) ─────────────

interface AnalyzeOptions {
  provider: LlmProvider;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
  question: string;
  goal?: string;
  columns: string[];
  rows: string[][];
}

/**
 * Answer the user's question directly from the rows a query returned, instead
 * of expressing everything in the query language (advanced mode's
 * post-processing step — used when generateQuery set postProcess=true, e.g.
 * "list the distinct keys across these JSON inputs"). Returns the answer text,
 * or "" on any failure so the caller can just fall back to showing the table.
 * Only a bounded sample of rows is sent (see buildAnalysisPrompt).
 */
export async function analyzeResults(opts: AnalyzeOptions): Promise<string> {
  const prompt = buildAnalysisPrompt({
    question: opts.question,
    goal: opts.goal,
    columns: opts.columns,
    rows: opts.rows,
  });
  try {
    if (opts.provider === "bedrock") {
      const client = new BedrockRuntimeClient({
        region: opts.region,
        credentials: opts.credentials,
      });
      const response = await client.send(
        new ConverseCommand({
          modelId: opts.modelId,
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 1024, temperature: 0 },
        }),
      );
      const blocks: ContentBlock[] = response.output?.message?.content ?? [];
      return blocks
        .map((b) => ("text" in b && b.text ? b.text : ""))
        .join("")
        .trim();
    }

    if (opts.provider === "copilot") {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models.length === 0) return "";
      const response = await models[0].sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        {},
        new vscode.CancellationTokenSource().token,
      );
      let text = "";
      for await (const chunk of response.text) text += chunk;
      return text.trim();
    }

    // local
    const { model } = await getLocalModel();
    const { LlamaChatSession } = await import("node-llama-cpp");
    const context = await model.createContext();
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });
    const text = await session.prompt(prompt);
    await context.dispose();
    return text.trim();
  } catch {
    return "";
  }
}

interface GenerateOptions {
  provider: LlmProvider;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
  question: string;
  destinationType: string;
  tableName?: string;
  onStatus?: (text: string) => void;
  /**
   * When true, the system prompt tells the model it may return raw data +
   * set postProcess=true for a follow-up analysis step. The assistant always
   * enables this today; when false the prompt omits that post-processing
   * guidance.
   */
  agentic?: boolean;
}

/**
 * Unified LLM interface. Hides the difference between Bedrock (Converse API
 * with tool calling) and VS Code Copilot (Language Model API with text parsing).
 */
export async function generateQuery(
  opts: GenerateOptions,
): Promise<GeneratedQuery> {
  if (opts.provider === "copilot") {
    return generateViaCopilot(opts);
  }
  if (opts.provider === "local") {
    return generateViaLocal(opts);
  }
  return generateViaBedrock(opts);
}

// ─── Bedrock ─────────────────────────────────────────────────────────────────

async function generateViaBedrock(
  opts: GenerateOptions,
): Promise<GeneratedQuery> {
  const client = new BedrockRuntimeClient({
    region: opts.region,
    credentials: opts.credentials,
  });
  const systemPrompt = buildSystemPrompt(opts.destinationType as any, {
    tableName: opts.tableName,
    agentic: opts.agentic,
  });

  const response = await client.send(
    new ConverseCommand({
      modelId: opts.modelId,
      system: [{ text: systemPrompt }],
      messages: [{ role: "user", content: [{ text: opts.question }] }],
      toolConfig: {
        tools: [EMIT_QUERY_TOOL],
        toolChoice: { tool: { name: "emit_query" } },
      },
      inferenceConfig: { maxTokens: 1024, temperature: 0 },
    }),
  );

  const blocks: ContentBlock[] = response.output?.message?.content ?? [];
  const toolUse = blocks.find((b) => "toolUse" in b && b.toolUse)?.toolUse;
  const input = toolUse?.input as
    | {
        query?: string;
        explanation?: string;
        timeRangeMs?: number;
        suggestedCharts?: string[];
        postProcess?: boolean;
        postProcessGoal?: string;
      }
    | undefined;

  if (!input?.query) {
    throw new Error(
      "The model did not return a query. Try rephrasing your question.",
    );
  }

  return {
    query: input.query.trim(),
    explanation: (input.explanation ?? "").trim(),
    timeRangeMs: input.timeRangeMs ?? DEFAULT_TIME_RANGE_MS,
    suggestedCharts: input.suggestedCharts,
    postProcess: input.postProcess === true,
    postProcessGoal:
      typeof input.postProcessGoal === "string"
        ? input.postProcessGoal.trim()
        : undefined,
  };
}

// ─── VS Code Copilot (Language Model API) ────────────────────────────────────

async function generateViaCopilot(
  opts: GenerateOptions,
): Promise<GeneratedQuery> {
  const models = await vscode.lm.selectChatModels({
    vendor: "copilot",
  });
  if (models.length === 0) {
    // Try without any filter to see what's available
    const allModels = await vscode.lm.selectChatModels();
    const available = allModels
      .map((m) => `${m.vendor}/${m.family}/${m.id}`)
      .join(", ");
    throw new Error(
      `No Copilot model found. Available models: [${available || "none"}]. Make sure GitHub Copilot is installed and you've signed in.`,
    );
  }

  const model = models[0];
  const systemPrompt = buildSystemPrompt(opts.destinationType as any, {
    tableName: opts.tableName,
    agentic: opts.agentic,
  });

  const messages = [
    vscode.LanguageModelChatMessage.User(
      `${systemPrompt}\n\nIMPORTANT: Respond with ONLY a JSON object in this exact format (no markdown, no code fences):\n{"query": "...", "explanation": "...", "timeRangeMs": ..., "suggestedCharts": ["...", "..."]}\n\nFor suggestedCharts, pick 2-4 from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot.\nIf timeRangeMs is not relevant, omit it.`,
    ),
    vscode.LanguageModelChatMessage.User(opts.question),
  ];

  const response = await model.sendRequest(
    messages,
    {},
    new vscode.CancellationTokenSource().token,
  );

  // Collect the streamed response
  let text = "";
  for await (const chunk of response.text) {
    text += chunk;
  }

  // Parse JSON from the response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*"query"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "Copilot did not return a valid query. Try rephrasing your question.",
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    query?: string;
    explanation?: string;
    timeRangeMs?: number;
    suggestedCharts?: string[];
  };
  if (!parsed.query) {
    throw new Error(
      "Copilot returned an empty query. Try rephrasing your question.",
    );
  }

  return {
    query: parsed.query.trim(),
    explanation: (parsed.explanation ?? "").trim(),
    timeRangeMs: parsed.timeRangeMs ?? DEFAULT_TIME_RANGE_MS,
    suggestedCharts: parsed.suggestedCharts,
  };
}

// ─── Local LLM (node-llama-cpp) ──────────────────────────────────────────────

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const MODEL_DIR = path.join(os.homedir(), ".workflow-insight", "models");

export interface LocalModelPreset {
  key: string;
  /** Short human label for the settings dropdown. */
  label: string;
  filename: string;
  url: string;
  /** Approximate download size, shown in the download status. */
  sizeLabel: string;
}

/**
 * Selectable local models, ordered best-first. The default is the highest
 * Berkeley Function-Calling Leaderboard (BFCL) score that still runs on a
 * typical single-GPU / laptop: Llama-3-Groq-8B-Tool-Use (~89% BFCL). The 70B
 * variant tops BFCL (~90.8%) but is ~40 GB and needs ~48 GB RAM, so it's not a
 * sane default. See https://gorilla.eecs.berkeley.edu/leaderboard.html
 */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    key: "llama-3-groq-8b-tool-use",
    label: "Llama-3-Groq-8B Tool-Use (best tool-calling, ~4.9 GB)",
    filename: "Llama-3-Groq-8B-Tool-Use-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3-Groq-8B-Tool-Use-GGUF/resolve/main/Llama-3-Groq-8B-Tool-Use-Q4_K_M.gguf",
    sizeLabel: "4.9 GB",
  },
  {
    key: "phi-3.5-mini",
    label: "Phi-3.5-mini (smaller, good quality-per-GB, ~2.4 GB)",
    filename: "Phi-3.5-mini-instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    sizeLabel: "2.4 GB",
  },
  {
    key: "qwen2.5-coder-3b",
    label: "Qwen2.5-Coder-3B (smallest footprint, ~2.2 GB)",
    filename: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    sizeLabel: "2.2 GB",
  },
];

export const DEFAULT_LOCAL_MODEL_KEY = LOCAL_MODEL_PRESETS[0].key;

let currentModelKey = DEFAULT_LOCAL_MODEL_KEY;
let localModelInstance: any = null;

function resolveLocalModel(): LocalModelPreset {
  return (
    LOCAL_MODEL_PRESETS.find((m) => m.key === currentModelKey) ??
    LOCAL_MODEL_PRESETS[0]
  );
}

/**
 * Select which local model preset subsequent local calls use. Unknown keys
 * fall back to the default. Switching drops the cached instance so the next
 * call loads the newly-selected model.
 */
export function setLocalModel(key: string | undefined): void {
  const next =
    LOCAL_MODEL_PRESETS.find((m) => m.key === key)?.key ??
    DEFAULT_LOCAL_MODEL_KEY;
  if (next !== currentModelKey) {
    currentModelKey = next;
    localModelInstance = null;
  }
}

export function isModelDownloaded(): boolean {
  return fs.existsSync(path.join(MODEL_DIR, resolveLocalModel().filename));
}

export async function ensureModel(
  statusCallback?: (text: string) => void,
): Promise<string> {
  const preset = resolveLocalModel();
  const modelPath = path.join(MODEL_DIR, preset.filename);
  if (fs.existsSync(modelPath)) return modelPath;

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  statusCallback?.(
    `Downloading ${preset.label.replace(/\s*\(.*\)$/, "")} (${preset.sizeLabel}, one time)...`,
  );

  const response = await fetch(preset.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download model: ${response.status}`);
  }

  const fileStream = fs.createWriteStream(modelPath);
  const reader = response.body.getReader();
  let downloaded = 0;
  const total = Number(response.headers.get("content-length") || 0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = Math.round((downloaded / total) * 100);
      statusCallback?.(`Downloading model... ${pct}%`);
    }
  }
  fileStream.end();
  await new Promise<void>((resolve) => fileStream.on("finish", resolve));
  return modelPath;
}

async function getLocalModel() {
  if (localModelInstance) return localModelInstance;

  const modelPath = await ensureModel();
  const { getLlama } = await import("node-llama-cpp");
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  localModelInstance = { model };
  return localModelInstance;
}

async function generateViaLocal(
  opts: GenerateOptions,
): Promise<GeneratedQuery> {
  const { model } = await getLocalModel();
  const { LlamaChatSession } = await import("node-llama-cpp");

  // Create a fresh context per query to avoid "No sequences left"
  const context = await model.createContext();
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
  });

  const systemPrompt = buildSystemPrompt(opts.destinationType as any, {
    tableName: opts.tableName,
    agentic: opts.agentic,
  });

  const prompt = `${systemPrompt}\n\nRespond with ONLY a JSON object: {"query": "...", "explanation": "...", "timeRangeMs": ..., "suggestedCharts": ["...", "..."]}\nFor suggestedCharts pick 2-4 from: bar, stacked-bar, line, area, scatter, heatmap, histogram, pie, boxplot.\nOmit timeRangeMs if not mentioned (default 24h).\n\nUser question: ${opts.question}`;

  const response = await session.prompt(prompt);
  await context.dispose();

  const jsonMatch = response.match(/\{[\s\S]*"query"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "Local model did not return a valid query. Try rephrasing your question.",
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    query?: string;
    explanation?: string;
    timeRangeMs?: number;
    suggestedCharts?: string[];
  };
  if (!parsed.query) {
    throw new Error(
      "Local model returned an empty query. Try rephrasing your question.",
    );
  }

  return {
    query: parsed.query.trim(),
    explanation: (parsed.explanation ?? "").trim(),
    timeRangeMs: parsed.timeRangeMs ?? DEFAULT_TIME_RANGE_MS,
    suggestedCharts: parsed.suggestedCharts,
  };
}
