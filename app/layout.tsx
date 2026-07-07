import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";
import { getPrivateCollectionAccess } from "@/lib/collections";
import { getUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { resolveDesignImageUrls } from "@/lib/design-urls";
import type { DesignSummary } from "@/types";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const title = tenant?.displayName ?? tenant?.name ?? "Loom Studio";
  return {
    title,
    description: "Browse and customize hand-knotted rug designs.",
    icons: tenant?.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [tierInfo, user, tenant] = await Promise.all([
    getDefaultTierInfo(),
    getUser(),
    getCurrentTenant(),
  ]);

  const isDemo = tierInfo.tier === "demo";
  const isAdmin = tierInfo.tier === "admin";

  // canUpload — only relevant for authenticated, non-demo users
  let canUpload = false;
  if (tenant && user) {
    const tenantUser = await db.tenantUser.findFirst({
      where: { tenantId: tenant.id, authUserId: user.id },
      select: { canUpload: true },
    });
    canUpload = tenantUser?.canUpload ?? false;
  }

  // Admin "View as user" preview: read the cookie set from the admin panel.
  // Only admins can use this — verified by checking tier.
  const cookieStore = await cookies();
  const previewAsEmail =
    isAdmin && cookieStore.get("previewAsUser")?.value
      ? cookieStore.get("previewAsUser")!.value
      : undefined;

  // Private collection visibility: OWNER/ADMIN see all; regular users see
  // public collections + private ones where they have a CollectionAccess row.
  let privateAccess = { filterPrivate: false, accessiblePrivateIds: [] as string[] };
  if (tenant) {
    privateAccess = await getPrivateCollectionAccess(tenant.id, previewAsEmail);
  }

  // Build collection filter for private visibility
  const collectionWhere = privateAccess.filterPrivate
    ? {
        OR: [
          // Designs in public collections
          { collection: { isPrivate: false } },
          // Designs in private collections the user can access
          ...(privateAccess.accessiblePrivateIds.length > 0
            ? [{ collectionId: { in: privateAccess.accessiblePrivateIds } }]
            : []),
          // Uncategorized designs (no collection)
          { collectionId: null },
        ],
      }
    : undefined;

  const designs = tenant
    ? await db.design.findMany({
        where: {
          tenantId: tenant.id,
          isActive: true,
          uploadedById: null,
          ...(isDemo && !previewAsEmail ? { isDemo: true } : {}),
          ...(!previewAsEmail && isAdmin ? {} : { isHidden: false }),
          ...collectionWhere,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          uploadedById: true,
          width: true,
          height: true,
          collection: { select: { id: true, name: true, slug: true, isPrivate: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Resolve signed URLs for user-uploaded designs (system designs use public URLs)
  const resolvedDesigns = await resolveDesignImageUrls(designs);

  const userInfo = user
    ? {
        email: user.email ?? "",
        name: (user.user_metadata?.full_name as string | undefined) ?? undefined,
        avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? undefined,
      }
    : null;

  const tenantBranding = tenant
    ? {
        displayName: tenant.displayName ?? tenant.name,
        logoUrl: tenant.logoUrl ?? null,
      }
    : null;

  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full flex flex-col bg-stone-50 text-stone-900">
        <AppShell
          designs={resolvedDesigns as unknown as DesignSummary[]}
          tierInfo={tierInfo}
          canUpload={canUpload}
          user={userInfo}
          tenant={tenantBranding}
          previewAsEmail={previewAsEmail ?? null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
