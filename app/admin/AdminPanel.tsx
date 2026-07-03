"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  approveUserAction,
  rejectUserAction,
  bulkApproveAction,
  changeRoleAction,
  setCanUploadAction,
} from "@/app/actions/admin";
import { assignableRoles, canActorModifyTarget } from "@/lib/role-utils";
import { CollectionsTab } from "./CollectionsTab";
import { UserUploadsTab } from "./UserUploadsTab";
import { CatalogTab } from "./CatalogTab";
import { ColorMappingTab } from "./ColorMappingTab";
import { SavedColorwaysAdminTab } from "./SavedColorwaysAdminTab";
import type { CollectionSummary, DesignBrief } from "./CollectionsTab";

// ─── Types ────────────────────────────────────────────────────────────────────

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  canUpload: boolean;
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
  actorRole: string;
  tenantName: string;
  users: User[];
  stats: Stats;
  collections: CollectionSummary[];
  designs: DesignBrief[];
};

type Tab = "pending" | "all" | "collections" | "uploads" | "catalog" | "colors" | "colorways";

// ─── AdminPanel ───────────────────────────────────────────────────────────────

export function AdminPanel({
  actorRole,
  tenantName,
  users,
  stats,
  collections,
  designs,
}: Props) {
  const [tab, setTab] = useState<Tab>("pending");

  const pendingUsers = users.filter((u) => u.role === "PENDING");

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
          <TabButton
            active={tab === "uploads"}
            onClick={() => setTab("uploads")}
          >
            User Uploads
          </TabButton>
          <TabButton
            active={tab === "catalog"}
            onClick={() => setTab("catalog")}
          >
            Catalog
          </TabButton>
          <TabButton
            active={tab === "colors"}
            onClick={() => setTab("colors")}
          >
            Color Mapping
          </TabButton>
          <TabButton
            active={tab === "colorways"}
            onClick={() => setTab("colorways")}
          >
            Saved Colorways
          </TabButton>
        </div>

        {tab === "pending" && (
          <PendingTab
            actorRole={actorRole}
            users={pendingUsers}
          />
        )}
        {tab === "all" && (
          <AllUsersTab
            actorRole={actorRole}
            users={users}
          />
        )}
        {tab === "collections" && (
          <CollectionsTab collections={collections} designs={designs} />
        )}
        {tab === "uploads" && <UserUploadsTab />}
        {tab === "catalog" && <CatalogTab collections={collections} />}
        {tab === "colors" && <ColorMappingTab />}
        {tab === "colorways" && <SavedColorwaysAdminTab />}
      </div>

      {/* Collection access is now managed per-collection in the Collections tab */}
    </div>
  );
}

// ─── PendingTab ───────────────────────────────────────────────────────────────

function PendingTab({
  actorRole,
  users,
}: {
  actorRole: string;
  users: User[];
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

function AllUsersTab({
  actorRole,
  users,
}: {
  actorRole: string;
  users: User[];
}) {
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [showInvite, setShowInvite] = useState(false);
  const router = useRouter();

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          (u.name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const handleRoleChange = (id: string, role: string) =>
    startTransition(() => changeRoleAction(id, role));

  const handleCanUploadChange = (id: string, canUpload: boolean) =>
    startTransition(() => setCanUploadAction(id, canUpload));

  const roleOptions = assignableRoles(actorRole);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
        <button
          onClick={() => setShowInvite(true)}
          className="px-3 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors whitespace-nowrap"
        >
          Invite user
        </button>
      </div>

      {showInvite && (
        <InviteUserModal
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            router.refresh();
          }}
        />
      )}

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
              <th className="px-3 py-2.5 text-center font-medium text-stone-600 hidden sm:table-cell">
                Can Upload
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
                  colSpan={5}
                  className="px-3 py-8 text-center text-stone-400"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map((user) => {
                const canEdit = canActorModifyTarget(actorRole, user.role);
                return (
                  <tr
                    key={user.id}
                    className={`border-b border-stone-100 last:border-0 ${
                      canEdit ? "hover:bg-stone-50" : "bg-stone-50/60"
                    }`}
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
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <input
                        type="checkbox"
                        checked={user.canUpload}
                        onChange={(e) =>
                          handleCanUploadChange(user.id, e.target.checked)
                        }
                        disabled={isPending || !canEdit}
                        className="rounded border-stone-300 disabled:opacity-40"
                        title={
                          canEdit
                            ? "Allow this user to upload designs"
                            : "You cannot modify this account"
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canEdit ? (
                          <select
                            value={user.role}
                            onChange={(e) =>
                              handleRoleChange(user.id, e.target.value)
                            }
                            disabled={isPending}
                            className="text-xs border border-stone-200 rounded-md px-2 py-1 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-50"
                          >
                            {roleOptions.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-md bg-stone-100 text-stone-500 font-medium">
                            {user.role}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── InviteUserModal ──────────────────────────────────────────────────────────

function InviteUserModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<
    | null
    | { type: "exists"; role: string }
    | { type: "success" }
    | { type: "error"; message: string }
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const res = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });

      if (res.status === 409) {
        const data = await res.json();
        setStatus({ type: "exists", role: data.role });
      } else if (res.ok) {
        setStatus({ type: "success" });
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus({ type: "error", message: data.error ?? "Something went wrong." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100">
          <p className="font-medium text-stone-900">Invite user</p>
          <p className="text-xs text-stone-400 mt-0.5">
            Creates an approved account. They can sign in immediately.
          </p>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              ref={emailRef}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Name <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>

          {status?.type === "exists" && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This user already exists with role{" "}
              <span className="font-medium">{status.role}</span>.
            </p>
          )}
          {status?.type === "success" && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              User invited successfully. They can now access the studio by signing
              in.
            </p>
          )}
          {status?.type === "error" && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {status.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
              {status?.type === "success" ? "Close" : "Cancel"}
            </button>
            {status?.type !== "success" && (
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
            )}
            {status?.type === "success" && (
              <button
                type="button"
                onClick={onInvited}
                className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </form>
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
