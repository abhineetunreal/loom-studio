#!/usr/bin/env npx tsx
/**
 * Algorithmic Batch Colorway Generator — NO AI API needed.
 *
 * Generates themed recolors by:
 * 1. Loading the design's palette (sorted by coverage)
 * 2. For each theme, defining target hex colors per role (ground, accent, etc.)
 * 3. Finding the closest matching yarns from the Wool_Colors library via Delta-E
 * 4. Building preset URLs
 *
 * Usage:
 *   npx tsx scripts/batch-colorways-algo.ts --design "EJ 9" --themes warm,cool,earth
 *   npx tsx scripts/batch-colorways-algo.ts --design "Modern Oushak 5" --themes all --save
 *   npx tsx scripts/batch-colorways-algo.ts --help
 */

import "dotenv/config";
import { db } from "@/lib/db";

// ─── Delta-E (CIE76) color distance ──────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750) / 1.0;
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

function deltaE(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1);
  const [L2, a2, b2] = hexToLab(hex2);
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ─── HSL utilities ───────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

// ─── Theme definitions ──────────────────────────────────────────────────────

// Each theme provides a list of target hex colors to map the design's top
// palette entries into. The first target goes to the highest-coverage color
// (ground), subsequent ones to accent/motif colors in descending coverage.

interface ThemeDef {
  name: string;
  colorwayName: string;
  targets: string[]; // hex colors, ordered: ground → accents
}

const THEMES: Record<string, ThemeDef> = {
  warm: {
    name: "Warm",
    colorwayName: "Warm Terracotta",
    targets: [
      "#D2B48C", // tan ground
      "#A0522D", // sienna
      "#CD853F", // peru
      "#8B4513", // saddle brown
      "#DAA520", // goldenrod
      "#BC8F8F", // rosy brown
      "#F5DEB3", // wheat
      "#D2691E", // chocolate
    ],
  },
  cool: {
    name: "Cool",
    colorwayName: "Cool Slate",
    targets: [
      "#B0C4DE", // light steel blue ground
      "#2F4F4F", // dark slate gray
      "#5F9EA0", // cadet blue
      "#708090", // slate gray
      "#4682B4", // steel blue
      "#778899", // light slate gray
      "#6B8E9B", // teal-ish
      "#2E8B57", // sea green accent
    ],
  },
  earth: {
    name: "Earth",
    colorwayName: "Earthy Olive",
    targets: [
      "#C4B59D", // sand ground
      "#6B8E23", // olive drab
      "#8B7355", // burlap
      "#A0522D", // sienna
      "#556B2F", // dark olive green
      "#D2B48C", // tan
      "#8FBC8F", // dark sea green
      "#BDB76B", // dark khaki
    ],
  },
  jewel: {
    name: "Jewel",
    colorwayName: "Jewel Tone",
    targets: [
      "#191970", // midnight blue ground
      "#006400", // dark green (emerald)
      "#8B0000", // dark red (ruby)
      "#4B0082", // indigo (amethyst)
      "#DAA520", // goldenrod accent
      "#008080", // teal
      "#800020", // burgundy
      "#1A1A2E", // dark navy
    ],
  },
  neutral: {
    name: "Neutral",
    colorwayName: "Tonal Neutral",
    targets: [
      "#F5F5DC", // beige ground
      "#696969", // dim gray
      "#A9A9A9", // dark gray
      "#D3D3D3", // light gray
      "#808080", // gray
      "#DCDCDC", // gainsboro
      "#C0C0C0", // silver
      "#8B8589", // taupe gray
    ],
  },
  bold: {
    name: "Bold",
    colorwayName: "Bold Contemporary",
    targets: [
      "#1C1C1C", // near-black ground
      "#FF4500", // orange red
      "#FFD700", // gold
      "#00CED1", // dark turquoise
      "#FF1493", // deep pink
      "#32CD32", // lime green
      "#FF6347", // tomato
      "#FFFFFF", // white accent
    ],
  },
  pastel: {
    name: "Pastel",
    colorwayName: "Soft Pastel",
    targets: [
      "#FFF0F5", // lavender blush ground
      "#FFB6C1", // light pink
      "#E6E6FA", // lavender
      "#98FB98", // pale green
      "#ADD8E6", // light blue
      "#FFDAB9", // peach puff
      "#DDA0DD", // plum
      "#F0E68C", // khaki
    ],
  },
  monochrome: {
    name: "Monochrome",
    colorwayName: "Blue Monochrome",
    targets: [
      "#1E3A5F", // deep blue ground
      "#4169E1", // royal blue
      "#87CEEB", // sky blue
      "#191970", // midnight blue
      "#6495ED", // cornflower
      "#B0C4DE", // light steel
      "#000080", // navy
      "#ADD8E6", // light blue
    ],
  },
  traditional: {
    name: "Traditional",
    colorwayName: "Classic Persian",
    targets: [
      "#8B0000", // dark red ground
      "#191970", // midnight blue
      "#FFFFF0", // ivory
      "#DAA520", // goldenrod
      "#800020", // burgundy
      "#006400", // dark green
      "#F5DEB3", // wheat
      "#4B0082", // indigo
    ],
  },
  coastal: {
    name: "Coastal",
    colorwayName: "Coastal Breeze",
    targets: [
      "#F5F5DC", // sandy beige ground
      "#4682B4", // steel blue (ocean)
      "#20B2AA", // light sea green
      "#D2B48C", // tan (sand)
      "#87CEEB", // sky blue
      "#FF7F50", // coral accent
      "#778899", // driftwood gray
      "#E0FFFF", // light cyan
    ],
  },
  nordic: {
    name: "Nordic",
    colorwayName: "Nordic Minimal",
    targets: [
      "#F5F5F5", // near-white ground
      "#D3D3D3", // light gray
      "#8FBC8F", // dark sea green (sage)
      "#A9A9A9", // dark gray
      "#C4B59D", // light wood
      "#B0C4DE", // light steel blue
      "#696969", // dim gray
      "#E8E0D4", // off white
    ],
  },
  sunset: {
    name: "Sunset",
    colorwayName: "Desert Sunset",
    targets: [
      "#FF8C00", // dark orange ground
      "#FF6347", // tomato
      "#FF4500", // orange red
      "#FFD700", // gold
      "#C71585", // medium violet red
      "#4B0082", // indigo
      "#FF69B4", // hot pink
      "#DC143C", // crimson
    ],
  },
};

const ALL_THEMES = Object.keys(THEMES);

// ─── Palette type ────────────────────────────────────────────────────────────

interface PaletteEntry {
  index: number;
  hex: string;
  pixelCount: number;
  percentage: number;
}

interface YarnRow {
  code: string;
  name: string;
  hex: string;
  material: string | null;
}

// ─── CLI Arg parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result: {
    designName?: string;
    themes: string[];
    save: boolean;
    tenantSlug?: string;
    library?: string;
    topN: number;
    help: boolean;
  } = { themes: [], save: false, topN: 99, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--design" || arg === "-d") {
      result.designName = args[++i];
    } else if (arg === "--themes" || arg === "-t") {
      const val = args[++i];
      result.themes = val === "all" ? ALL_THEMES : val.split(",").map((t) => t.trim().toLowerCase());
    } else if (arg === "--save" || arg === "-s") {
      result.save = true;
    } else if (arg === "--tenant") {
      result.tenantSlug = args[++i];
    } else if (arg === "--library" || arg === "-l") {
      result.library = args[++i];
    } else if (arg === "--top" || arg === "-n") {
      result.topN = parseInt(args[++i], 10) || 6;
    }
  }
  return result;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║        ALGORITHMIC BATCH COLORWAY GENERATOR                    ║
║   No AI API key needed — pure color-distance matching          ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
  npx tsx scripts/batch-colorways-algo.ts --design <name> --themes <list> [options]

Options:
  --design, -d    Design name (partial match, required)
  --themes, -t    Comma-separated theme list, or "all" (required)
                  Available: ${ALL_THEMES.join(", ")}
  --save, -s      Save each colorway to the database
  --tenant        Tenant slug (default: auto-detect)
  --library, -l   Yarn library name (default: "Wool_Colors")
  --top, -n       Number of top palette colors to recolor (default 6)
  --help, -h      Show this help

Examples:
  npx tsx scripts/batch-colorways-algo.ts --design "EJ 9" --themes warm,cool,earth
  npx tsx scripts/batch-colorways-algo.ts --design "Modern Oushak 5" --themes all --save
  npx tsx scripts/batch-colorways-algo.ts -d "1202" -t jewel,bold,sunset -n 8
`);
}

// ─── Core: find closest yarn by Delta-E ──────────────────────────────────────

function findClosestYarn(targetHex: string, yarns: YarnRow[], exclude: Set<string>): YarnRow | null {
  let best: YarnRow | null = null;
  let bestDist = Infinity;

  for (const y of yarns) {
    if (exclude.has(y.code)) continue;
    const d = deltaE(targetHex, y.hex);
    if (d < bestDist) {
      bestDist = d;
      best = y;
    }
  }
  return best;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help || !opts.designName || opts.themes.length === 0) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  const invalidThemes = opts.themes.filter((t) => !THEMES[t]);
  if (invalidThemes.length > 0) {
    console.error(`Unknown themes: ${invalidThemes.join(", ")}`);
    console.error(`Available: ${ALL_THEMES.join(", ")}`);
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
    console.error("No tenant found.");
    process.exit(1);
  }
  console.log(`\n🏭 Tenant: ${tenant.name} (${tenant.slug})`);

  // Resolve design
  const design = await db.design.findFirst({
    where: {
      name: { contains: opts.designName, mode: "insensitive" },
      tenantId: tenant.id,
      isActive: true,
    },
    select: { id: true, name: true, palette: true },
  });
  if (!design) {
    console.error(`Design "${opts.designName}" not found.`);
    process.exit(1);
  }

  const palette = (design.palette as unknown as PaletteEntry[])
    .slice()
    .sort((a, b) => b.percentage - a.percentage);

  console.log(`🎨 Design: ${design.name} (${design.id})`);
  console.log(`   Palette: ${palette.length} colors, recoloring top ${Math.min(opts.topN, palette.length)}\n`);

  // Load yarn library
  const libraryName = opts.library ?? "Wool_Colors";
  const yarns = await db.yarnColor.findMany({
    where: {
      tenantId: tenant.id,
      isActive: true,
      material: { equals: libraryName, mode: "insensitive" },
    },
    select: { code: true, name: true, hex: true, material: true },
  });

  if (yarns.length === 0) {
    // Fall back to all yarns
    console.warn(`⚠️  No yarns found in library "${libraryName}", using all yarns.`);
    const allYarns = await db.yarnColor.findMany({
      where: { tenantId: tenant.id, isActive: true },
      select: { code: true, name: true, hex: true, material: true },
    });
    yarns.push(...allYarns);
  }
  console.log(`🧶 Yarn library: ${libraryName} (${yarns.length} yarns)\n`);

  // Find a TenantUser for saving (SavedColorway.userId → TenantUser)
  let tenantUserId: string | null = null;
  let tenantUserEmail: string | null = null;
  if (opts.save) {
    const tu = await db.tenantUser.findFirst({
      where: { tenantId: tenant.id, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true, email: true },
    });
    tenantUserId = tu?.id ?? null;
    tenantUserEmail = tu?.email ?? null;
    if (!tenantUserId) {
      console.warn("⚠️  No OWNER/ADMIN TenantUser found — colorways will not be saved.");
    }
  }

  // Grab the top N palette entries to recolor
  const topPalette = palette.slice(0, opts.topN);

  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Generating ${opts.themes.length} colorway(s) for "${design.name}"`);
  console.log(`  Themes: ${opts.themes.join(", ")}`);
  console.log(`  Save: ${opts.save ? "yes" : "no (preview URLs only)"}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  const results: Array<{
    theme: string;
    colorwayName: string;
    presetUrl: string | null;
    savedId: string | null;
    swaps: Array<{ fromHex: string; toCode: string; toHex: string; toName: string; dist: number }>;
  }> = [];

  for (let i = 0; i < opts.themes.length; i++) {
    const themeKey = opts.themes[i];
    const theme = THEMES[themeKey];
    const num = i + 1;

    console.log(`┌─ [${num}/${opts.themes.length}] Theme: ${theme.name} ${"─".repeat(Math.max(0, 45 - theme.name.length))}`);

    const usedCodes = new Set<string>();
    const swaps: typeof results[0]["swaps"] = [];
    const presetPairs: string[] = [];

    for (let j = 0; j < topPalette.length; j++) {
      const paletteEntry = topPalette[j];
      const targetHex = theme.targets[j % theme.targets.length];

      const closest = findClosestYarn(targetHex, yarns, usedCodes);
      if (!closest) continue;

      usedCodes.add(closest.code);
      const dist = Math.round(deltaE(targetHex, closest.hex) * 10) / 10;

      swaps.push({
        fromHex: paletteEntry.hex,
        toCode: closest.code,
        toHex: closest.hex,
        toName: closest.name,
        dist,
      });

      // Build preset pair using raw palette hex as original token
      const originalToken = paletteEntry.hex.toLowerCase();
      presetPairs.push(
        `${encodeURIComponent(originalToken)}>${encodeURIComponent(closest.code)}`,
      );

      console.log(
        `│  ${paletteEntry.hex} (${paletteEntry.percentage.toFixed(1)}%) → ${closest.code} ${closest.hex} "${closest.name}" (ΔE=${dist})`,
      );
    }

    const presetUrl = presetPairs.length > 0
      ? `/designs/${design.id}?preset=${presetPairs.join(",")}&library=${encodeURIComponent(libraryName)}`
      : null;

    // Save colorway if requested
    let savedId: string | null = null;
    if (opts.save && presetUrl && tenantUserId) {
      try {
        // Build colorMapping (legacy format: index → yarn info)
        const colorMapping: Record<string, { yarnId?: string; yarnCode: string; yarnHex: string; libraryName: string }> = {};
        for (const s of swaps) {
          const paletteIdx = palette.findIndex((p) => p.hex === s.fromHex);
          if (paletteIdx >= 0) {
            colorMapping[String(palette[paletteIdx].index)] = {
              yarnCode: s.toCode,
              yarnHex: s.toHex,
              libraryName: libraryName,
            };
          }
        }

        // Build operations (new format)
        const globalMap: Record<string, { hex: string; yarnCode: string }> = {};
        for (const s of swaps) {
          globalMap[s.fromHex] = { hex: s.toHex, yarnCode: s.toCode };
        }

        const colorway = await db.savedColorway.create({
          data: {
            designId: design.id,
            tenantId: tenant.id,
            userId: tenantUserId,
            userEmail: tenantUserEmail,
            name: `${theme.colorwayName} — ${design.name}`,
            colorMapping,
            operations: { globalMap, regionFills: [] },
          },
          select: { id: true },
        });
        savedId = colorway.id;
        console.log(`│  💾 Saved: ${savedId}`);
      } catch (err) {
        console.log(`│  ⚠️  Save failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (presetUrl) {
      console.log(`│  ✅ ${presetUrl}`);
    } else {
      console.log(`│  ⚠️  No swaps generated`);
    }
    console.log(`└${"─".repeat(62)}`);

    results.push({ theme: themeKey, colorwayName: theme.colorwayName, presetUrl, savedId, swaps });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(62)}`);
  console.log(`  BATCH GENERATION SUMMARY`);
  console.log(`${"═".repeat(62)}`);
  console.log(`  Design: ${design.name}`);
  console.log(`  Tenant: ${tenant.name}`);
  console.log(`  Library: ${libraryName} (${yarns.length} yarns)\n`);

  let ok = 0;
  for (const r of results) {
    const status = r.presetUrl ? "✅" : "⚠️";
    if (r.presetUrl) ok++;
    console.log(`  ${status} ${r.theme.padEnd(14)} ${r.colorwayName}`);
    if (r.presetUrl) {
      console.log(`${"".padEnd(19)}${r.presetUrl}`);
    }
    if (r.savedId) {
      console.log(`${"".padEnd(19)}💾 ${r.savedId}`);
    }
  }

  console.log(`\n  Generated: ${ok}/${results.length}`);
  console.log(`${"═".repeat(62)}\n`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
