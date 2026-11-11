// Shared data loader for the design-colouring screen.
//
// Both the current design page and the Studio v2 screen need the same bundle:
// the design, its palette, the tenant yarn library, and the initial colour map
// (design colour → nearest library yarn). This centralises that so v2 reuses
// the exact backend without duplicating the lookup logic.

import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getCurrentTenant } from "./tenant";
import { getTenantYarns, getTenantColorLookup } from "./design-data";
import { resolveDesignImageUrl } from "./design-urls";
import { findNearestYarns } from "./color-distance";
import type { PaletteEntry, YarnOption } from "@/types";

const LOOKUP_PATH = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");

function loadRenderedLookup(): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(LOOKUP_PATH, "utf-8")) as Record<
      string,
      { code: string; catalogHex?: string } | string
    >;
    return new Map(
      Object.entries(raw)
        .filter(([k]) => /^#[0-9a-f]{6}$/i.test(k))
        .map(([k, v]): [string, string] => [
          k.toLowerCase(),
          typeof v === "object" && v !== null ? v.code : v,
        ])
    );
  } catch {
    return new Map();
  }
}

export type StudioDesignData = {
  design: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    width: number;
    height: number;
    externalSku: string | null;
    collection: { id: string; name: string; slug: string } | null;
  };
  palette: PaletteEntry[];
  yarns: YarnOption[];
  initialColorMap: Record<string, YarnOption>;
  tenant: { id: string; name: string; displayName: string | null; logoUrl: string | null } | null;
};

/**
 * Load everything the colouring screen needs for one design, or null if the
 * design does not exist. Reuses the cached tenant yarn library + colour lookup.
 */
export async function loadStudioDesign(id: string): Promise<StudioDesignData | null> {
  const tenant = await getCurrentTenant();

  const [design, yarns, dbColorLookupRows] = await Promise.all([
    db.design.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, imageUrl: true, sourceBmpUrl: true,
        uploadedById: true, width: true, height: true, externalSku: true,
        collection: { select: { id: true, name: true, slug: true } },
        palette: true,
      },
    }),
    tenant ? getTenantYarns(tenant.id) : Promise.resolve([] as YarnOption[]),
    tenant ? getTenantColorLookup(tenant.id) : Promise.resolve([]),
  ]);

  if (!design) return null;

  const imageUrl = await resolveDesignImageUrl(design);
  const palette = design.palette as PaletteEntry[];

  // Build initial colour map: design colour → nearest/known library yarn.
  const renderedLookup = loadRenderedLookup();
  const dbLookup = new Map(dbColorLookupRows.map((r) => [r.renderedHex.toLowerCase(), r.yarnCode]));
  const oneloomByCode = new Map<string, YarnOption>(
    yarns.filter((y) => y.library === "OneLoom").map((y) => [y.code, y])
  );

  const initialColorMap: Record<string, YarnOption> = {};
  for (const entry of palette) {
    const hexLower = entry.hex.toLowerCase();
    const code = renderedLookup.get(hexLower) ?? dbLookup.get(hexLower) ?? entry.matchedYarnCode;
    let yarn = code ? oneloomByCode.get(code) : undefined;
    // Fallback: nearest library yarn by colour (ΔE), so every design colour
    // starts on a real wool instead of showing a blank in "In this rug".
    if (!yarn && yarns.length > 0) {
      yarn = findNearestYarns(entry.hex, yarns, 1)[0] as YarnOption | undefined;
    }
    if (yarn) initialColorMap[entry.hex] = yarn;
  }

  return {
    design: {
      id: design.id, name: design.name, slug: design.slug, imageUrl,
      width: design.width, height: design.height, externalSku: design.externalSku,
      collection: design.collection,
    },
    palette,
    yarns,
    initialColorMap,
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, displayName: tenant.displayName ?? null, logoUrl: tenant.logoUrl ?? null }
      : null,
  };
}
