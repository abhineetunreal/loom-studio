// AI client — Anthropic SDK singleton for server-side use.
//
// ANTHROPIC_API_KEY must be set in environment variables (Vercel project settings).
// Never expose this key to the client.

import Anthropic from "@anthropic-ai/sdk";

function createClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

const globalForAnthropic = globalThis as unknown as { anthropic?: Anthropic };

export const anthropic = globalForAnthropic.anthropic ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForAnthropic.anthropic = anthropic;
}

// Default model — Claude Sonnet for good reasoning about color theory & design
export const AI_MODEL = "claude-sonnet-4-20250514";

// Max tokens per response
export const AI_MAX_TOKENS = 4096;
