// Centralized AI price table. Values are USD per 1M tokens unless noted.
// Source: Google Gemini API pricing, fetched/checked 2026-05-19.

type ChatPrice = {
  inputTextPer1M: number;
  inputAudioPer1M?: number;
  outputPer1M: number;
};

const CHAT_PRICES: Record<string, ChatPrice> = {
  "gemini-2.5-flash": { inputTextPer1M: 0.30, inputAudioPer1M: 1.00, outputPer1M: 2.50 },
  "gemini-2.5-flash-lite": { inputTextPer1M: 0.10, inputAudioPer1M: 0.30, outputPer1M: 0.40 },
  "gemini-2.5-flash-lite-preview": { inputTextPer1M: 0.10, inputAudioPer1M: 0.30, outputPer1M: 0.40 },
  "gemini-2.5-flash-lite-preview-09-2025": { inputTextPer1M: 0.10, inputAudioPer1M: 0.30, outputPer1M: 0.40 },
  "gemini-2.5-pro": { inputTextPer1M: 1.25, outputPer1M: 10.00 },
  "gemini-3-flash-preview": { inputTextPer1M: 0.50, inputAudioPer1M: 1.00, outputPer1M: 3.00 },
  "gemini-3.1-flash-lite": { inputTextPer1M: 0.25, inputAudioPer1M: 0.50, outputPer1M: 1.50 },
  "gemini-3.1-flash-lite-preview": { inputTextPer1M: 0.25, inputAudioPer1M: 0.50, outputPer1M: 1.50 },
  "gemini-3.1-pro-preview": { inputTextPer1M: 2.00, outputPer1M: 12.00 },
};

const EMBEDDING_INPUT_PER_1M: Record<string, number> = {
  "gemini-embedding-001": 0.15,
  "gemini-embedding-2": 0.20,
  "text-embedding-004": 0.025,
};

export function normalizeAiModel(model: string): string {
  return String(model || "")
    .replace(/^google\//, "")
    .replace(/^models\//, "")
    .trim();
}

export function chatTokenCostUsd(model: string, inputTokens: number, outputTokens: number, inputModality: "text" | "audio" = "text"): number {
  const key = normalizeAiModel(model);
  const price = CHAT_PRICES[key] || CHAT_PRICES["gemini-2.5-flash"];
  const inputPer1M = inputModality === "audio" ? (price.inputAudioPer1M || price.inputTextPer1M) : price.inputTextPer1M;
  return (Math.max(0, inputTokens) * inputPer1M + Math.max(0, outputTokens) * price.outputPer1M) / 1_000_000;
}

export function embeddingTokenCostUsd(model: string, inputTokens: number): number {
  const key = normalizeAiModel(model);
  const inputPer1M = EMBEDDING_INPUT_PER_1M[key] ?? EMBEDDING_INPUT_PER_1M["gemini-embedding-001"];
  return (Math.max(0, inputTokens) * inputPer1M) / 1_000_000;
}

// Gemini 2.5+ bills "thinking" tokens as OUTPUT but returns them separately.
// OpenAI-compat: usage.completion_tokens_details.reasoning_tokens
// Native Generative Language API: usageMetadata.thoughtsTokenCount
// Also handles cached input tokens (subtracted to avoid double-billing on cache hits).
export function geminiOutputTokens(usage: any): number {
  if (!usage) return 0;
  const compat = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const reasoningCompat = Number(usage.completion_tokens_details?.reasoning_tokens ?? 0);
  const candidates = Number(usage.candidatesTokenCount ?? 0);
  const thoughts = Number(usage.thoughtsTokenCount ?? 0);
  // OpenAI-compat path: completion_tokens already includes reasoning in some providers, not in Gemini.
  // Sum both defensively — reasoning_tokens is 0 when not applicable.
  return Math.max(compat + reasoningCompat, candidates + thoughts);
}

export function geminiInputTokens(usage: any): number {
  if (!usage) return 0;
  const compat = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const native = Number(usage.promptTokenCount ?? 0);
  return Math.max(compat, native);
}