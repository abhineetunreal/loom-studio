"use client";

import { useState, useTransition } from "react";
import {
  approveUserAction,
  rejectUserAction,
  bulkApproveAction,
  changeRoleAction,
} from "@/app/actions/admin";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  provider: string | null;
  createdAt: string;
};

type Stats = {
  totalUsers: number;
  pendingCount: number;
  approvedCount: number;
  submissionsThisMonth: number;
};

type Props = {
  tenantName: string;
  users: User[];
  stats: Stats;
};

type Tab = "pending" | "all";

export function AdminPanel({ tenantName, users, stats }: Props) {
  const [tab, setTab] = useState<Tab>("pending");

  const pendingUsers = users.filter((u) => u.role === "PENDING");

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-stone-900">Admin Panel</h1>
          <p className="text-sm text-stone-500 mt-0.5">{tenantName}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total users" value={stats.totalUsers} />
          <StatCard label="Pending approval" value={stats.pendingCount} accent={stats.pendingCount > 0} />
          <StatCard label="Approved" value={stats.approvedCount} />
          <StatCard label="Submissions this month" value={stats.submissionsThisMonth} />
        </div>

        {/* Tabs */}
        <div className="border-b border-stone-200 mb-4 flex gap-1">
          <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
            Pending
            {stats.pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-100 text-amber-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                {stats.pendingCount}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All users
          </TabButton>
        </div>

        {tab === "pending" ? (
          <PendingTab users={pendingUsers} />
        ) : (
          <AllUsersTab users={users} />
        )}
      </div>
    </div>
  );
}

// ─── Pending tab ──────────────────────────────────────────────────────────────

function PendingTab({ users }: { users: User[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const toggleAll = () => {
    if (selected.size === users.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map((u) => u.id)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkApprove = () => {
    const ids = [...selected];
    startTransition(async () => {
      await bulkApproveAction(ids);
      setSelected(new Set());
    });
  };

  const handleApprove = (id: string) => {
    startTransition(() => approveUserAction(id));
  };

  const handleReject = (id: string) => {
    if (!confirm("Remove this user? They will need to sign up again.")) return;
    startTransition(() => rejectUserAction(id));
  };

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-stone-400 text-sm">
        No pending users.
      </div>
    );
  }

  return (
    <div>
      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-sm text-amber-800 flex-1">
            {selected.size} selected
          </span>
          <button
            onClick={handleBulkApprove}
            disabled={isPending}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            Approve all
          </button>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="w-10 px-3 py-2.5 text-left">
                <input
                  type="checkbox"
                  checked={selected.size === users.length}
                  onChange={toggleAll}
                  className="rounded border-stone-300"
                />
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600">User</th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">Provider</th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">Signed up</th>
              <th className="px-3 py-2.5 text-right font-medium text-stone-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggle(user.id)}
                    className="rounded border-stone-300"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-stone-800 truncate max-w-[200px]">
                    {user.name ?? <span className="text-stone-400 font-normal">—</span>}
                  </div>
                  <div className="text-xs text-stone-400 truncate max-w-[200px]">{user.email}</div>
                </td>
                <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                  {user.provider ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleApprove(user.id)}
                      disabled={isPending}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(user.id)}
                      disabled={isPending}
                      className="text-xs font-medium px-2.5 py-1 rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── All users tab ────────────────────────────────────────────────────────────

const ROLES = ["PENDING", "APPROVED", "DEMO", "ADMIN"] as const;

function AllUsersTab({ users }: { users: User[] }) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          (u.name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const handleRoleChange = (id: string, role: string) => {
    startTransition(() => changeRoleAction(id, role));
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-3 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
      />

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="px-3 py-2.5 text-left font-medium text-stone-600">User</th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">Provider</th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">Signed up</th>
              <th className="px-3 py-2.5 text-right font-medium text-stone-600">Role</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-stone-400">
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-stone-800 truncate max-w-[200px]">
                      {user.name ?? <span className="text-stone-400 font-normal">—</span>}
                    </div>
                    <div className="text-xs text-stone-400 truncate max-w-[200px]">{user.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                    {user.provider ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      disabled={isPending}
                      className="text-xs border border-stone-200 rounded-md px-2 py-1 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        accent
          ? "border-amber-200 bg-amber-50"
          : "border-stone-200 bg-white"
      }`}
    >
      <div className={`text-2xl font-semibold ${accent ? "text-amber-700" : "text-stone-900"}`}>
        {value}
      </div>
      <div className={`text-xs mt-0.5 ${accent ? "text-amber-600" : "text-stone-500"}`}>
        {label}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
