import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCollectionAccessIds } from "@/lib/collections";
import { getUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import type { DesignSummary } from "@/types";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Loom Studio",
  description: "Browse and customize hand-knotted rug designs.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [tierInfo, user] = await Promise.all([
    getDefaultTierInfo(),
    getUser(),
  ]);

  const isDemo = tierInfo.tier === "demo";
  const isAdmin = tierInfo.tier === "admin";

  // For APPROVED users: check if they have collection-level access restrictions
  let collectionIds: string[] | null = null;
  if (tierInfo.tier === "full") {
    const tenant = await db.tenant.findUnique({
      where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
      select: { id: true },
    });
    if (tenant) collectionIds = await getCollectionAccessIds(tenant.id);
  }

  // Build collection filter: only applies when APPROVED user has explicit restrictions
  const collectionWhere =
    collectionIds !== null
      ? { OR: [{ collectionId: { in: collectionIds } }, { collectionId: null }] }
      : undefined;

  const designs = await db.design.findMany({
    where: {
      isActive: true,
      ...(isDemo ? { isDemo: true } : {}),
      ...(isAdmin ? {} : { isHidden: false }),
      ...collectionWhere,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      width: true,
      height: true,
      collection: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const userInfo = user
    ? {
        email: user.email ?? "",
        name: (user.user_metadata?.full_name as string | undefined) ?? undefined,
        avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? undefined,
      }
    : null;

  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full flex flex-col bg-stone-50 text-stone-900">
        <AppShell
          designs={designs as unknown as DesignSummary[]}
          tierInfo={tierInfo}
          user={userInfo}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
