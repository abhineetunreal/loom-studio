import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { db } from "@/lib/db";
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
  const designs = await db.design.findMany({
    where: { isActive: true },
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

  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full flex flex-col bg-stone-50 text-stone-900">
        <AppShell designs={designs as DesignSummary[]}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
