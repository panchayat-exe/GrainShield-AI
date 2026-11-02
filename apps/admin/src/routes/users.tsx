import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Users, Shield, Search, AlertCircle, ShieldAlert, Check } from "lucide-react";
import { PageHeader, Badge, Pagination } from "@/components/admin/AdminShell";
import { getProfiles, updateUserRole } from "@/lib/admin-queries";
import { getAdminSession, canAssignRole, type AdminUser } from "@/lib/admin-auth";
import type { UserRole } from "@/lib/supabase";

export const Route = createFileRoute("/users")({
  loader: async () => {
    const [profilesResult, session] = await Promise.all([
      getProfiles({ page: 1, pageSize: 50 }),
      getAdminSession(),
    ]);
    return { ...profilesResult, adminUser: session };
  },
  head: () => ({
    meta: [
      { title: "User Management — GrainShield AI Admin" },
      { name: "description", content: "Manage system users, officers and role assignments." },
    ],
  }),
  component: UsersPage,
});

const ROLES: UserRole[] = ["user", "officer", "admin", "super_admin"];

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const roleTone: Record<UserRole, Tone> = {
  user: "info",
  officer: "warning",
  admin: "success",
  super_admin: "danger",
};

const roleLabel: Record<UserRole, string> = {
  user: "Driver / Citizen",
  officer: "Field Officer",
  admin: "Administrator",
  super_admin: "Super Admin",
};

function UsersPage() {
  const initial = Route.useLoaderData();
  const [profiles, setProfiles] = useState(initial.profiles);
  const [total, setTotal] = useState(initial.total);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const adminUser = initial.adminUser;

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadProfiles(p = page, s = search) {
    const result = await getProfiles({ page: p, pageSize, search: s });
    setProfiles(result.profiles);
    setTotal(result.total);
  }

  async function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
    await loadProfiles(1, val);
  }

  async function handleRoleChange(userId: string, currentRole: UserRole, newRole: UserRole) {
    if (currentRole === newRole) return;

    setUpdating(userId);
    setMessage(null);

    const check = canAssignRole(adminUser, currentRole, newRole);
    if (!check.allowed) {
      setMessage({ type: "error", text: check.reason ?? "Permission denied." });
      setUpdating(null);
      return;
    }

    const { success, error } = await updateUserRole(userId, currentRole, newRole, adminUser);

    if (error || !success) {
      setMessage({ type: "error", text: `Failed to update role: ${error}` });
    } else {
      setProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, role: newRole } : p)));
      setMessage({
        type: "success",
        text: `Role successfully updated to ${roleLabel[newRole]}. Audit trail logged.`,
      });
    }
    setUpdating(null);
  }

  const isOfficerCaller = adminUser?.role === "officer";

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Users" }]}
        title="User & Access Management"
        subtitle={`${total} registered account${total !== 1 ? "s" : ""} across Gujarat GrainShield`}
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Signed in as:</span>
            <Badge tone={roleTone[adminUser?.role ?? "user"]}>
              {roleLabel[adminUser?.role ?? "user"]}
            </Badge>
          </div>
        }
      />

      {isOfficerCaller && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            <b>Read-Only Mode:</b> Officer accounts can inspect user directories but do not have
            administrative authority to reassign roles.
          </span>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          Showing {profiles.length} of {total}
        </span>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-md p-3 text-sm ${
            message.type === "success"
              ? "border border-success/30 bg-success-soft text-success"
              : "border border-destructive/30 bg-danger-soft text-destructive"
          }`}
        >
          {message.type === "success" ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Name & Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                District / Region
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Current Role
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Assigned Role
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Registered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {profiles.map((p) => {
              const canEditThisUser =
                !isOfficerCaller &&
                (adminUser?.role === "super_admin" ||
                  (adminUser?.role === "admin" && p.role !== "admin" && p.role !== "super_admin"));

              return (
                <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{p.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.district || "General Gujarat"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={roleTone[p.role as UserRole]}>
                      {roleLabel[p.role as UserRole] ?? p.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {canEditThisUser ? (
                      <select
                        disabled={updating === p.id}
                        value={p.role}
                        onChange={(e) =>
                          handleRoleChange(p.id, p.role as UserRole, e.target.value as UserRole)
                        }
                        className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="user">Driver / Citizen</option>
                        <option value="officer">Field Officer</option>
                        {adminUser?.role === "super_admin" && (
                          <>
                            <option value="admin">Administrator</option>
                            <option value="super_admin">Super Admin</option>
                          </>
                        )}
                      </select>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        Protected / Read-only
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        last={totalPages}
        onPageChange={(p) => {
          setPage(p);
          loadProfiles(p, search);
        }}
      />
    </div>
  );
}
