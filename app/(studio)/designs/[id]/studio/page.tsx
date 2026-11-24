import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import { getTenantYarns, getTenantColorLookup } from "@/lib/design-data";
import { resolveDesignImageUrl } from "@/lib/design-urls";
import RecolorStudio from "@/components/recolor/RecolorStudio";
import { hexToLab, deltaE } from "@/lib/color-distance";
import type { PaletteEntry, YarnOption } from "@/types";

// New colour-tool screen (Manual / Auto). Preview route — the production design
// page at /designs/[id] is untouched. Reuses the same tenant-scoped data.

const LOOKUP_PATH = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");

function loadRenderedLookup(): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(LOOKUP_PATH, "utf-8")) as Record<string, { code: string } | string>;
    return new Map(
      Object.entries(raw)
        .filter(([k]) => /^#[0-9a-f]{6}$/i.test(k))
        .map(([k, v]): [string, string] => [k.toLowerCase(), typeof v === "object" && v !== null ? v.code : v])
    );
  } catch {
    return new Map();
  }
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ library?: string }>;
};

export default async function DesignStudioPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { library: libraryParam } = await searchParams;

  const tenant = await getCurrentTenant();

  const [design, yarns, tierInfo, dbColorLookupRows] = await Promise.all([
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
    getDefaultTierInfo(),
    tenant ? getTenantColorLookup(tenant.id) : Promise.resolve([]),
  ]);

  if (!design) notFound();

  const imageUrl = await resolveDesignImageUrl(design);
  const palette = design.palette as PaletteEntry[];

  // Initial colourway: map every palette colour to its nearest yarn in the
  // Wool_Colors library (by ΔE in LAB). Falls back to the rendered-lookup /
  // OneLoom resolution if the tenant has no Wool_Colors yarns.
  const normLib = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const woolYarns = yarns.filter((y) => normLib(y.library ?? "") === "wool colors");

  const initialColorMap: Record<string, YarnOption> = {};
  if (woolYarns.length) {
    const woolLab = woolYarns.map((y) => ({ y, lab: hexToLab(y.hex) }));
    for (const entry of palette) {
      const lab = hexToLab(entry.hex);
      let best = woolLab[0];
      let bestD = Infinity;
      for (const c of woolLab) {
        const d = deltaE(lab, c.lab);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) initialColorMap[entry.hex] = best.y;
    }
  } else {
    const renderedLookup = loadRenderedLookup();
    const dbLookup = new Map(dbColorLookupRows.map((r) => [r.renderedHex.toLowerCase(), r.yarnCode]));
    const oneloomByCode = new Map<string, YarnOption>(
      yarns.filter((y) => y.library === "OneLoom").map((y) => [y.code, y])
    );
    for (const entry of palette) {
      const hexLower = entry.hex.toLowerCase();
      const code = renderedLookup.get(hexLower) ?? dbLookup.get(hexLower) ?? entry.matchedYarnCode;
      if (!code) continue;
      const yarn = oneloomByCode.get(code);
      if (yarn) initialColorMap[entry.hex] = yarn;
    }
  }

  return (
    <div className="h-full overflow-hidden">
      <RecolorStudio
        design={{
          id: design.id, name: design.name, imageUrl,
          width: design.width, height: design.height,
          externalSku: design.externalSku, palette,
        }}
        yarns={yarns}
        initialColorMap={initialColorMap}
        tierInfo={tierInfo}
        productName={tenant?.displayName ?? tenant?.name ?? "Loom Studio"}
        logoUrl={tenant?.logoUrl ?? null}
        initialLibrary={libraryParam ?? woolYarns[0]?.library ?? undefined}
      />
    </div>
  );
}
