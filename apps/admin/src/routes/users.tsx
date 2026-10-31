import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Users, Shield, Search } from "lucide-react";
import { PageHeader, Badge, Pagination } from "@/components/admin/AdminShell";
import { getProfiles } from "@/lib/admin-queries";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/users")({
  loader: () => getProfiles({ page: 1, pageSize: 50 }),
  head: () => ({
    meta: [
      { title: "Users -- GrainShield AI Admin" },
      { name: "description", content: "Manage admin users and roles." },
    ],
  }),
  component: UsersPage,
});

const ROLES = ["user", "officer", "admin", "super_admin"] as const;
type Role = typeof ROLES[number];

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const roleTone: Record<Role, Tone> = {
  user: "info",
  officer: "warning",
  admin: "success",
  super_admin: "danger",
};

const roleLabel: Record<Role, string> = {
  user: "User",
  officer: "Officer",
  admin: "Admin",
  super_admin: "Super Admin",
};

function UsersPage() {
  const initial = Route.useLoaderData();
  const [profiles, setProfiles] = useState(initial.profiles);
  const [total, setTotal] = useState(initial.total);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function handleRoleChange(userId: string, newRole: Role) {
    setUpdating(userId);
    setError(null);
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);
    if (updateErr) {
      setError(`Failed to update role: ${updateErr.message}`);
    } else {
      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, role: newRole } : p))
      );
    }
    setUpdating(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Users" }]}
        title="User Management"
        subtitle={`${total} registered user${total !== 1 ? "s" : ""}`}
        right={<Users className="h-6 w-6 text-muted-foreground" />}
      />

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          Showing {profiles.length} of {total}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name / Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">District</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Current Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Change Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            ) : (
              profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{profile.full_name || "--"}</div>
                    <div className="text-xs text-muted-foreground">{profile.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{profile.district || "--"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={roleTone[profile.role as Role] ?? "info"}>
                      <Shield className="mr-1 h-3 w-3" />
                      {roleLabel[profile.role as Role] ?? profile.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={profile.role}
                      disabled={updating === profile.id}
                      onChange={(e) => handleRoleChange(profile.id, e.target.value as Role)}
                      className="rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{roleLabel[r]}</option>
                      ))}
                    </select>
                    {updating === profile.id && (
                      <span className="ml-2 text-xs text-muted-foreground">Saving...</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {profile.created_at
                      ? new Date(profile.created_at).toLocaleDateString("en-IN")
                      : "--"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          last={totalPages}
          onPageChange={(p) => { setPage(p); loadProfiles(p); }}
        />
      )}
    </div>
  );
}