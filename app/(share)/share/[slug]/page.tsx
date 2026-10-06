// Public share page — client-facing rug design review.
// No auth required; email entry is the only gate.

import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { resolveDesignImageUrl, resolveDesignImageUrls } from "@/lib/design-urls";
import SharePageClient from "./SharePageClient";
import type { PaletteEntry, YarnOption } from "@/types";
import type { ColorwayOperations } from "@/components/design/DesignViewer";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function SharePage({ params }: Props) {
  const { slug } = await params;

  // ── 1. Look up share link ──────────────────────────────────────────────────
  const shareLink = await db.shareLink.findUnique({
    where: { slug },
    include: {
      tenant: {
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          logoUrl: true,
          faviconUrl: true,
          domain: true,
          adminEmail: true,
        },
      },
    },
  });

  if (!shareLink || !shareLink.isActive) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-lg font-semibold text-stone-900 mb-2">
            This link is no longer active
          </h1>
          <p className="text-sm text-stone-500">
            The share link you followed has been deactivated or does not exist.
          </p>
        </div>
      </div>
    );
  }

  const tenantId = shareLink.tenantId;

  // ── 2. Fetch primary design ────────────────────────────────────────────────
  const primaryDesign = await db.design.findUnique({
    where: { id: shareLink.primaryDesignId },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      sourceBmpUrl: true,
      uploadedById: true,
      width: true,
      height: true,
      palette: true,
      externalSku: true,
      collection: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!primaryDesign) notFound();

  const primaryImageUrl = await resolveDesignImageUrl(primaryDesign);

  // ── 3. Fetch additional designs ────────────────────────────────────────────
  const additionalDesignIds = (shareLink.additionalDesignIds ?? []) as string[];
  let additionalDesigns: typeof rawAdditionalDesigns = [];
  const rawAdditionalDesigns = additionalDesignIds.length > 0
    ? await db.design.findMany({
        where: { id: { in: additionalDesignIds } },
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          sourceBmpUrl: true,
          uploadedById: true,
          width: true,
          height: true,
          palette: true,
          externalSku: true,
          collection: { select: { id: true, name: true, slug: true } },
        },
      })
    : [];
  additionalDesigns = await resolveDesignImageUrls(rawAdditionalDesigns);

  // ── 4. Fetch yarns (filtered by allowed libraries) ─────────────────────────
  const allowedLibraries = (shareLink.allowedLibraries ?? []) as string[];
  const rawYarns = await db.yarnColor.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(allowedLibraries.length > 0 ? { material: { in: allowedLibraries } } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      hex: true,
      swatchImageUrl: true,
      material: true,
      pileType: true,
      renderType: true,
      textureKpsi: true,
      swatchScale: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

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

  // ── 5. Color lookups ───────────────────────────────────────────────────────
  const dbColorLookupRows = await db.colorLookup.findMany({
    where: { tenantId },
    select: { renderedHex: true, yarnCode: true },
  });

  // Build initial color map from color lookups
  const palette = primaryDesign.palette as PaletteEntry[];
  const dbLookup = new Map(
    dbColorLookupRows.map((r) => [r.renderedHex.toLowerCase(), r.yarnCode])
  );
  const oneloomByCode = new Map<string, YarnOption>(
    yarns.filter((y) => y.library === "OneLoom").map((y) => [y.code, y])
  );

  const initialColorMap: Record<string, YarnOption> = {};
  for (const entry of palette) {
    const hexLower = entry.hex.toLowerCase();
    const code = dbLookup.get(hexLower) ?? entry.matchedYarnCode;
    if (!code) continue;
    const yarn = oneloomByCode.get(code);
    if (yarn) initialColorMap[entry.hex] = yarn;
  }

  // ── 6. Fetch presets (saved colorways) ─────────────────────────────────────
  const presetsConfig = (shareLink.presets ?? []) as { colorwayId: string; displayName: string }[];
  const presetColorwayIds = presetsConfig.map((p) => p.colorwayId);

  const presetColorways = presetColorwayIds.length > 0
    ? await db.savedColorway.findMany({
        where: { id: { in: presetColorwayIds } },
        select: {
          id: true,
          name: true,
          operations: true,
          snapshotUrl: true,
        },
      })
    : [];

  // Build presets with operations, preserving the admin's display name + order
  const presets = presetsConfig
    .map((cfg) => {
      const cw = presetColorways.find((c) => c.id === cfg.colorwayId);
      if (!cw) return null;
      return {
        colorwayId: cfg.colorwayId,
        displayName: cfg.displayName,
        operations: cw.operations as ColorwayOperations | null,
        snapshotUrl: cw.snapshotUrl,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // ── 7. Fetch existing approvals ────────────────────────────────────────────
  const existingApprovals = await db.shareApproval.findMany({
    where: { shareLinkId: shareLink.id },
    select: {
      id: true,
      designId: true,
      clientEmail: true,
      operations: true,
      thumbnail: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // ── 8. Build additional design color maps ──────────────────────────────────
  const additionalDesignsWithMaps = additionalDesigns.map((d) => {
    const dPalette = d.palette as PaletteEntry[];
    const dColorMap: Record<string, YarnOption> = {};
    for (const entry of dPalette) {
      const hexLower = entry.hex.toLowerCase();
      const code = dbLookup.get(hexLower) ?? entry.matchedYarnCode;
      if (!code) continue;
      const yarn = oneloomByCode.get(code);
      if (yarn) dColorMap[entry.hex] = yarn;
    }
    return {
      ...d,
      palette: dPalette,
      initialColorMap: dColorMap,
    };
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SharePageClient
      slug={slug}
      shareLink={{
        id: shareLink.id,
        clientName: shareLink.clientName,
        clientEmail: shareLink.clientEmail,
        createdBy: shareLink.createdBy,
      }}
      tenant={{
        displayName: shareLink.tenant.displayName ?? shareLink.tenant.name,
        logoUrl: shareLink.tenant.logoUrl,
      }}
      primaryDesign={{
        ...primaryDesign,
        imageUrl: primaryImageUrl,
        palette,
      }}
      additionalDesigns={additionalDesignsWithMaps}
      yarns={yarns}
      initialColorMap={initialColorMap}
      presets={presets}
      existingApprovals={existingApprovals.map((a) => ({
        ...a,
        operations: a.operations as Record<string, unknown>,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }))}
      yarnLibraryName={shareLink.tenant.displayName ?? shareLink.tenant.name}
    />
  );
}
