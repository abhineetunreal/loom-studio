// AI client — Anthropic SDK singleton for server-side use.
//
// ANTHROPIC_API_KEY must be set in environment variables (Vercel project settings).
// Never expose this key to the client.

import Anthropic from "@anthropic-ai/sdk";

// Lazily construct the Anthropic client on first use, NOT at module load.
//
// If this ran at import time it would throw whenever ANTHROPIC_API_KEY is
// absent — which breaks `next build` page-data collection for every route in
// the app (e.g. Preview deployments where the key isn't scoped, or local
// builds), even routes that never touch the AI. Deferring to first access
// means the key is only required when the AI is actually invoked (request
// time), where a missing key still throws a clear error.

const globalForAnthropic = globalThis as unknown as { anthropic?: Anthropic };

function getClient(): Anthropic {
  if (globalForAnthropic.anthropic) return globalForAnthropic.anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  globalForAnthropic.anthropic = client;
  return client;
}

// A Proxy so existing call sites keep using `anthropic.messages.create(...)`
// unchanged; the real client is built (and the key checked) on first property
// access, not when this module is imported.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Default model — Claude Sonnet for good reasoning about color theory & design
export const AI_MODEL = "claude-sonnet-4-6";

// Max tokens per response
export const AI_MAX_TOKENS = 4096;
