// Collection visibility helpers — determines which collections a user can see.
//
// Logic:
//   OWNER/ADMIN     → see ALL collections (public + private)
//   APPROVED user   → see public collections + private collections where
//                      a CollectionAccess row matches their email
//   DEMO/PENDING    → null (demo filter applied separately via isDemo)

import { db } from "./db";
import { getSession } from "./auth";

/**
 * Returns the IDs of private collections the current user has access to,
 * plus a flag indicating whether to filter at all.
 *
 * For OWNER/ADMIN: returns null (no filter — see everything).
 * For APPROVED users: returns the list of private collection IDs they can access.
 *   The caller should show all public collections + these private ones.
 * For DEMO/PENDING: returns null (demo filter applied separately).
 */
export async function getPrivateCollectionAccess(
  tenantId: string
): Promise<{ filterPrivate: boolean; accessiblePrivateIds: string[] }> {
  const session = await getSession();
  if (!session?.user.email) return { filterPrivate: true, accessiblePrivateIds: [] };

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId, email: session.user.email } },
    select: { id: true, role: true, email: true },
  });

  if (!tenantUser) return { filterPrivate: true, accessiblePrivateIds: [] };

  // OWNER and ADMIN see everything
  if (tenantUser.role === "OWNER" || tenantUser.role === "ADMIN") {
    return { filterPrivate: false, accessiblePrivateIds: [] };
  }

  // APPROVED users: find private collections they have access to
  if (tenantUser.role === "APPROVED") {
    const access = await db.collectionAccess.findMany({
      where: { userEmail: tenantUser.email, tenantId },
      select: { collectionId: true },
    });
    return {
      filterPrivate: true,
      accessiblePrivateIds: access.map((a) => a.collectionId),
    };
  }

  // DEMO/PENDING
  return { filterPrivate: true, accessiblePrivateIds: [] };
}

// Keep backward compat export name (used in layout.tsx import)
export const getCollectionAccessIds = getPrivateCollectionAccess;
