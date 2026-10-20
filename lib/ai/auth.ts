// AI endpoint auth — PlatformUser-only access.
//
// AI features are restricted to SUPER_OWNER and PLATFORM_ADMIN users.
// This is separate from the tenant API key auth (lib/ai-api-auth.ts)
// which is used by external MCP integrations.

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

export type AiAuthContext = {
  platformUserId: string;
  email: string;
  tenantId: string;
  role: "SUPER_OWNER" | "PLATFORM_ADMIN";
};

/**
 * Validate that the current session user is a PlatformUser.
 * Returns context needed for AI operations, or null if unauthorized.
 */
export async function validateAiAccess(): Promise<AiAuthContext | null> {
  const session = await getSession();
  if (!session?.user.email) return null;

  const platformUser = await db.platformUser.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, role: true },
  });

  if (!platformUser) return null;

  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  return {
    platformUserId: platformUser.id,
    email: platformUser.email,
    tenantId: tenant.id,
    role: platformUser.role as "SUPER_OWNER" | "PLATFORM_ADMIN",
  };
}
