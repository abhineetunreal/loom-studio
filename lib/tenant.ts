// Tenant resolution for multi-tenant white-labeling.
//
// The middleware (middleware.ts) forwards the Host header as x-tenant-host.
// getCurrentTenant() reads that header and resolves the matching Tenant row:
//
//   1. Strip port from the host (localhost:3000 → localhost).
//   2. Query the DB for a Tenant whose `domain` field matches exactly.
//   3. If no match, fall back to the default tenant (DEFAULT_TENANT_SLUG env var).
//   4. Cache the host → Tenant mapping for 5 minutes so the DB is hit at most
//      once per cold tenant per 5-minute window.
//
// This file runs in the Node.js runtime (server components, API routes,
// server actions) — it uses Prisma and is NOT edge-compatible.

import { headers } from "next/headers";
import { db } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string | null;
  adminEmail: string;
  websiteUrl: string | null;
};

const SELECT = {
  id: true,
  slug: true,
  name: true,
  displayName: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
  adminEmail: true,
  websiteUrl: true,
} as const;

// ─── Cache ────────────────────────────────────────────────────────────────────

type CacheEntry = { tenant: TenantRecord | null; expiresAt: number };
// Module-level map shared across requests in the same Node.js process.
const tenantCache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Resolution ───────────────────────────────────────────────────────────────

async function resolveTenantByHost(host: string): Promise<TenantRecord | null> {
  const now = Date.now();
  const cached = tenantCache.get(host);
  if (cached && cached.expiresAt > now) return cached.tenant;

  // 1. Try exact custom-domain match.
  let tenant: TenantRecord | null = await db.tenant.findUnique({
    where: { domain: host },
    select: SELECT,
  });

  // 2. Fall back to the default tenant.
  if (!tenant) {
    tenant = await db.tenant.findUnique({
      where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
      select: SELECT,
    });
  }

  tenantCache.set(host, { tenant, expiresAt: now + TTL_MS });
  return tenant;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the Tenant for the current request based on the Host header.
 * Falls back to the default tenant (DEFAULT_TENANT_SLUG) if no custom domain
 * matches. Returns null only if the default tenant doesn't exist in the DB.
 *
 * Safe to call from server components, route handlers, and server actions.
 */
export async function getCurrentTenant(): Promise<TenantRecord | null> {
  const headersList = await headers();
  // x-tenant-host is set by middleware; fall back to the raw host header.
  const rawHost = headersList.get("x-tenant-host") ?? headersList.get("host") ?? "";
  // Strip port: "localhost:3000" → "localhost", "mybrand.com:443" → "mybrand.com"
  const host = rawHost.split(":")[0];
  return resolveTenantByHost(host);
}

/** Invalidate the cache entry for a given host (e.g., after tenant settings change). */
export function invalidateTenantCache(host: string): void {
  tenantCache.delete(host.split(":")[0]);
}
