/**
 * GrainShield AI – Admin Frontend Unit Tests
 * Run: npm test -- --passWithNoTests (vitest run)
 */
import { describe, it, expect } from "vitest";
import {
  isSuperAdmin,
  isAdmin,
  isOfficer,
  canManageUsers,
  canAssignRole,
  canResolveReview,
  canCreateTrip,
  type AdminUser,
} from "../lib/admin-auth";

// ---------------------------------------------------------------------------
// CSV export helper (mirrors reports.tsx logic)
// ---------------------------------------------------------------------------
function buildCsvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.join(","), ...rows.map(buildCsvRow)].join("\n");
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------
function buildPageRange(page: number, total: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize;
  const to = Math.min(from + pageSize - 1, total - 1);
  return { from, to, totalPages, hasPrev: page > 1, hasNext: page < totalPages };
}

// ---------------------------------------------------------------------------
// Filter query builder (mirrors trips.tsx)
// ---------------------------------------------------------------------------
type TripFilters = { stage?: string; status?: string; search?: string; page: number };

function buildFilterDescription(f: TripFilters): string {
  const parts: string[] = [];
  if (f.stage) parts.push(`stage=${f.stage}`);
  if (f.status) parts.push(`status=${f.status}`);
  if (f.search) parts.push(`search="${f.search}"`);
  parts.push(`page=${f.page}`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Role badge helper
// ---------------------------------------------------------------------------
type Role = "user" | "officer" | "admin" | "super_admin";

const ROLE_LABELS: Record<Role, string> = {
  user: "User",
  officer: "Officer",
  admin: "Admin",
  super_admin: "Super Admin",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CSV builder", () => {
  it("builds header + rows", () => {
    const csv = buildCsv(
      ["Name", "District", "Count"],
      [
        ["Ahmedabad", "Central", 42],
        ["Surat", "South", 18],
      ],
    );
    expect(csv).toContain("Name,District,Count");
    expect(csv).toContain("Ahmedabad,Central,42");
    expect(csv).toContain("Surat,South,18");
  });

  it("escapes commas in fields", () => {
    const row = buildCsvRow(["Name, with comma", "Value"]);
    expect(row).toBe('"Name, with comma",Value');
  });

  it("escapes double quotes", () => {
    const row = buildCsvRow(['Say "hello"', "ok"]);
    expect(row).toBe('"Say ""hello""",ok');
  });

  it("handles null and undefined", () => {
    const row = buildCsvRow([null, undefined, "real"]);
    expect(row).toBe(",,real");
  });
});

describe("Pagination", () => {
  it("first page of 3", () => {
    const p = buildPageRange(1, 30, 10);
    expect(p.totalPages).toBe(3);
    expect(p.from).toBe(0);
    expect(p.to).toBe(9);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(true);
  });

  it("last page", () => {
    const p = buildPageRange(3, 30, 10);
    expect(p.hasPrev).toBe(true);
    expect(p.hasNext).toBe(false);
  });

  it("partial last page", () => {
    const p = buildPageRange(2, 15, 10);
    expect(p.totalPages).toBe(2);
    expect(p.to).toBe(14);
  });

  it("single page", () => {
    const p = buildPageRange(1, 5, 10);
    expect(p.totalPages).toBe(1);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(false);
  });
});

describe("Filter description builder", () => {
  it("all filters", () => {
    const desc = buildFilterDescription({
      stage: "first_mile",
      status: "pass",
      search: "GJ05",
      page: 2,
    });
    expect(desc).toContain("stage=first_mile");
    expect(desc).toContain("status=pass");
    expect(desc).toContain('search="GJ05"');
    expect(desc).toContain("page=2");
  });

  it("no optional filters", () => {
    const desc = buildFilterDescription({ page: 1 });
    expect(desc).toBe("page=1");
  });
});

describe("Role labels", () => {
  it("known roles", () => {
    expect(roleLabel("user")).toBe("User");
    expect(roleLabel("officer")).toBe("Officer");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("super_admin")).toBe("Super Admin");
  });
  it("unknown role falls back to raw value", () => {
    expect(roleLabel("custom_role")).toBe("custom_role");
  });
});

describe("Admin RBAC Permissions", () => {
  const superAdminUser: AdminUser = {
    id: "sa-1",
    email: "super@grainshield.gov.in",
    role: "super_admin",
    full_name: "Super Admin",
    district: null,
  };

  const adminUser: AdminUser = {
    id: "adm-1",
    email: "admin@grainshield.gov.in",
    role: "admin",
    full_name: "District Admin",
    district: "Ahmedabad",
  };

  const officerUser: AdminUser = {
    id: "off-1",
    email: "officer@grainshield.gov.in",
    role: "officer",
    full_name: "Field Officer",
    district: "Surat",
  };

  it("evaluates role levels accurately", () => {
    expect(isSuperAdmin(superAdminUser)).toBe(true);
    expect(isSuperAdmin(adminUser)).toBe(false);
    expect(isSuperAdmin(officerUser)).toBe(false);

    expect(isAdmin(superAdminUser)).toBe(true);
    expect(isAdmin(adminUser)).toBe(true);
    expect(isAdmin(officerUser)).toBe(false);

    expect(isOfficer(superAdminUser)).toBe(true);
    expect(isOfficer(adminUser)).toBe(true);
    expect(isOfficer(officerUser)).toBe(true);
  });

  it("enforces canManageUsers", () => {
    expect(canManageUsers(superAdminUser)).toBe(true);
    expect(canManageUsers(adminUser)).toBe(true);
    expect(canManageUsers(officerUser)).toBe(false);
    expect(canManageUsers(null)).toBe(false);
  });

  it("enforces canResolveReview and canCreateTrip", () => {
    expect(canResolveReview(superAdminUser)).toBe(true);
    expect(canResolveReview(adminUser)).toBe(true);
    expect(canResolveReview(officerUser)).toBe(true);
    expect(canResolveReview(null)).toBe(false);

    expect(canCreateTrip(officerUser)).toBe(true);
    expect(canCreateTrip(null)).toBe(false);
  });

  describe("canAssignRole hierarchical protection", () => {
    it("rejects unauthenticated callers", () => {
      const res = canAssignRole(null, "user", "officer");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Authentication required");
    });

    it("rejects officers from changing any role", () => {
      const res = canAssignRole(officerUser, "user", "officer");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Officers do not have permission");
    });

    it("blocks admins from escalating privileges to admin or super_admin", () => {
      const toAdmin = canAssignRole(adminUser, "user", "admin");
      expect(toAdmin.allowed).toBe(false);
      expect(toAdmin.reason).toContain("Privilege escalation prohibited");

      const toSuper = canAssignRole(adminUser, "user", "super_admin");
      expect(toSuper.allowed).toBe(false);
      expect(toSuper.reason).toContain("Privilege escalation prohibited");
    });

    it("blocks admins from modifying existing admin or super_admin accounts", () => {
      const demoteAdmin = canAssignRole(adminUser, "admin", "officer");
      expect(demoteAdmin.allowed).toBe(false);
      expect(demoteAdmin.reason).toContain("cannot modify administrator");

      const demoteSuper = canAssignRole(adminUser, "super_admin", "user");
      expect(demoteSuper.allowed).toBe(false);
    });

    it("allows admins to manage user and officer roles", () => {
      const promoteToOfficer = canAssignRole(adminUser, "user", "officer");
      expect(promoteToOfficer.allowed).toBe(true);

      const demoteToUser = canAssignRole(adminUser, "officer", "user");
      expect(demoteToUser.allowed).toBe(true);
    });

    it("allows super_admins full delegation authority", () => {
      const promoteToAdmin = canAssignRole(superAdminUser, "officer", "admin");
      expect(promoteToAdmin.allowed).toBe(true);

      const promoteToSuper = canAssignRole(superAdminUser, "admin", "super_admin");
      expect(promoteToSuper.allowed).toBe(true);
    });
  });
});

describe("Registration Number & Review Notes Validation", () => {
  const INDIAN_PLATE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$/;

  it("validates standard Indian vehicle registration plates", () => {
    expect(INDIAN_PLATE_RE.test("GJ05AB1234")).toBe(true);
    expect(INDIAN_PLATE_RE.test("MH12DE1433")).toBe(true);
    expect(INDIAN_PLATE_RE.test("DL01A1")).toBe(true);
    expect(INDIAN_PLATE_RE.test("GJ01ABC9999")).toBe(true);
  });

  it("rejects invalid plate formats", () => {
    expect(INDIAN_PLATE_RE.test("")).toBe(false);
    expect(INDIAN_PLATE_RE.test("INVALID")).toBe(false);
    expect(INDIAN_PLATE_RE.test("1234GJ05")).toBe(false);
    expect(INDIAN_PLATE_RE.test("GJ-05-AB-1234")).toBe(false);
  });

  it("enforces mandatory manual review notes length (min 5 chars)", () => {
    const isValidNotes = (notes: string) => notes.trim().length >= 5;
    expect(isValidNotes("ok")).toBe(false);
    expect(isValidNotes("   ")).toBe(false);
    expect(isValidNotes("Confirmed plate match via high-res photograph")).toBe(true);
    expect(isValidNotes("Valid")).toBe(true);
  });
});
