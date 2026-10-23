// Server-side AI tool definitions for the Anthropic Messages API.
//
// These tools let Claude interact with the rug design system:
// browse designs, search yarn palettes, propose recolors, and save colorways.
// All backed by direct Prisma queries — no HTTP round-trips.

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

// ─── Delta-E color distance (CIE76) ──────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // sRGB → linear RGB
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // Linear RGB → XYZ (D65 illuminant)
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750) / 1.0;
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;

  // XYZ → Lab
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x);
  y = f(y);
  z = f(z);

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/** CIE76 Delta-E distance between two hex colors. Lower = more similar. */
export function deltaE(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1);
  const [L2, a2, b2] = hexToLab(hex2);
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ─── Tool definitions (Anthropic API format) ─────────────────────────────────

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_design",
    description:
      "Fetch full details for a single rug design, including its color palette with yarn code mappings and an image URL you can analyze. Use this when you need to understand a design's current colors before proposing recolors.",
    input_schema: {
      type: "object" as const,
      properties: {
        designId: {
          type: "string",
          description: "The design's unique ID. Provide either designId or designName.",
        },
        designName: {
          type: "string",
          description:
            "Search by design name (case-insensitive partial match). Provide either designId or designName.",
        },
      },
    },
  },
  {
    name: "list_designs",
    description:
      "Browse the rug design catalog. Returns a list of available designs with their names, collections, color counts, and thumbnail URLs. Use this to find designs to work with.",
    input_schema: {
      type: "object" as const,
      properties: {
        collection: {
          type: "string",
          description: "Filter by collection name (exact match).",
        },
        limit: {
          type: "number",
          description: "Maximum number of designs to return (default 20, max 100).",
        },
      },
    },
  },
  {
    name: "get_yarn_palette",
    description:
      "Fetch available yarn colors from the tenant's physical yarn libraries. Each yarn has a code, display hex color, and whether photorealistic swatch textures are available. The response includes `availableLibraries` (the real library names for this tenant with counts) — call this with no library first to see what exists, then narrow if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        library: {
          type: "string",
          description:
            "Yarn library name to browse. Optional — omit to return yarns from ALL of the tenant's libraries. Matched case-insensitively; if it doesn't match a real library the tool returns all libraries instead of an empty list. Check `availableLibraries` in the response for valid names.",
        },
        limit: {
          type: "number",
          description: "Maximum number of yarns to return (default 200, max 500).",
        },
      },
    },
  },
  {
    name: "search_yarns_by_color",
    description:
      "Find the closest matching yarn colors to a target hex color, ranked by perceptual color distance (Delta-E). Use this to find real wool yarns that best approximate a desired color — essential for translating trend colors into manufacturable yarn choices.",
    input_schema: {
      type: "object" as const,
      properties: {
        targetHex: {
          type: "string",
          description:
            'The target color as a hex string (e.g. "#8B4513"). The tool finds yarns closest to this color.',
        },
        library: {
          type: "string",
          description:
            "Yarn library to search within. Optional — omit to search across ALL of the tenant's yarns. Matched case-insensitively; falls back to all libraries if it doesn't match a real one.",
        },
        limit: {
          type: "number",
          description: "Number of closest matches to return (default 10).",
        },
      },
      required: ["targetHex"],
    },
  },
  {
    name: "propose_recolor",
    description:
      "Validate a set of color swaps against real yarn codes and build a live preview URL. Each swap replaces one yarn in the design with another from the yarn library. Returns a preset URL that renders the recolored rug with photorealistic wool textures. Use this after deciding which colors to swap.",
    input_schema: {
      type: "object" as const,
      properties: {
        designId: {
          type: "string",
          description: "The design to recolor.",
        },
        colorSwaps: {
          type: "array",
          description:
            "Array of color swap pairs. Each fromYarnCode is the original yarn code in the design's palette, and toYarnCode is the replacement from the yarn library.",
          items: {
            type: "object",
            properties: {
              fromYarnCode: {
                type: "string",
                description:
                  "The design color to replace, taken from get_design's colors list. Use that color's `yarnCode` when it is present; if `yarnCode` is null (the design isn't mapped in ColorLookup), use its `hex` instead (e.g. '#b3b8bb'). Both are accepted.",
              },
              toYarnCode: {
                type: "string",
                description:
                  "Replacement yarn code from the yarn library (e.g. 'WC-TR12'). Must be a valid code from get_yarn_palette or search_yarns_by_color.",
              },
            },
            required: ["fromYarnCode", "toYarnCode"],
          },
        },
      },
      required: ["designId", "colorSwaps"],
    },
  },
  {
    name: "save_colorway",
    description:
      "Save a recolored design as a named colorway. This persists the color mapping so the user can revisit it later. Use this after the user approves a proposed recolor.",
    input_schema: {
      type: "object" as const,
      properties: {
        designId: {
          type: "string",
          description: "The design that was recolored.",
        },
        name: {
          type: "string",
          description:
            "A descriptive name for this colorway (e.g. 'Autumn Warmth', 'Ocean Blue Variant 2').",
        },
        globalSwaps: {
          type: "array",
          description:
            "Global color replacements — each entry maps an original palette hex to a replacement yarn code. Applied to every pixel of that color.",
          items: {
            type: "object",
            properties: {
              originalHex: {
                type: "string",
                description: "Original palette color hex (e.g. '#8B4513').",
              },
              yarnCode: {
                type: "string",
                description: "Replacement yarn code (e.g. 'WC-TR12').",
              },
            },
            required: ["originalHex", "yarnCode"],
          },
        },
        regionFills: {
          type: "array",
          description:
            "Optional region-specific fills — each entry recolors one closed boundary region of the design, identified by its boundary index.",
          items: {
            type: "object",
            properties: {
              originalColor: {
                type: "string",
                description: "The hex color of the region before filling.",
              },
              newYarnCode: {
                type: "string",
                description: "Replacement yarn code for this region.",
              },
              boundaryIndex: {
                type: "number",
                description:
                  "Zero-based index identifying which closed boundary region to fill.",
              },
            },
            required: ["originalColor", "newYarnCode", "boundaryIndex"],
          },
        },
      },
      required: ["designId", "name", "globalSwaps"],
    },
  },
];

// ─── Tool execution context ──────────────────────────────────────────────────

export type ToolContext = {
  tenantId: string;
  userId?: string;
  userEmail?: string;
};

// ─── Tool executor ───────────────────────────────────────────────────────────

export async function executeAiTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (toolName) {
      case "get_design":
        return await handleGetDesign(toolInput, ctx);
      case "list_designs":
        return await handleListDesigns(toolInput, ctx);
      case "get_yarn_palette":
        return await handleGetYarnPalette(toolInput, ctx);
      case "search_yarns_by_color":
        return await handleSearchYarnsByColor(toolInput, ctx);
      case "propose_recolor":
        return await handleProposeRecolor(toolInput, ctx);
      case "save_colorway":
        return await handleSaveColorway(toolInput, ctx);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AI Tool Error] ${toolName}:`, err);
    return JSON.stringify({ error: message });
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

type PaletteEntry = {
  index: number;
  hex: string;
  pixelCount: number;
  percentage: number;
  matchedYarnCode?: string;
};

async function handleGetDesign(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { designId, designName } = input as {
    designId?: string;
    designName?: string;
  };

  if (!designId && !designName) {
    return JSON.stringify({ error: "Provide either designId or designName." });
  }

  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    isActive: true,
  };
  if (designId) {
    where.id = designId;
  } else if (designName) {
    where.name = { contains: designName, mode: "insensitive" };
  }

  const design = await db.design.findFirst({
    where,
    select: {
      id: true,
      name: true,
      imageUrl: true,
      width: true,
      height: true,
      palette: true,
      collection: { select: { name: true } },
    },
  });

  if (!design) {
    return JSON.stringify({ error: "Design not found." });
  }

  // Fetch ColorLookup mappings for this tenant
  const lookups = await db.colorLookup.findMany({
    where: { tenantId: ctx.tenantId },
    select: { renderedHex: true, yarnCode: true },
  });
  const hexToYarnCode = new Map(lookups.map((l: { renderedHex: string; yarnCode: string }) => [l.renderedHex.toLowerCase(), l.yarnCode]));

  const palette = (design.palette as PaletteEntry[]) ?? [];
  const colors = palette
    .sort((a, b) => b.percentage - a.percentage)
    .map((c) => ({
      hex: c.hex,
      percentage: Math.round(c.percentage * 10) / 10,
      paletteIndex: c.index,
      // Prefer the ColorLookup code — that is the "original code" the preset
      // resolver (/designs/[id]?preset=) understands. matchedYarnCode is only a
      // fallback and may not exist in ColorLookup, which would make a swap
      // silently fail to apply.
      yarnCode: hexToYarnCode.get(c.hex.toLowerCase()) ?? c.matchedYarnCode ?? null,
    }));

  const wFt = design.width ? (design.width / 120).toFixed(1) : null;
  const hFt = design.height ? (design.height / 120).toFixed(1) : null;

  return JSON.stringify(
    {
      id: design.id,
      name: design.name,
      collection: design.collection?.name ?? null,
      dimensions: wFt && hFt ? `${wFt} × ${hFt} ft` : null,
      colorCount: palette.length,
      colors,
      imageUrl: design.imageUrl,
    },
    null,
    2,
  );
}

async function handleListDesigns(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { collection, limit: rawLimit } = input as {
    collection?: string;
    limit?: number;
  };
  const limit = Math.min(Math.max(rawLimit ?? 20, 1), 100);

  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    isActive: true,
    isHidden: false,
  };
  if (collection) {
    where.collection = { name: collection };
  }

  const [designs, total] = await Promise.all([
    db.design.findMany({
      where,
      select: {
        id: true,
        name: true,
        imageUrl: true,
        palette: true,
        collection: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
    }),
    db.design.count({ where }),
  ]);

  const result = designs.map((d) => ({
    id: d.id,
    name: d.name,
    collection: d.collection?.name ?? null,
    colorCount: Array.isArray(d.palette) ? (d.palette as unknown[]).length : 0,
    thumbnailUrl: d.imageUrl,
  }));

  return JSON.stringify({ designs: result, total, showing: result.length }, null, 2);
}

async function handleGetYarnPalette(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { library: rawLibrary, limit: rawLimit } = input as {
    library?: string;
    limit?: number;
  };
  const limit = Math.min(Math.max(rawLimit ?? 200, 1), 500);

  // Discover the libraries this tenant actually has. Library names vary per
  // tenant (e.g. "OneLoom", "Wool Colors") and some yarns have no material set,
  // so we never hardcode a default — we resolve the request against real data.
  const grouped = await db.yarnColor.groupBy({
    by: ["material"],
    where: { tenantId: ctx.tenantId, isActive: true },
    _count: { _all: true },
  });
  const availableLibraries = grouped
    .map((g) => ({ name: g.material ?? "(unnamed)", count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  // Match the requested library case-insensitively; if it doesn't match any
  // real library (or none was requested), return all libraries' yarns so the
  // model always has colors to work with instead of an empty list.
  let effectiveMaterial: string | null = null;
  if (rawLibrary) {
    const match = grouped.find(
      (g) => (g.material ?? "").toLowerCase() === rawLibrary.toLowerCase(),
    );
    effectiveMaterial = match?.material ?? null;
  }

  const materialFilter = effectiveMaterial ? { material: effectiveMaterial } : {};

  const yarns = await db.yarnColor.findMany({
    where: {
      tenantId: ctx.tenantId,
      isActive: true,
      ...materialFilter,
    },
    select: {
      code: true,
      name: true,
      hex: true,
      material: true,
      renderType: true,
      swatchImageUrl: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: limit,
  });

  const total = await db.yarnColor.count({
    where: { tenantId: ctx.tenantId, isActive: true, ...materialFilter },
  });

  const result = yarns.map((y) => ({
    code: y.code,
    name: y.name,
    hex: y.hex,
    library: y.material,
    renderType: y.renderType ?? "shader",
    hasTexture: y.swatchImageUrl !== null,
  }));

  return JSON.stringify(
    {
      requestedLibrary: rawLibrary ?? null,
      library: effectiveMaterial, // null = showing all libraries
      availableLibraries,
      yarns: result,
      total,
      showing: result.length,
    },
    null,
    2,
  );
}

async function handleSearchYarnsByColor(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { targetHex, library: rawLibrary, limit: rawLimit } = input as {
    targetHex: string;
    library?: string;
    limit?: number;
  };

  if (!targetHex || !/^#?[0-9a-fA-F]{6}$/.test(targetHex.replace("#", ""))) {
    return JSON.stringify({ error: "Invalid targetHex. Provide a 6-digit hex color (e.g. '#8B4513')." });
  }

  const normalizedTarget = targetHex.startsWith("#") ? targetHex : `#${targetHex}`;
  const limit = Math.min(Math.max(rawLimit ?? 10, 1), 50);

  // Resolve the requested library against real data (case-insensitive); if it
  // doesn't match or none was given, search across ALL of the tenant's yarns so
  // we never return an empty match set because of a library-name mismatch.
  let effectiveMaterial: string | null = null;
  if (rawLibrary) {
    const match = await db.yarnColor.findFirst({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        material: { equals: rawLibrary, mode: "insensitive" },
      },
      select: { material: true },
    });
    effectiveMaterial = match?.material ?? null;
  }

  // Fetch candidate yarns (the resolved library, or all libraries)
  const yarns = await db.yarnColor.findMany({
    where: {
      tenantId: ctx.tenantId,
      isActive: true,
      ...(effectiveMaterial ? { material: effectiveMaterial } : {}),
    },
    select: {
      code: true,
      name: true,
      hex: true,
      material: true,
      renderType: true,
      swatchImageUrl: true,
    },
  });

  // Compute Delta-E distance and sort
  const scored = yarns.map((y) => ({
    code: y.code,
    name: y.name,
    hex: y.hex,
    distance: Math.round(deltaE(normalizedTarget, y.hex) * 10) / 10,
    library: y.material,
    renderType: y.renderType ?? "shader",
    hasTexture: y.swatchImageUrl !== null,
  }));
  scored.sort((a, b) => a.distance - b.distance);

  return JSON.stringify(
    {
      targetHex: normalizedTarget,
      requestedLibrary: rawLibrary ?? null,
      library: effectiveMaterial, // null = searched all libraries
      matches: scored.slice(0, limit),
    },
    null,
    2,
  );
}

async function handleProposeRecolor(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { designId, colorSwaps } = input as {
    designId: string;
    colorSwaps: Array<{ fromYarnCode: string; toYarnCode: string }>;
  };

  if (!designId) {
    return JSON.stringify({ error: "designId is required." });
  }
  if (!colorSwaps?.length) {
    return JSON.stringify({ error: "colorSwaps must contain at least one swap." });
  }

  // Verify design exists
  const design = await db.design.findFirst({
    where: { id: designId, tenantId: ctx.tenantId, isActive: true },
    select: { id: true, name: true, palette: true },
  });
  if (!design) {
    return JSON.stringify({ error: "Design not found." });
  }

  // Build the maps the preset resolver (/designs/[id]?preset=) actually uses:
  // the "original" side of each pair must be a ColorLookup yarn code, which the
  // page maps code -> renderedHex -> palette hex. We canonicalize whatever the
  // model passed (a ColorLookup code, a palette matchedYarnCode, or a raw hex)
  // into the ColorLookup code, and reject anything that cannot resolve — so we
  // never emit a preset URL that navigates but applies zero swaps.
  const lookups = await db.colorLookup.findMany({
    where: { tenantId: ctx.tenantId },
    select: { renderedHex: true, yarnCode: true },
  });
  const codeToHex = new Map<string, string>(); // ColorLookup code (lower) -> hex (lower)
  const hexToCode = new Map<string, string>(); // hex (lower) -> ColorLookup code (original case)
  for (const l of lookups) {
    const hx = l.renderedHex.toLowerCase();
    codeToHex.set(l.yarnCode.toLowerCase(), hx);
    if (!hexToCode.has(hx)) hexToCode.set(hx, l.yarnCode);
  }

  const palette = (design.palette as PaletteEntry[]) ?? [];
  const paletteHexes = new Set(palette.map((p) => p.hex.toLowerCase()));
  const matchedToHex = new Map<string, string>();
  for (const p of palette) {
    if (p.matchedYarnCode) matchedToHex.set(p.matchedYarnCode.toLowerCase(), p.hex.toLowerCase());
  }

  // Resolve the model's "from" reference to the hex of the design color it means.
  function resolveFromHex(from: string): string | null {
    const f = from.toLowerCase();
    if (codeToHex.has(f)) return codeToHex.get(f)!; // a ColorLookup code
    if (matchedToHex.has(f)) return matchedToHex.get(f)!; // a palette matchedYarnCode
    if (paletteHexes.has(f)) return f; // a raw hex already in the palette
    return null;
  }

  // Verify all replacement yarn codes exist
  const replacementCodes = [...new Set(colorSwaps.map((s) => s.toYarnCode))];
  const validReplacements = await db.yarnColor.findMany({
    where: {
      tenantId: ctx.tenantId,
      code: { in: replacementCodes },
      isActive: true,
    },
    select: { code: true },
  });
  const validReplacementSet = new Set(validReplacements.map((y) => y.code));

  const validPairs: string[] = [];
  const invalidSwaps: Array<{ from: string; to: string; reason: string }> = [];
  const validSwapDetails: Array<{ from: string; to: string }> = [];

  for (const swap of colorSwaps) {
    const fromHex = resolveFromHex(swap.fromYarnCode);
    if (!fromHex || !paletteHexes.has(fromHex)) {
      invalidSwaps.push({
        from: swap.fromYarnCode,
        to: swap.toYarnCode,
        reason: `Original color '${swap.fromYarnCode}' not found in this design's palette.`,
      });
      continue;
    }
    if (!validReplacementSet.has(swap.toYarnCode)) {
      invalidSwaps.push({
        from: swap.fromYarnCode,
        to: swap.toYarnCode,
        reason: `Replacement yarn code '${swap.toYarnCode}' not found in the yarn library.`,
      });
      continue;
    }
    // Prefer the ColorLookup code (compact and works everywhere); fall back to
    // the raw palette hex for designs not mapped in ColorLookup — the preview
    // resolver accepts hex originals too, so every design is recolorable.
    const originalToken = hexToCode.get(fromHex) ?? fromHex;
    validPairs.push(
      `${encodeURIComponent(originalToken)}>${encodeURIComponent(swap.toYarnCode)}`,
    );
    validSwapDetails.push({ from: originalToken, to: swap.toYarnCode });
  }

  const presetParam = validPairs.join(",");
  const presetUrl = validPairs.length
    ? `/designs/${designId}?preset=${presetParam}`
    : null;

  return JSON.stringify(
    {
      designId,
      designName: design.name,
      presetUrl,
      validSwaps: validSwapDetails,
      totalSwaps: colorSwaps.length,
      invalidSwaps: invalidSwaps.length > 0 ? invalidSwaps : undefined,
    },
    null,
    2,
  );
}

async function handleSaveColorway(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { designId, name, globalSwaps, regionFills } = input as {
    designId: string;
    name: string;
    globalSwaps: Array<{ originalHex: string; yarnCode: string }>;
    regionFills?: Array<{
      originalColor: string;
      newYarnCode: string;
      boundaryIndex: number;
    }>;
  };

  if (!ctx.userId) {
    return JSON.stringify({ error: "User context required to save a colorway." });
  }
  if (!designId || !name) {
    return JSON.stringify({ error: "designId and name are required." });
  }
  if (!globalSwaps?.length) {
    return JSON.stringify({ error: "At least one global swap is required." });
  }

  // Verify design exists
  const design = await db.design.findFirst({
    where: { id: designId, tenantId: ctx.tenantId, isActive: true },
    select: { id: true },
  });
  if (!design) {
    return JSON.stringify({ error: "Design not found." });
  }

  // Resolve all yarn codes to full yarn records
  const allCodes = [
    ...globalSwaps.map((s) => s.yarnCode),
    ...(regionFills?.map((r) => r.newYarnCode) ?? []),
  ];
  const yarnRecords = await db.yarnColor.findMany({
    where: {
      tenantId: ctx.tenantId,
      code: { in: [...new Set(allCodes)] },
      isActive: true,
    },
    select: { id: true, code: true, hex: true },
  });
  const yarnByCode = new Map(yarnRecords.map((y) => [y.code, y]));

  // Build globalMap
  const globalMap: Record<string, { hex: string; yarnCode: string; yarnId: string }> =
    {};
  for (const swap of globalSwaps) {
    const yarn = yarnByCode.get(swap.yarnCode);
    if (!yarn) {
      return JSON.stringify({
        error: `Yarn code '${swap.yarnCode}' not found in the active yarn library.`,
      });
    }
    globalMap[swap.originalHex] = {
      hex: yarn.hex,
      yarnCode: yarn.code,
      yarnId: yarn.id,
    };
  }

  // Build regionFills operations
  const regionFillOps = (regionFills ?? []).map((rf) => {
    const yarn = yarnByCode.get(rf.newYarnCode);
    if (!yarn) {
      throw new Error(`Yarn code '${rf.newYarnCode}' not found.`);
    }
    return {
      seedX: 0, // boundary-based fills; seed point resolved by the canvas engine
      seedY: 0,
      originalColor: rf.originalColor,
      newHex: yarn.hex,
      newYarnCode: yarn.code,
      newYarnId: yarn.id,
    };
  });

  const operations = {
    globalMap,
    regionFills: regionFillOps,
  };

  // Build legacy colorMapping for backward compatibility
  const colorMapping: Record<
    string,
    { yarnId: string; yarnCode: string; yarnHex: string; libraryName: string }
  > = {};
  let idx = 0;
  for (const swap of globalSwaps) {
    const yarn = yarnByCode.get(swap.yarnCode)!;
    colorMapping[String(idx)] = {
      yarnId: yarn.id,
      yarnCode: yarn.code,
      yarnHex: yarn.hex,
      libraryName: "Wool Colors",
    };
    idx++;
  }

  const saved = await db.savedColorway.create({
    data: {
      designId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      name,
      userEmail: ctx.userEmail ?? null,
      colorMapping: colorMapping,
      operations: operations,
    },
    select: { id: true, name: true },
  });

  return JSON.stringify(
    {
      colorwayId: saved.id,
      name: saved.name,
      message: `Colorway "${saved.name}" saved successfully.`,
    },
    null,
    2,
  );
}
