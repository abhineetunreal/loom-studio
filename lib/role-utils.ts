// Role hierarchy utilities.
//
// OWNER > ADMIN > APPROVED > DEMO > PENDING
//
// Key rules:
//   - OWNER and ADMIN both get the "admin" tier (can access the admin panel).
//   - OWNER can manage everyone including ADMINs; cannot be modified by others.
//   - ADMIN can only manage PENDING/APPROVED/DEMO users.

export type UserRole = "PENDING" | "APPROVED" | "DEMO" | "ADMIN" | "OWNER";

/** True for any role that grants admin-panel access. */
export function isAdminOrOwner(role: string): boolean {
  return role === "ADMIN" || role === "OWNER";
}

export function isOwner(role: string): boolean {
  return role === "OWNER";
}

/**
 * Returns true if `actorRole` is allowed to modify a user whose current role
 * is `targetRole`. Editing means changing role, toggling canUpload, or deleting.
 *
 * Rules:
 *  - OWNER can modify anyone except other OWNERs (unless it's a self-action,
 *    which the caller must handle separately).
 *  - ADMIN can only modify PENDING / APPROVED / DEMO users.
 */
export function canActorModifyTarget(
  actorRole: string,
  targetRole: string
): boolean {
  if (actorRole === "OWNER") return targetRole !== "OWNER";
  if (actorRole === "ADMIN")
    return (
      targetRole === "PENDING" ||
      targetRole === "APPROVED" ||
      targetRole === "DEMO"
    );
  return false;
}

/**
 * Returns true if `actorRole` is allowed to assign `newRole` to someone.
 *
 * Rules:
 *  - Only OWNER can assign ADMIN or OWNER roles.
 *  - ADMIN can assign PENDING / APPROVED / DEMO.
 */
export function canActorAssignRole(
  actorRole: string,
  newRole: string
): boolean {
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN")
    return (
      newRole === "PENDING" || newRole === "APPROVED" || newRole === "DEMO"
    );
  return false;
}

/** Roles an actor may assign via the dropdown, ordered for display. */
export function assignableRoles(actorRole: string): UserRole[] {
  if (actorRole === "OWNER")
    return ["PENDING", "APPROVED", "DEMO", "ADMIN", "OWNER"];
  return ["PENDING", "APPROVED", "DEMO"];
}
