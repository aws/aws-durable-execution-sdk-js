import * as vscode from "vscode";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import { buildSystemPrompt } from "./schema";

export interface GeneratedQuery {
  query: string;
  explanation: string;
  timeRangeMs: number;
  suggestedCharts?: string[];
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
        },
        required: ["query", "explanation"],
      },
    },
  },
};

export type LlmProvider = "bedrock" | "copilot" | "local";

interface GenerateOptions {
  provider: LlmProvider;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  modelId: string;
  question: string;
  destinationType: string;
  tableName?: string;
  onStatus?: (text: string) => void;
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
const MODEL_FILENAME = "qwen2.5-coder-3b-instruct-q4_k_m.gguf";
const MODEL_URL =
  "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf";

let localModelInstance: any = null;

export function isModelDownloaded(): boolean {
  return fs.existsSync(path.join(MODEL_DIR, MODEL_FILENAME));
}

export async function ensureModel(
  statusCallback?: (text: string) => void,
): Promise<string> {
  const modelPath = path.join(MODEL_DIR, MODEL_FILENAME);
  if (fs.existsSync(modelPath)) return modelPath;

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  statusCallback?.("Downloading local model (2.2 GB, one time)...");

  const response = await fetch(MODEL_URL);
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
