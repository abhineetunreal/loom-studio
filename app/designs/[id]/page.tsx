import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import DesignViewer from "@/components/design/DesignViewer";
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
  searchParams: Promise<{ colorway?: string }>;
};

export default async function DesignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { colorway: colorwayId } = await searchParams;

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

  const userEmail = session?.user.email;
  if (userEmail && tenant) {
    const tenantUser = await db.tenantUser.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: userEmail } },
      select: { id: true },
    });

    if (tenantUser) {
      // Only load a saved colorway when explicitly requested via ?colorway= param.
      // Navigating to a design without that param always shows the original colors.
      const saved = colorwayId
        ? await db.savedColorway.findFirst({
            where: { id: colorwayId, designId: design.id, userId: tenantUser.id },
            select: { colorMapping: true, operations: true },
          })
        : null;

      if (saved) {
        const yarnById = new Map(yarns.map((y) => [y.id, y]));

        // New format: operations JSON with globalMap + regionFills
        if (saved.operations) {
          const ops = saved.operations as ColorwayOperations;
          if (ops.globalMap && typeof ops.globalMap === "object") {
            savedOperations = ops;
            savedColorMap = {};
            for (const [hex, entry] of Object.entries(ops.globalMap)) {
              const yarn = yarnById.get(entry.yarnId);
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
  }

  // Build "View Product" URL if both tenant.websiteUrl and design.externalSku are set
  const viewProductUrl =
    tenant?.websiteUrl && design.externalSku
      ? `${tenant.websiteUrl}/product-by-sku/${encodeURIComponent(design.externalSku)}`
      : undefined;

  return (
    <div className="h-full overflow-hidden">
      <DesignViewer
        design={{ ...design, imageUrl, palette }}
        yarns={yarns}
        initialColorMap={initialColorMap}
        savedColorMap={savedColorMap}
        savedOperations={savedOperations}
        isUserUpload={!!design.uploadedById}
        tierInfo={tierInfo}
        yarnLibraryName={tenant?.displayName ?? tenant?.name ?? ""}
        viewProductUrl={viewProductUrl}
      />
    </div>
  );
}
