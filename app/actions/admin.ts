"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";

// ─── Guard ────────────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<void> {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") throw new Error("Unauthorized");
}

// ─── Approve a single user ────────────────────────────────────────────────────

export async function approveUserAction(tenantUserId: string): Promise<void> {
  await requireAdmin();
  await db.tenantUser.update({
    where: { id: tenantUserId },
    data: { role: "APPROVED" },
  });
  revalidatePath("/admin");
}

// ─── Reject (delete) a user ───────────────────────────────────────────────────

export async function rejectUserAction(tenantUserId: string): Promise<void> {
  await requireAdmin();
  await db.tenantUser.delete({ where: { id: tenantUserId } });
  revalidatePath("/admin");
}

// ─── Bulk approve ─────────────────────────────────────────────────────────────

export async function bulkApproveAction(tenantUserIds: string[]): Promise<void> {
  await requireAdmin();
  await db.tenantUser.updateMany({
    where: { id: { in: tenantUserIds } },
    data: { role: "APPROVED" },
  });
  revalidatePath("/admin");
}

// ─── Change role ──────────────────────────────────────────────────────────────

export async function changeRoleAction(
  tenantUserId: string,
  role: string
): Promise<void> {
  await requireAdmin();
  if (!["PENDING", "APPROVED", "ADMIN", "DEMO"].includes(role)) return;
  await db.tenantUser.update({
    where: { id: tenantUserId },
    data: { role: role as "PENDING" | "APPROVED" | "ADMIN" | "DEMO" },
  });
  revalidatePath("/admin");
}
