import { redirect } from "next/navigation";
import { getDefaultTierInfo } from "@/lib/tier";
import { db } from "@/lib/db";
import { AdminPanel } from "./AdminPanel";

export default async function AdminPage() {
  const tierInfo = await getDefaultTierInfo();
  if (tierInfo.tier !== "admin") redirect("/");

  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true, name: true },
  });
  if (!tenant) redirect("/");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [users, totalUsers, pendingCount, approvedCount, submissionsThisMonth] =
    await Promise.all([
      db.tenantUser.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
      }),
      db.tenantUser.count({ where: { tenantId: tenant.id } }),
      db.tenantUser.count({ where: { tenantId: tenant.id, role: "PENDING" } }),
      db.tenantUser.count({ where: { tenantId: tenant.id, role: "APPROVED" } }),
      db.colorwaySubmission.count({
        where: { tenantId: tenant.id, createdAt: { gte: startOfMonth } },
      }),
    ]);

  return (
    <AdminPanel
      tenantName={tenant.name}
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        role: u.role,
        provider: u.provider ?? null,
        createdAt: u.createdAt.toISOString(),
      }))}
      stats={{ totalUsers, pendingCount, approvedCount, submissionsThisMonth }}
    />
  );
}
