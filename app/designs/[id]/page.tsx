import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import DesignViewer from "@/components/design/DesignViewer";
import { resolveDesignImageUrl } from "@/lib/design-urls";
import { getUser } from "@/lib/auth";
import type { PaletteEntry, YarnOption } from "@/types";

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

type Props = { params: Promise<{ id: string }> };

export default async function DesignPage({ params }: Props) {
  const { id } = await params;

  // Resolve tenant first (cached after first call) so the yarn query can be scoped.
  const tenant = await getCurrentTenant();

  const [design, rawYarns, tierInfo, authUser] = await Promise.all([
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
      },
    }),
    db.yarnColor.findMany({
      where: { isActive: true, tenantId: tenant?.id },
      select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true, material: true, pileType: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getDefaultTierInfo(),
    getUser(),
  ]);

  if (!design) notFound();

  // Resolve display URL — user-uploaded designs need a signed URL
  const imageUrl = await resolveDesignImageUrl(design);

  // Map DB `material` → `library` for the UI type
  const yarns: YarnOption[] = rawYarns.map(({ material, ...y }) => ({
    ...y,
    library: material,
  }));

  const palette = design.palette as PaletteEntry[];

  // ── Build initial color map from the rendered-color lookup ─────────────────
  const renderedLookup = loadRenderedLookup();
  const oneloomByCode = new Map<string, YarnOption>(
    yarns.filter((y) => y.library === "OneLoom").map((y) => [y.code, y])
  );

  const initialColorMap: Record<string, YarnOption> = {};
  for (const entry of palette) {
    const code = renderedLookup.get(entry.hex) ?? entry.matchedYarnCode;
    if (!code) continue;
    const yarn = oneloomByCode.get(code);
    if (yarn) initialColorMap[entry.hex] = yarn;
  }

  // ── Restore saved colorway (7.3) ──────────────────────────────────────────
  // Look up any previously saved colorway for this user+design pair.
  let savedColorMap: Record<string, YarnOption> | undefined;

  if (authUser) {
    if (tenant) {
      const tenantUser = await db.tenantUser.findFirst({
        where: { tenantId: tenant.id, authUserId: authUser.id },
        select: { id: true },
      });
      if (tenantUser) {
        const saved = await db.savedColorway.findUnique({
          where: { designId_userId: { designId: design.id, userId: tenantUser.id } },
          select: { colorMapping: true },
        });
        if (saved?.colorMapping) {
          // colorMapping is index-keyed: { "0": { yarnId, yarnCode, hex, library }, … }
          const mapping = saved.colorMapping as Record<string, { yarnId: string }>;
          const yarnById = new Map(yarns.map((y) => [y.id, y]));
          savedColorMap = {};
          for (const [indexStr, entry] of Object.entries(mapping)) {
            const idx = parseInt(indexStr, 10);
            const paletteEntry = palette.find((e) => e.index === idx);
            if (!paletteEntry) continue;
            const yarn = yarnById.get(entry.yarnId);
            if (yarn) savedColorMap[paletteEntry.hex] = yarn;
          }
          // Discard if nothing resolved (e.g. all yarn IDs were deleted)
          if (Object.keys(savedColorMap).length === 0) savedColorMap = undefined;
        }
      }
    }
  }

  return (
    <div className="h-full overflow-hidden">
      <DesignViewer
        design={{ ...design, imageUrl, palette }}
        yarns={yarns}
        initialColorMap={initialColorMap}
        savedColorMap={savedColorMap}
        isUserUpload={!!design.uploadedById}
        tierInfo={tierInfo}
        yarnLibraryName={tenant?.displayName ?? tenant?.name ?? ""}
      />
    </div>
  );
}
