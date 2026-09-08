import { db } from "@/lib/db";

type TenantInfo = {
  id: string;
  name: string;
  displayName: string | null;
  domain: string | null;
  slug: string;
};

/**
 * Validate a Bearer API key from the Authorization header.
 * Returns the tenant if valid, or null if the key is missing/invalid.
 */
export async function validateApiKey(request: Request): Promise<TenantInfo | null> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const tenant = await db.tenant.findUnique({
    where: { apiKey: token },
    select: { id: true, name: true, displayName: true, domain: true, slug: true },
  });

  return tenant ?? null;
}
