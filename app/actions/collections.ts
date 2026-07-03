"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

// ─── Guard ────────────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<void> {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") throw new Error("Unauthorized");
}

async function getDefaultTenantId(): Promise<string> {
  const tenant = await getCurrentTenant();
  if (!tenant) throw new Error("Tenant not found");
  return tenant.id;
}

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "collection"
  );
}

// ─── Collections CRUD ─────────────────────────────────────────────────────────

export async function createCollectionAction(
  name: string,
  isPrivate: boolean = false,
  accessEmails: string[] = []
): Promise<void> {
  await requireAdmin();
  const tenantId = await getDefaultTenantId();
  const slug = toSlug(name);
  await db.collection.create({
    data: {
      tenantId,
      name: name.trim(),
      slug,
      isPrivate,
      ...(isPrivate && accessEmails.length > 0
        ? {
            access: {
              create: accessEmails.map((email) => ({
                userEmail: email.toLowerCase().trim(),
                tenantId,
              })),
            },
          }
        : {}),
    },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function renameCollectionAction(
  id: string,
  name: string
): Promise<void> {
  await requireAdmin();
  const slug = toSlug(name);
  await db.collection.update({
    where: { id },
    data: { name: name.trim(), slug },
  });
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function setCollectionPrivacyAction(
  collectionId: string,
  isPrivate: boolean,
  accessEmails: string[]
): Promise<void> {
  await requireAdmin();
  const tenantId = await getDefaultTenantId();
  // Update privacy flag
  await db.collection.update({
    where: { id: collectionId },
    data: { isPrivate },
  });
  // Replace access list
  await db.collectionAccess.deleteMany({ where: { collectionId } });
  if (isPrivate && accessEmails.length > 0) {
    await db.collectionAccess.createMany({
      data: accessEmails.map((email) => ({
        collectionId,
        userEmail: email.toLowerCase().trim(),
        tenantId,
      })),
    });
  }
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function deleteCollectionAction(id: string): Promise<void> {
  await requireAdmin();
  // Unassign designs before deleting so FK doesn't block
  await db.design.updateMany({
    where: { collectionId: id },
    data: { collectionId: null },
  });
  await db.collection.delete({ where: { id } });
  revalidatePath("/admin");
}

// ─── Design assignment ────────────────────────────────────────────────────────

export async function assignDesignCollectionAction(
  designId: string,
  collectionId: string | null
): Promise<void> {
  await requireAdmin();
  await db.design.update({
    where: { id: designId },
    data: { collectionId },
  });
  revalidatePath("/admin");
}

export async function toggleDesignHiddenAction(
  designId: string,
  hidden: boolean
): Promise<void> {
  await requireAdmin();
  await db.design.update({
    where: { id: designId },
    data: { isHidden: hidden },
  });
  revalidatePath("/admin");
}

export async function deleteCollectionAccessAction(
  collectionId: string
): Promise<void> {
  await requireAdmin();
  await db.collection.update({
    where: { id: collectionId },
    data: { isPrivate: false },
  });
  await db.collectionAccess.deleteMany({ where: { collectionId } });
  revalidatePath("/admin");
  revalidatePath("/");
}
