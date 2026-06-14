"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import LeftPanel from "@/components/catalog/LeftPanel";
import { signOutAction } from "@/app/actions/auth";
import type { DesignSummary, TierInfo } from "@/types";

type UserInfo = {
  email: string;
  name?: string;
  avatarUrl?: string;
};

type TenantBranding = {
  displayName: string;
  logoUrl: string | null;
};

type Props = {
  designs: DesignSummary[];
  tierInfo: TierInfo;
  canUpload: boolean;
  user: UserInfo | null;
  tenant: TenantBranding | null;
  children: React.ReactNode;
};


export default function AppShell({ designs, tierInfo, canUpload, user, tenant, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const showBanner = tierInfo.tier === "demo";

  return (
    <>
      {/* Demo / pending banner */}
      {showBanner && (
        <div
          className={`shrink-0 px-4 py-2 text-xs flex items-center justify-center gap-2 ${
            tierInfo.pendingApproval
              ? "bg-amber-50 text-amber-800 border-b border-amber-200"
              : "bg-stone-100 text-stone-600 border-b border-stone-200"
          }`}
        >
          {tierInfo.pendingApproval ? (
            <span>Your account is pending approval. Contact your admin for access.</span>
          ) : (
            <>
              <span>You&apos;re viewing a demo.</span>
              <Link
                href="/auth/signin"
                className="font-medium underline underline-offset-2 hover:text-stone-900 transition-colors"
              >
                Sign in for full access →
              </Link>
            </>
          )}
        </div>
      )}

      <header className="border-b border-stone-200 px-4 py-3 flex items-center gap-3 shrink-0 bg-white z-10">
        <button
          className="lg:hidden p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
          onClick={() => setMobileOpen(true)}
          aria-label="Open design browser"
        >
          <MenuIcon />
        </button>
        <span className="flex-1 flex items-center min-w-0">
          {tenant?.logoUrl ? (
            <Image
              src={tenant.logoUrl}
              alt={tenant.displayName}
              width={120}
              height={32}
              className="h-8 w-auto object-contain"
              priority
            />
          ) : (
            <span className="font-semibold tracking-tight text-lg truncate">
              {tenant?.displayName ?? "Loom Studio"}
            </span>
          )}
        </span>

        {/* User menu / sign-in link */}
        {user ? (
          <UserMenu user={user} isAdmin={tierInfo.tier === "admin"} />
        ) : (
          <Link
            href="/auth/signin"
            className="text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            Sign in
          </Link>
        )}
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftPanel
          designs={designs}
          canUpload={canUpload}
          isSignedIn={!!user}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
      </div>
    </>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────

function UserMenu({ user, isAdmin }: { user: UserInfo; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const initials = (user.name ?? user.email)
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-stone-100 transition-colors"
        aria-label="User menu"
        aria-expanded={open}
      >
        {/* Avatar */}
        <span className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center overflow-hidden shrink-0">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={user.name ?? user.email}
              width={28}
              height={28}
              className="object-cover w-full h-full"
            />
          ) : (
            <span className="text-[10px] font-semibold text-stone-600 select-none">
              {initials}
            </span>
          )}
        </span>
        {/* Email — hidden on small screens */}
        <span className="hidden sm:block text-xs text-stone-600 max-w-[160px] truncate">
          {user.email}
        </span>
        <ChevronDownIcon />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-stone-200 bg-white shadow-lg z-50 overflow-hidden">
          {/* Email header */}
          <div className="px-3 py-2 border-b border-stone-100">
            <p className="text-xs text-stone-500 truncate">{user.email}</p>
          </div>

          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
            >
              <AdminIcon />
              Admin panel
            </Link>
          )}

          <Link
            href="/auth/set-password"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
          >
            <KeyIcon />
            Set password
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MenuIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-3 h-3 text-stone-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg className="w-4 h-4 text-stone-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className="w-4 h-4 text-stone-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg className="w-4 h-4 text-stone-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}
