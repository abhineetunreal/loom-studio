import { redirect } from "next/navigation";
import { getDefaultTierInfo, getCurrentUserRole } from "@/lib/tier";
import { db } from "@/lib/db";
import { AdminPanel } from "./AdminPanel";

export default async function AdminPage() {
  const [tierInfo, currentUserRole] = await Promise.all([
    getDefaultTierInfo(),
    getCurrentUserRole(),
  ]);
  if (tierInfo.tier !== "admin") redirect("/");
  const actorRole = currentUserRole ?? "ADMIN";

  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true, name: true },
  });
  if (!tenant) redirect("/");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    users,
    totalUsers,
    pendingCount,
    approvedCount,
    submissionsThisMonth,
    collections,
    allDesigns,
    userAccess,
  ] = await Promise.all([
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
    db.collection.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { designs: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.design.findMany({
      // Exclude user uploads from the Collections tab — they're managed via User Uploads tab
      where: { isActive: true, uploadedById: null },
      select: { id: true, name: true, slug: true, collectionId: true, isHidden: true },
      orderBy: { name: "asc" },
    }),
    db.collectionAccess.findMany({
      where: { tenantUser: { tenantId: tenant.id } },
      select: { tenantUserId: true, collectionId: true },
    }),
  ]);

  return (
    <AdminPanel
      actorRole={actorRole}
      tenantName={tenant.name}
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        role: u.role,
        canUpload: u.canUpload,
        provider: u.provider ?? null,
        createdAt: u.createdAt.toISOString(),
      }))}
      stats={{ totalUsers, pendingCount, approvedCount, submissionsThisMonth }}
      collections={collections.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        designCount: c._count.designs,
      }))}
      designs={allDesigns}
      userAccess={userAccess}
    />
  );
}
