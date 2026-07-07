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
  tenantId: string,
  /** Optional override email — used by admin "View as user" preview. */
  overrideEmail?: string
): Promise<{ filterPrivate: boolean; accessiblePrivateIds: string[] }> {
  let emailToUse: string;

  if (overrideEmail) {
    // Admin preview mode — use the provided email directly
    emailToUse = overrideEmail.toLowerCase().trim();
  } else {
    const session = await getSession();
    if (!session?.user.email) return { filterPrivate: true, accessiblePrivateIds: [] };
    emailToUse = session.user.email.toLowerCase().trim();
  }

  // Case-insensitive lookup: emails are stored in varying case, so normalize
  const tenantUser = await db.tenantUser.findFirst({
    where: {
      tenantId,
      email: { equals: emailToUse, mode: "insensitive" },
    },
    select: { id: true, role: true, email: true },
  });

  console.log("[CollectionAccess] email=%s tenantUser=%s role=%s",
    emailToUse, tenantUser?.id ?? "NOT_FOUND", tenantUser?.role ?? "—");

  if (!tenantUser) return { filterPrivate: true, accessiblePrivateIds: [] };

  // When previewing as a user, always apply the target user's role —
  // don't short-circuit to "see everything" even if they happen to be admin.
  const effectiveRole = tenantUser.role;

  // OWNER and ADMIN see everything (only in non-preview mode)
  if (!overrideEmail && (effectiveRole === "OWNER" || effectiveRole === "ADMIN")) {
    return { filterPrivate: false, accessiblePrivateIds: [] };
  }

  // APPROVED users: find private collections they have access to
  if (effectiveRole === "APPROVED" || overrideEmail) {
    // CollectionAccess.userEmail is stored lowercase — normalize for matching
    const normalizedEmail = tenantUser.email.toLowerCase();
    const access = await db.collectionAccess.findMany({
      where: {
        userEmail: { equals: normalizedEmail, mode: "insensitive" },
        tenantId,
      },
      select: { collectionId: true },
    });
    console.log("[CollectionAccess] found %d accessible private collections for %s: %s",
      access.length, normalizedEmail, access.map((a) => a.collectionId).join(", "));
    return {
      filterPrivate: true,
      accessiblePrivateIds: access.map((a) => a.collectionId),
    };
  }

  // DEMO/PENDING
  console.log("[CollectionAccess] role=%s — no private collection access", effectiveRole);
  return { filterPrivate: true, accessiblePrivateIds: [] };
}

// Keep backward compat export name (used in layout.tsx import)
export const getCollectionAccessIds = getPrivateCollectionAccess;
