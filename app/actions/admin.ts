"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getDefaultTierInfo, getCurrentUserRole } from "@/lib/tier";
import {
  canActorModifyTarget,
  canActorAssignRole,
} from "@/lib/role-utils";

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Ensures the caller has admin-panel access (ADMIN or OWNER). Returns their role. */
async function requireAdminRole(): Promise<string> {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") throw new Error("Unauthorized");
  const role = await getCurrentUserRole();
  if (!role) throw new Error("Unauthorized");
  return role;
}

/** Fetches the target user's current role, throws if not found. */
async function getTargetRole(tenantUserId: string): Promise<string> {
  const target = await db.tenantUser.findUnique({
    where: { id: tenantUserId },
    select: { role: true },
  });
  if (!target) throw new Error("User not found");
  return target.role;
}

// ─── Approve a single user ────────────────────────────────────────────────────

export async function approveUserAction(tenantUserId: string): Promise<void> {
  const actorRole = await requireAdminRole();
  const targetRole = await getTargetRole(tenantUserId);
  if (!canActorModifyTarget(actorRole, targetRole)) throw new Error("Unauthorized");
  await db.tenantUser.update({
    where: { id: tenantUserId },
    data: { role: "APPROVED" },
  });
  revalidatePath("/admin");
}

// ─── Reject (delete) a user ───────────────────────────────────────────────────

export async function rejectUserAction(tenantUserId: string): Promise<void> {
  const actorRole = await requireAdminRole();
  const targetRole = await getTargetRole(tenantUserId);
  if (!canActorModifyTarget(actorRole, targetRole)) throw new Error("Unauthorized");
  await db.tenantUser.delete({ where: { id: tenantUserId } });
  revalidatePath("/admin");
}

// ─── Bulk approve ─────────────────────────────────────────────────────────────

export async function bulkApproveAction(tenantUserIds: string[]): Promise<void> {
  const actorRole = await requireAdminRole();
  // Bulk approve only applies to PENDING users — safe for both ADMIN and OWNER.
  // Still guard: ADMIN must not bulk-approve ADMIN/OWNER rows (they wouldn't
  // appear in the pending list in practice, but be defensive here).
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") throw new Error("Unauthorized");
  await db.tenantUser.updateMany({
    where: {
      id: { in: tenantUserIds },
      role: { in: actorRole === "OWNER" ? ["PENDING"] : ["PENDING"] },
    },
    data: { role: "APPROVED" },
  });
  revalidatePath("/admin");
}

// ─── Change role ──────────────────────────────────────────────────────────────

export async function changeRoleAction(
  tenantUserId: string,
  newRole: string
): Promise<void> {
  const actorRole = await requireAdminRole();
  const targetRole = await getTargetRole(tenantUserId);

  if (!canActorModifyTarget(actorRole, targetRole)) throw new Error("Unauthorized");
  if (!canActorAssignRole(actorRole, newRole)) throw new Error("Unauthorized");

  await db.tenantUser.update({
    where: { id: tenantUserId },
    data: {
      role: newRole as "PENDING" | "APPROVED" | "DEMO" | "ADMIN" | "OWNER",
    },
  });
  revalidatePath("/admin");
}

// ─── Toggle canUpload ─────────────────────────────────────────────────────────

export async function setCanUploadAction(
  tenantUserId: string,
  canUpload: boolean
): Promise<void> {
  const actorRole = await requireAdminRole();
  const targetRole = await getTargetRole(tenantUserId);
  if (!canActorModifyTarget(actorRole, targetRole)) throw new Error("Unauthorized");
  await db.tenantUser.update({
    where: { id: tenantUserId },
    data: { canUpload },
  });
  revalidatePath("/admin");
}
