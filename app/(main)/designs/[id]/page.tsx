import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import DesignViewer from "@/components/design/DesignViewer";
import type { ResolvedPreset } from "@/components/design/DesignViewer";
import { resolveDesignImageUrl } from "@/lib/design-urls";
import { getSession } from "@/lib/auth";
import type { PaletteEntry, YarnOption } from "@/types";
import type { ColorwayOperations } from "@/components/design/DesignViewer";

// ─── Rendered-color lookup ────────────────────────────────────────────────────
// Reads data/oneloom-rendered-lookup.json at request time (server component).
// Keys not starting with "#" are metadata and are ignored.

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

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ colorway?: string; preset?: string }>;
};

export default async function DesignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { colorway: colorwayId, preset: presetRaw } = await searchParams;

  // Resolve tenant first (cached after first call) so the yarn query can be scoped.
  const tenant = await getCurrentTenant();

  const [design, rawYarns, tierInfo, session, dbColorLookupRows] = await Promise.all([
    db.design.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        sourceBmpUrl: true,
        uploadedById: true,
        width: true,
        height: true,
        collection: { select: { id: true, name: true, slug: true } },
        palette: true,
        externalSku: true,
      },
    }),
    db.yarnColor.findMany({
      where: { isActive: true, tenantId: tenant?.id },
      select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true, material: true, pileType: true, renderType: true, textureKpsi: true, swatchScale: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getDefaultTierInfo(),
    getSession(),
    tenant
      ? db.colorLookup.findMany({
          where: { tenantId: tenant.id },
          select: { renderedHex: true, yarnCode: true },
        })
      : Promise.resolve([]),
  ]);

  if (!design) notFound();

  // Resolve display URL — user-uploaded designs need a signed URL
  const imageUrl = await resolveDesignImageUrl(design);

  // Map DB `material` → `library` for the UI type
  const yarns: YarnOption[] = rawYarns.map((y) => ({
    id: y.id,
    code: y.code,
    name: y.name,
    hex: y.hex,
    library: y.material,
    pileType: y.pileType,
    swatchImageUrl: y.swatchImageUrl,
    renderType: (y.renderType ?? "shader") as "shader" | "photo",
    textureKpsi: y.textureKpsi ?? null,
    swatchScale: y.swatchScale ?? 1.0,
  }));

  const palette = design.palette as PaletteEntry[];

  // ── Build initial color map from the rendered-color lookup ─────────────────
  const renderedLookup = loadRenderedLookup();
  const dbLookup = new Map(
    dbColorLookupRows.map((r) => [r.renderedHex.toLowerCase(), r.yarnCode])
  );
  const oneloomByCode = new Map<string, YarnOption>(
    yarns.filter((y) => y.library === "OneLoom").map((y) => [y.code, y])
  );

  const initialColorMap: Record<string, YarnOption> = {};
  for (const entry of palette) {
    const hexLower = entry.hex.toLowerCase();
    const code = renderedLookup.get(hexLower) ?? dbLookup.get(hexLower) ?? entry.matchedYarnCode;
    if (!code) continue;
    const yarn = oneloomByCode.get(code);
    if (yarn) initialColorMap[entry.hex] = yarn;
  }

  // ── Restore saved colorway ────────────────────────────────────────────────
  // If ?colorway=ID is in the URL, load that specific saved colorway.
  // Otherwise fall back to the most recently saved colorway for this user+design.
  let savedColorMap: Record<string, YarnOption> | undefined;
  let savedOperations: ColorwayOperations | undefined;

  // ── Restore saved colorway ──────────────────────────────────────────────────
  // When loading a specific colorway by ID (via ?colorway= param), fetch it
  // regardless of who owns it — the colorway ID is the authorization token.
  // The email filter only applies when *listing* colorways (the Saved tab).
  if (tenant && colorwayId) {
    const saved = await db.savedColorway.findFirst({
      where: { id: colorwayId, designId: design.id, tenantId: tenant.id },
      select: { colorMapping: true, operations: true },
    });

    if (saved) {
      const yarnById = new Map(yarns.map((y) => [y.id, y]));
      // Secondary lookup: material+code → yarn (for cross-library disambiguation)
      const yarnByMaterialCode = new Map(
        yarns.map((y) => [`${y.library ?? ""}:${y.code}`, y])
      );

      /** Resolve a yarn from saved entry, preferring material+code over ID-only. */
      function resolveYarn(entry: { yarnId: string; yarnCode?: string; material?: string }): YarnOption | undefined {
        // Try exact material+code match first (handles library disambiguation)
        if (entry.material && entry.yarnCode) {
          const byMC = yarnByMaterialCode.get(`${entry.material}:${entry.yarnCode}`);
          if (byMC) return byMC;
        }
        // Fall back to ID lookup (works for old saves and single-library cases)
        return yarnById.get(entry.yarnId);
      }

      // New format: operations JSON with globalMap + regionFills
      if (saved.operations) {
        const ops = saved.operations as ColorwayOperations;
        if (ops.globalMap && typeof ops.globalMap === "object") {
          savedOperations = ops;
          savedColorMap = {};
          for (const [hex, entry] of Object.entries(ops.globalMap)) {
            const yarn = resolveYarn(entry);
            if (yarn) savedColorMap[hex] = yarn;
          }
          if (Object.keys(savedColorMap).length === 0) savedColorMap = undefined;
        }
      }

      // Legacy format: index-keyed colorMapping (for old saves without operations)
      if (!savedColorMap && saved.colorMapping) {
        const mapping = saved.colorMapping as Record<string, { yarnId: string }>;
        savedColorMap = {};
        for (const [indexStr, entry] of Object.entries(mapping)) {
          const idx = parseInt(indexStr, 10);
          const paletteEntry = palette.find((e) => e.index === idx);
          if (!paletteEntry) continue;
          const yarn = yarnById.get(entry.yarnId);
          if (yarn) savedColorMap[paletteEntry.hex] = yarn;
        }
        if (Object.keys(savedColorMap).length === 0) savedColorMap = undefined;
      }
    }
  }

  // ── Resolve ?preset= URL parameter ─────────────────────────────────────────
  // Format: originalYarnCode:replacementCode,... (comma-separated pairs)
  // Maps original codes → renderedHex (via ColorLookup) then resolves replacement
  // yarns from the tenant's yarn library with full render metadata.
  let resolvedPreset: ResolvedPreset | null = null;

  if (tenant && presetRaw && presetRaw.trim()) {
    const decoded = decodeURIComponent(presetRaw.trim());
    const pairs = decoded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const sepIdx = p.indexOf(">");
        if (sepIdx < 1) return null;
        return {
          originalCode: p.slice(0, sepIdx).trim(),
          replacementCode: p.slice(sepIdx + 1).trim(),
        };
      })
      .filter((p): p is { originalCode: string; replacementCode: string } => p !== null);

    if (pairs.length > 0) {
      // Build lookup maps from data already fetched
      const codeLookup = new Map(
        dbColorLookupRows.map((r) => [r.yarnCode, r.renderedHex.toLowerCase()])
      );
      const yarnByCode = new Map(yarns.map((y) => [y.code, y]));

      const colorMap: ResolvedPreset["colorMap"] = {};
      const failures: { originalCode: string; replacementCode: string; reason: string }[] = [];

      for (const { originalCode, replacementCode } of pairs) {
        // Find the renderedHex for the original yarn code
        const renderedHex = codeLookup.get(originalCode);
        if (!renderedHex) {
          failures.push({ originalCode, replacementCode, reason: "color_lookup_not_found" });
          continue;
        }

        // Find the palette entry that uses this renderedHex (case-insensitive)
        const paletteHex = palette.find(
          (e) => e.hex.toLowerCase() === renderedHex
        )?.hex;
        if (!paletteHex) {
          failures.push({ originalCode, replacementCode, reason: "original_not_found" });
          continue;
        }

        // Find the replacement yarn
        const yarn = yarnByCode.get(replacementCode);
        if (!yarn) {
          failures.push({ originalCode, replacementCode, reason: "replacement_not_found" });
          continue;
        }

        colorMap[paletteHex] = yarn;
      }

      const applied = Object.keys(colorMap).length;
      const failed = failures.length;

      resolvedPreset = {
        colorMap,
        totalPairs: pairs.length,
        appliedCount: applied,
        failedCount: failed,
        failures: failed > 0 ? failures : undefined,
      };

      // Log to PresetLog (fire-and-forget — don't block page load)
      const h = await headers();
      db.presetLog.create({
        data: {
          tenantId: tenant.id,
          designId: design.id,
          presetRaw: decoded,
          totalPairs: pairs.length,
          applied,
          failed,
          failures: failed > 0 ? failures : undefined,
          referrer: h.get("referer") ?? null,
          userAgent: h.get("user-agent") ?? null,
        },
      }).catch((err) => console.error("[PresetLog] Failed to log:", err));
    }
  }

  // Build "View Product" URL if both tenant.websiteUrl and design.externalSku are set
  const viewProductUrl =
    tenant?.websiteUrl && design.externalSku
      ? `${tenant.websiteUrl}/product-by-sku/${encodeURIComponent(design.externalSku)}`
      : undefined;

  return (
    <div className="h-full overflow-hidden">
      <DesignViewer
        key={`${design.id}-${colorwayId ?? (presetRaw ? "preset" : "original")}`}
        design={{ ...design, imageUrl, palette }}
        yarns={yarns}
        initialColorMap={resolvedPreset
          ? { ...initialColorMap, ...resolvedPreset.colorMap }
          : initialColorMap}
        savedColorMap={savedColorMap}
        savedOperations={savedOperations}
        initialPreset={resolvedPreset ?? undefined}
        isUserUpload={!!design.uploadedById}
        tierInfo={tierInfo}
        yarnLibraryName={tenant?.displayName ?? tenant?.name ?? ""}
        brandLogoUrl={tenant?.logoUrl ?? undefined}
        viewProductUrl={viewProductUrl}
        customerName={(session?.user?.user_metadata?.full_name as string | undefined) ?? session?.user?.email ?? undefined}
      />
    </div>
  );
}
