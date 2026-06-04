"use client";

import { useState, useTransition } from "react";
import {
  approveUserAction,
  rejectUserAction,
  bulkApproveAction,
  changeRoleAction,
} from "@/app/actions/admin";
import { setUserCollectionAccessAction } from "@/app/actions/collections";
import { CollectionsTab } from "./CollectionsTab";
import type { CollectionSummary, DesignBrief } from "./CollectionsTab";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  collections: CollectionSummary[];
  designs: DesignBrief[];
  userAccess: Array<{ tenantUserId: string; collectionId: string }>;
};

type Tab = "pending" | "all" | "collections";

// ─── AdminPanel ───────────────────────────────────────────────────────────────

export function AdminPanel({
  tenantName,
  users,
  stats,
  collections,
  designs,
  userAccess,
}: Props) {
  const [tab, setTab] = useState<Tab>("pending");
  const [accessModalUser, setAccessModalUser] = useState<User | null>(null);

  const pendingUsers = users.filter((u) => u.role === "PENDING");

  // Pre-compute per-user access map
  const accessByUser = new Map<string, string[]>();
  for (const a of userAccess) {
    if (!accessByUser.has(a.tenantUserId)) accessByUser.set(a.tenantUserId, []);
    accessByUser.get(a.tenantUserId)!.push(a.collectionId);
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-stone-900">Admin Panel</h1>
          <p className="text-sm text-stone-500 mt-0.5">{tenantName}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total users" value={stats.totalUsers} />
          <StatCard
            label="Pending approval"
            value={stats.pendingCount}
            accent={stats.pendingCount > 0}
          />
          <StatCard label="Approved" value={stats.approvedCount} />
          <StatCard
            label="Submissions this month"
            value={stats.submissionsThisMonth}
          />
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
          <TabButton
            active={tab === "collections"}
            onClick={() => setTab("collections")}
          >
            Collections
            {collections.length > 0 && (
              <span className="ml-1.5 bg-stone-100 text-stone-600 text-xs font-medium px-1.5 py-0.5 rounded-full">
                {collections.length}
              </span>
            )}
          </TabButton>
        </div>

        {tab === "pending" && (
          <PendingTab
            users={pendingUsers}
            collections={collections}
            accessByUser={accessByUser}
            onOpenAccess={setAccessModalUser}
          />
        )}
        {tab === "all" && (
          <AllUsersTab
            users={users}
            collections={collections}
            accessByUser={accessByUser}
            onOpenAccess={setAccessModalUser}
          />
        )}
        {tab === "collections" && (
          <CollectionsTab collections={collections} designs={designs} />
        )}
      </div>

      {/* User access modal */}
      {accessModalUser && (
        <UserAccessModal
          user={accessModalUser}
          collections={collections}
          currentAccess={accessByUser.get(accessModalUser.id) ?? []}
          onClose={() => setAccessModalUser(null)}
        />
      )}
    </div>
  );
}

// ─── PendingTab ───────────────────────────────────────────────────────────────

function PendingTab({
  users,
  collections,
  accessByUser,
  onOpenAccess,
}: {
  users: User[];
  collections: CollectionSummary[];
  accessByUser: Map<string, string[]>;
  onOpenAccess: (u: User) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const toggleAll = () => {
    setSelected(
      selected.size === users.length ? new Set() : new Set(users.map((u) => u.id))
    );
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

  const handleApprove = (id: string) =>
    startTransition(() => approveUserAction(id));

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
              <th className="px-3 py-2.5 text-left font-medium text-stone-600">
                User
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">
                Provider
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">
                Signed up
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-stone-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggle(user.id)}
                    className="rounded border-stone-300"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <UserCell user={user} />
                </td>
                <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                  {user.provider ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {collections.length > 0 && (
                      <AccessBadge
                        count={accessByUser.get(user.id)?.length ?? 0}
                        total={collections.length}
                        onClick={() => onOpenAccess(user)}
                      />
                    )}
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

// ─── AllUsersTab ──────────────────────────────────────────────────────────────

const ROLES = ["PENDING", "APPROVED", "DEMO", "ADMIN"] as const;

function AllUsersTab({
  users,
  collections,
  accessByUser,
  onOpenAccess,
}: {
  users: User[];
  collections: CollectionSummary[];
  accessByUser: Map<string, string[]>;
  onOpenAccess: (u: User) => void;
}) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          (u.name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const handleRoleChange = (id: string, role: string) =>
    startTransition(() => changeRoleAction(id, role));

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
              <th className="px-3 py-2.5 text-left font-medium text-stone-600">
                User
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">
                Provider
              </th>
              <th className="px-3 py-2.5 text-left font-medium text-stone-600 hidden sm:table-cell">
                Signed up
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-stone-600">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-stone-400"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
                >
                  <td className="px-3 py-2.5">
                    <UserCell user={user} />
                  </td>
                  <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                    {user.provider ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-stone-500 hidden sm:table-cell">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {collections.length > 0 && (
                        <AccessBadge
                          count={accessByUser.get(user.id)?.length ?? 0}
                          total={collections.length}
                          onClick={() => onOpenAccess(user)}
                        />
                      )}
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={isPending}
                        className="text-xs border border-stone-200 rounded-md px-2 py-1 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
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

// ─── UserAccessModal ──────────────────────────────────────────────────────────

function UserAccessModal({
  user,
  collections,
  currentAccess,
  onClose,
}: {
  user: User;
  collections: CollectionSummary[];
  currentAccess: string[];
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(currentAccess));
  const [isPending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = () => {
    startTransition(async () => {
      await setUserCollectionAccessAction(user.id, [...checked]);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100">
          <p className="text-xs text-stone-400 mb-0.5">Collection access for</p>
          <p className="font-medium text-stone-900 truncate">{user.email}</p>
        </div>

        {/* Helper text */}
        <div className="px-5 pt-3 pb-1">
          <p className="text-xs text-stone-500 leading-relaxed">
            Select which collections this user can see. If none are selected, they
            see <strong>all collections</strong>.
          </p>
        </div>

        {/* Grant/Revoke all */}
        <div className="px-5 py-2 flex gap-2">
          <button
            onClick={() => setChecked(new Set(collections.map((c) => c.id)))}
            className="text-xs text-stone-600 hover:text-stone-900 underline underline-offset-2"
          >
            Grant all
          </button>
          <span className="text-stone-300">·</span>
          <button
            onClick={() => setChecked(new Set())}
            className="text-xs text-stone-600 hover:text-stone-900 underline underline-offset-2"
          >
            Revoke all
          </button>
        </div>

        {/* Collection checkboxes */}
        <div className="px-5 pb-3 max-h-60 overflow-y-auto space-y-1.5">
          {collections.length === 0 ? (
            <p className="text-xs text-stone-400 py-4 text-center">
              No collections exist yet.
            </p>
          ) : (
            collections.map((col) => (
              <label
                key={col.id}
                className="flex items-center gap-3 cursor-pointer py-1 group"
              >
                <input
                  type="checkbox"
                  checked={checked.has(col.id)}
                  onChange={() => toggle(col.id)}
                  className="rounded border-stone-300 shrink-0"
                />
                <span className="text-sm text-stone-700 flex-1">{col.name}</span>
                <span className="text-xs text-stone-400">
                  {col.designCount}
                </span>
              </label>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={isPending}
            className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function UserCell({ user }: { user: User }) {
  return (
    <>
      <div className="font-medium text-stone-800 truncate max-w-[200px]">
        {user.name ?? (
          <span className="text-stone-400 font-normal">—</span>
        )}
      </div>
      <div className="text-xs text-stone-400 truncate max-w-[200px]">
        {user.email}
      </div>
    </>
  );
}

function AccessBadge({
  count,
  total,
  onClick,
}: {
  count: number;
  total: number;
  onClick: () => void;
}) {
  const label = count === 0 ? "All" : `${count}/${total}`;
  return (
    <button
      onClick={onClick}
      title="Manage collection access"
      className="text-xs px-2 py-0.5 rounded border border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-colors"
    >
      {label} collections
    </button>
  );
}

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
        accent ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white"
      }`}
    >
      <div
        className={`text-2xl font-semibold ${
          accent ? "text-amber-700" : "text-stone-900"
        }`}
      >
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
