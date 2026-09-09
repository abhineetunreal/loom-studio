import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const BASE_URL =
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://studio.carpetsbazaar.com";

async function fetchApi(path: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export const handler = createMcpHandler(
  (server) => {
    // ── Tool 1: browse_designs ─────────────────────────────────────────────
    server.registerTool(
      "browse_designs",
      {
        title: "Browse Rug Designs",
        description:
          "Browse the rug design catalog. Returns designs with their color palettes, yarn codes, and live preview URLs.",
        inputSchema: {
          apiKey: z.string().describe("Tenant API key"),
          collection: z.string().optional().describe("Filter by collection name"),
          limit: z.number().int().min(1).max(200).default(20).describe("Max results (default 20)"),
          offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        },
      },
      async ({ apiKey, collection, limit, offset }) => {
        const params: Record<string, string> = {
          limit: String(limit),
          offset: String(offset),
        };
        if (collection) params.collection = collection;

        const data = await fetchApi("/api/ai/designs", apiKey, params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── Tool 2: browse_yarns ───────────────────────────────────────────────
    server.registerTool(
      "browse_yarns",
      {
        title: "Browse Yarn Colors",
        description:
          "Browse available yarn colors from real wool libraries. Returns yarn codes, hex colors, and whether photorealistic swatch textures are available.",
        inputSchema: {
          apiKey: z.string().describe("Tenant API key"),
          library: z.string().optional().describe("Filter by library name (e.g. 'Wool Swatches', 'OneLoom')"),
          renderType: z
            .enum(["photo", "shader"])
            .optional()
            .describe("Filter by render type: 'photo' for photorealistic swatches, 'shader' for procedural"),
          limit: z.number().int().min(1).max(500).default(50).describe("Max results (default 50)"),
          offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        },
      },
      async ({ apiKey, library, renderType, limit, offset }) => {
        const params: Record<string, string> = {
          limit: String(limit),
          offset: String(offset),
        };
        if (library) params.library = library;
        if (renderType) params.renderType = renderType;

        const data = await fetchApi("/api/ai/yarns", apiKey, params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      },
    );

    // ── Tool 3: create_preset_url ──────────────────────────────────────────
    server.registerTool(
      "create_preset_url",
      {
        title: "Create Preset URL",
        description:
          "Build a live preview URL that shows a rug design with custom yarn color swaps. The URL opens the recolorizer with photorealistic wool textures applied.",
        inputSchema: {
          designLiveUrl: z.string().url().describe("The liveUrl from browse_designs"),
          colorSwaps: z
            .array(
              z.object({
                originalYarnCode: z
                  .string()
                  .describe("Original yarn code from the design's colors[].yarnCode (short code, left side of >)"),
                replacementCode: z
                  .string()
                  .describe("Replacement yarn code from browse_yarns yarns[].code (full code, right side of >)"),
              }),
            )
            .min(1)
            .describe("Color swap pairs"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ designLiveUrl, colorSwaps }) => {
        const swapStr = colorSwaps
          .map(
            (s) =>
              `${encodeURIComponent(s.originalYarnCode)}>${encodeURIComponent(s.replacementCode)}`,
          )
          .join(",");

        const sep = designLiveUrl.includes("?") ? "&" : "?";
        const url = `${designLiveUrl}${sep}preset=${swapStr}`;

        return {
          content: [
            {
              type: "text" as const,
              text: [
                url,
                "",
                `Preview URL ready — ${colorSwaps.length} color${colorSwaps.length !== 1 ? "s" : ""} swapped. The customer clicks this to see the rug with photorealistic wool textures and can keep customizing.`,
              ].join("\n"),
            },
          ],
        };
      },
    );

    // ── Prompt: design_rug ─────────────────────────────────────────────────
    server.registerPrompt("design_rug", {
      title: "Rug Color Design Advisor",
      description: "A structured starting prompt for helping customers design custom rug colorways.",
    }, () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "You are a rug color design advisor. Help the customer choose colors for a hand-knotted rug.",
              "",
              "1. Ask about their style, room colors, or mood",
              "2. Use browse_designs to find matching designs",
              "3. Use browse_yarns to find replacement yarns — prefer hasTexture:true for photorealistic results",
              "4. Use create_preset_url to build the preview link",
              "5. Present the link with a warm, knowledgeable description",
              "",
              "Focus on the highest-percentage colors for the biggest visual impact. Don't swap every color — 2-5 strategic swaps work best.",
              "",
              "The original yarn codes (left side of >) come from the design's colors[].yarnCode.",
              "The replacement codes (right side of >) come from yarns[].code.",
            ].join("\n"),
          },
        },
      ],
    }));
  },
  {
    serverInfo: {
      name: "loom-studio",
      version: "1.0.0",
    },
  },
);
