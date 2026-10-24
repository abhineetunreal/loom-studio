#!/usr/bin/env npx tsx
/**
 * Batch Colorway Generator — drives Claude via the Anthropic API
 * with the same tool definitions as the Loom Studio AI chat.
 *
 * Usage:
 *   npx tsx scripts/batch-colorways.ts --design "EJ 9" --themes warm,cool,earth,jewel
 *   npx tsx scripts/batch-colorways.ts --design "1202" --themes all --save
 *   npx tsx scripts/batch-colorways.ts --help
 *
 * Requires: ANTHROPIC_API_KEY in .env (or environment)
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { AI_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";

// ─── Configuration ────────────────────────────────────────────────────────────

const AI_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_LOOPS = 12;

const THEME_PROMPTS: Record<string, string> = {
  warm: "Recolor this design in warm tones — terracotta, rust, gold, warm browns. Focus on the top colors by coverage. Name the colorway descriptively.",
  cool: "Recolor this design in cool tones — navy, teal, slate blue, sage green. Create a modern, calming palette. Name it descriptively.",
  earth: "Recolor this design in earthy natural tones — olive, sienna, clay, sand, mushroom. Think organic and grounded. Name it descriptively.",
  jewel: "Recolor this design in rich jewel tones — emerald, sapphire, ruby, amethyst. Deep saturated colors. Name it descriptively.",
  neutral: "Recolor this design in a tonal neutral palette — ivory, taupe, charcoal, greige. Subtle and sophisticated. Name it descriptively.",
  bold: "Recolor this design in a bold contemporary palette — strong contrasting colors, modern and eye-catching. Name it descriptively.",
  pastel: "Recolor this design in soft pastel tones — blush pink, lavender, mint, pale blue. Light and airy. Name it descriptively.",
  monochrome: "Recolor this design in a monochromatic palette — pick one dominant hue family and use different shades/tints of it. Name it descriptively.",
  traditional: "Recolor this design in a classic traditional rug palette — deep reds, navy, ivory, gold. Timeless Persian/Oriental colors. Name it descriptively.",
  coastal: "Recolor this design in a coastal palette — sandy beige, ocean blue, seafoam, driftwood gray, coral accents. Name it descriptively.",
  nordic: "Recolor this design in a Scandinavian/Nordic palette — muted whites, pale grays, soft sage, natural wood tones. Clean and minimal. Name it descriptively.",
  sunset: "Recolor this design in sunset tones — burnt orange, coral, magenta, golden yellow fading to deep indigo. Name it descriptively.",
};

const ALL_THEMES = Object.keys(THEME_PROMPTS);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result: {
    designId?: string;
    designName?: string;
    themes: string[];
    save: boolean;
    tenantSlug?: string;
    library?: string;
    help: boolean;
  } = { themes: [], save: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--design" || arg === "-d") {
      const val = args[++i];
      // If it looks like a CUID/UUID, treat as ID; otherwise name
      if (val && /^[a-z0-9]{20,}$/i.test(val)) {
        result.designId = val;
      } else {
        result.designName = val;
      }
    } else if (arg === "--themes" || arg === "-t") {
      const val = args[++i];
      if (val === "all") {
        result.themes = ALL_THEMES;
      } else {
        result.themes = val.split(",").map((t) => t.trim().toLowerCase());
      }
    } else if (arg === "--save" || arg === "-s") {
      result.save = true;
    } else if (arg === "--tenant") {
      result.tenantSlug = args[++i];
    } else if (arg === "--library" || arg === "-l") {
      result.library = args[++i];
    }
  }

  return result;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               BATCH COLORWAY GENERATOR                         ║
║   Drives Claude to generate multiple themed recolors           ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
  npx tsx scripts/batch-colorways.ts --design <name|id> --themes <list> [options]

Options:
  --design, -d    Design name or ID (required)
  --themes, -t    Comma-separated theme list, or "all" (required)
                  Available: ${ALL_THEMES.join(", ")}
  --save, -s      Also save each colorway to the database
  --tenant        Tenant slug (default: auto-detect first tenant)
  --library, -l   Restrict to a yarn library (e.g. "OneLoom")
  --help, -h      Show this help

Examples:
  npx tsx scripts/batch-colorways.ts --design "EJ 9" --themes warm,cool,earth
  npx tsx scripts/batch-colorways.ts --design "Modern Oushak 5" --themes all --save
  npx tsx scripts/batch-colorways.ts -d "1202" -t jewel,bold,sunset -s
`);
}

// ─── Anthropic agentic loop ──────────────────────────────────────────────────

async function runAgenticLoop(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  tenantId: string,
  userId: string,
): Promise<{
  textOutput: string;
  presetUrls: string[];
  savedColorways: string[];
  toolCalls: Array<{ name: string; result: unknown }>;
}> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const presetUrls: string[] = [];
  const savedColorways: string[] = [];
  const toolCalls: Array<{ name: string; result: unknown }> = [];
  let textOutput = "";
  let loopCount = 0;

  while (loopCount++ < MAX_TOOL_LOOPS) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: AI_TOOLS as Anthropic.Tool[],
      messages,
    });

    const assistantContent = response.content;
    const toolUseBlocks: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }> = [];

    for (const block of assistantContent) {
      if (block.type === "text") {
        textOutput += block.text;
      } else if (block.type === "tool_use") {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // If no tool calls, done
    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tool of toolUseBlocks) {
      try {
        const result = await executeAiTool(tool.name, tool.input, {
          tenantId,
          userId,
        });
        const parsed = JSON.parse(result);

        // Capture preset URLs and saved colorway IDs
        if (tool.name === "propose_recolor" && parsed.presetUrl) {
          presetUrls.push(parsed.presetUrl);
        }
        if (tool.name === "save_colorway" && parsed.colorwayId) {
          savedColorways.push(parsed.colorwayId);
        }

        toolCalls.push({ name: tool.name, result: parsed });

        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Tool execution failed";
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: JSON.stringify({ error: errorMsg }),
          is_error: true,
        });
      }
    }

    // Continue loop with tool results
    messages.push(
      { role: "assistant", content: assistantContent },
      { role: "user", content: toolResults },
    );
  }

  return { textOutput, presetUrls, savedColorways, toolCalls };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help || (!opts.designId && !opts.designName) || opts.themes.length === 0) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  // Validate themes
  const invalidThemes = opts.themes.filter((t) => !THEME_PROMPTS[t]);
  if (invalidThemes.length > 0) {
    console.error(`Unknown themes: ${invalidThemes.join(", ")}`);
    console.error(`Available: ${ALL_THEMES.join(", ")}`);
    process.exit(1);
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env or set it in the environment.");
    process.exit(1);
  }

  // Resolve tenant
  let tenant: { id: string; slug: string; name: string } | null;
  if (opts.tenantSlug) {
    tenant = await db.tenant.findFirst({
      where: { slug: opts.tenantSlug },
      select: { id: true, slug: true, name: true },
    });
  } else {
    tenant = await db.tenant.findFirst({
      select: { id: true, slug: true, name: true },
    });
  }
  if (!tenant) {
    console.error("No tenant found. Use --tenant <slug> to specify.");
    process.exit(1);
  }
  console.log(`\n🏭 Tenant: ${tenant.name} (${tenant.slug})`);

  // Resolve design
  let design: { id: string; name: string } | null;
  if (opts.designId) {
    design = await db.design.findFirst({
      where: { id: opts.designId, tenantId: tenant.id, isActive: true },
      select: { id: true, name: true },
    });
  } else {
    design = await db.design.findFirst({
      where: {
        name: { contains: opts.designName!, mode: "insensitive" },
        tenantId: tenant.id,
        isActive: true,
      },
      select: { id: true, name: true },
    });
  }
  if (!design) {
    console.error(`Design "${opts.designId ?? opts.designName}" not found for tenant ${tenant.slug}.`);
    process.exit(1);
  }
  console.log(`🎨 Design: ${design.name} (${design.id})`);

  // Find a platform user to act as (the first SUPER_OWNER)
  const platformUser = await db.platformUser.findFirst({
    where: { role: "SUPER_OWNER" },
    select: { id: true, email: true },
  });
  if (!platformUser) {
    console.error("No SUPER_OWNER PlatformUser found.");
    process.exit(1);
  }
  console.log(`👤 Acting as: ${platformUser.email}\n`);

  // Build system prompt with active design context
  const systemPrompt = `${AI_SYSTEM_PROMPT}

## Active Design (IMPORTANT)
The user currently has design ID "${design.id}" open in the editor right now. When they say "this design", "the same", "it", "this rug", or give a recolor/color instruction without naming a design, they mean THIS design. Before proposing any recolor, call get_design with id "${design.id}" to load its current palette. Do NOT call list_designs to guess which design they mean — you already know it.

## Batch Generation Mode
You are generating batch colorways. For EVERY theme request:
1. First call get_design to load the palette
2. Then search for yarns matching the theme colors
3. Then call propose_recolor to build a preview URL
${opts.save ? "4. Then call save_colorway to persist it" : ""}
Always complete the full flow — do NOT just describe colors, actually build the preset URL${opts.save ? " and save the colorway" : ""}.${
    opts.library
      ? `\n\nIMPORTANT: Use ONLY yarns from the "${opts.library}" library.`
      : ""
  }`;

  const client = new Anthropic({ apiKey });

  // Run each theme
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Generating ${opts.themes.length} colorway(s) for "${design.name}"`);
  console.log(`  Themes: ${opts.themes.join(", ")}`);
  console.log(`  Save: ${opts.save ? "yes" : "no (preview URLs only)"}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  const results: Array<{
    theme: string;
    presetUrls: string[];
    savedColorways: string[];
    text: string;
    error?: string;
  }> = [];

  for (let i = 0; i < opts.themes.length; i++) {
    const theme = opts.themes[i];
    const prompt = THEME_PROMPTS[theme];
    const num = i + 1;

    console.log(`\n┌─ [${num}/${opts.themes.length}] Theme: ${theme.toUpperCase()} ${"─".repeat(Math.max(0, 45 - theme.length))}`);
    console.log(`│  Prompt: "${prompt.slice(0, 80)}..."`);

    const userMessage = opts.save
      ? `${prompt} After building the preset URL, also save this colorway with a descriptive name.`
      : prompt;

    try {
      const t0 = Date.now();
      const result = await runAgenticLoop(
        client,
        systemPrompt,
        userMessage,
        tenant.id,
        platformUser.id,
      );
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      // Show tool calls
      for (const tc of result.toolCalls) {
        const summary =
          tc.name === "propose_recolor"
            ? `→ ${(tc.result as { presetUrl?: string }).presetUrl ?? "no URL"}`
            : tc.name === "save_colorway"
              ? `→ saved as ${(tc.result as { colorwayId?: string }).colorwayId ?? "?"}`
              : "";
        console.log(`│  📦 ${tc.name} ${summary}`);
      }

      // Show results
      if (result.presetUrls.length > 0) {
        for (const url of result.presetUrls) {
          console.log(`│  ✅ Preview URL: ${url}`);
        }
      } else {
        console.log(`│  ⚠️  No preset URL generated`);
      }

      if (result.savedColorways.length > 0) {
        for (const cw of result.savedColorways) {
          console.log(`│  💾 Saved colorway: ${cw}`);
        }
      }

      // Extract colorway name from text
      const nameMatch = result.textOutput.match(
        /(?:named?|called|titled)\s+(?:it\s+)?[""]([^""]+)[""]/i,
      );
      if (nameMatch) {
        console.log(`│  🏷️  Name: "${nameMatch[1]}"`);
      }

      console.log(`│  ⏱️  ${elapsed}s`);
      console.log(`└${"─".repeat(62)}`);

      results.push({
        theme,
        presetUrls: result.presetUrls,
        savedColorways: result.savedColorways,
        text: result.textOutput,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`│  ❌ Error: ${errorMsg}`);
      console.log(`└${"─".repeat(62)}`);
      results.push({
        theme,
        presetUrls: [],
        savedColorways: [],
        text: "",
        error: errorMsg,
      });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(62)}`);
  console.log(`  BATCH GENERATION SUMMARY`);
  console.log(`${"═".repeat(62)}`);
  console.log(`  Design: ${design.name} (${design.id})`);
  console.log(`  Tenant: ${tenant.name}`);
  console.log();

  let successCount = 0;
  for (const r of results) {
    const status = r.presetUrls.length > 0 ? "✅" : r.error ? "❌" : "⚠️";
    if (r.presetUrls.length > 0) successCount++;
    console.log(`  ${status} ${r.theme.padEnd(14)} ${r.presetUrls[0] ?? r.error ?? "no URL"}`);
    if (r.savedColorways.length > 0) {
      console.log(`${"".padEnd(19)}💾 ${r.savedColorways[0]}`);
    }
  }

  console.log(`\n  Generated: ${successCount}/${results.length}`);
  if (opts.save) {
    const saved = results.reduce((n, r) => n + r.savedColorways.length, 0);
    console.log(`  Saved: ${saved}`);
  }
  console.log(`${"═".repeat(62)}\n`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
