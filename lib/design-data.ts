// Cached per-tenant data for the design viewer.
//
// The design page re-runs on every navigation (each design open is a fresh RSC
// request).  The yarn library and the rendered-color lookup are the SAME for
// every design within a tenant and rarely change, yet they were being queried
// from the DB on every single open.  These helpers add a module-level cache
// (same pattern as getCurrentTenant) so repeat opens skip the DB entirely.

import { db } from "./db";
import type { YarnOption } from "@/types";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Yarn library ───────────────────────────────────────────────────────────

type RawYarn = {
  id: string;
  code: string;
  name: string;
  hex: string;
  material: string;
  pileType: string | null;
  swatchImageUrl: string | null;
  renderType: string | null;
  textureKpsi: number | null;
  swatchScale: number | null;
};

type YarnCacheEntry = { yarns: YarnOption[]; expiresAt: number };
const yarnCache = new Map<string, YarnCacheEntry>();

/**
 * Returns the active yarn library for a tenant, mapped to the UI YarnOption
 * shape, cached for 5 minutes across requests.
 */
export async function getTenantYarns(tenantId: string): Promise<YarnOption[]> {
  const now = Date.now();
  const cached = yarnCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.yarns;

  const rawYarns = (await db.yarnColor.findMany({
    where: { isActive: true, tenantId },
    select: {
      id: true, code: true, name: true, hex: true, swatchImageUrl: true,
      material: true, pileType: true, renderType: true, textureKpsi: true, swatchScale: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })) as RawYarn[];

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

  yarnCache.set(tenantId, { yarns, expiresAt: now + TTL_MS });
  return yarns;
}

// ─── Rendered-color lookup (tenant ColorLookup rows) ─────────────────────────

type LookupRow = { renderedHex: string; yarnCode: string };
type LookupCacheEntry = { rows: LookupRow[]; expiresAt: number };
const lookupCache = new Map<string, LookupCacheEntry>();

/**
 * Returns the tenant's ColorLookup rows (renderedHex → yarnCode), cached for
 * 5 minutes.  Used server-side only to build the initial color map; never sent
 * to the client.
 */
export async function getTenantColorLookup(tenantId: string): Promise<LookupRow[]> {
  const now = Date.now();
  const cached = lookupCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.rows;

  const rows = await db.colorLookup.findMany({
    where: { tenantId },
    select: { renderedHex: true, yarnCode: true },
  });

  lookupCache.set(tenantId, { rows, expiresAt: now + TTL_MS });
  return rows;
}

/** Invalidate both caches for a tenant (call after admin edits yarns/lookups). */
export function invalidateDesignDataCache(tenantId: string): void {
  yarnCache.delete(tenantId);
  lookupCache.delete(tenantId);
}
