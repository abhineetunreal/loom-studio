import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
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

  const designs = await db.design.findMany({
    where: {
      isActive: true,
      ...(isDemo ? { isDemo: true } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      width: true,
      height: true,
      collection: true,
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
          designs={designs as DesignSummary[]}
          tierInfo={tierInfo}
          user={userInfo}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
