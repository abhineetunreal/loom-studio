import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Loom Studio",
  description: "Browse and customize hand-knotted rug designs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 px-6 py-4">
          <span className="font-semibold tracking-tight text-lg">Loom Studio</span>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
