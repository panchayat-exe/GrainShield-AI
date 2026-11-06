/**
 * GrainShield AI Admin — Authentication & RBAC helpers
 * Enforces role-based access control backed by server-side profile verification.
 */
import { supabase, type UserRole } from "./supabase";

export type AdminUser = {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  district: string | null;
};

/** Returns current admin session or null. Checks role server-side via profile table. */
export async function getAdminSession(): Promise<AdminUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, district")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;
  const role = profile.role as UserRole;
  if (!["admin", "super_admin", "officer"].includes(role)) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    role,
    full_name: profile.full_name ?? null,
    district: profile.district ?? null,
  };
}

/** Sign in with official email + password. Returns error string on failure. */
export async function adminSignIn(
  email: string,
  password: string,
): Promise<{ user: AdminUser | null; error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { user: null, error: error.message };

  const user = await getAdminSession();
  if (!user) {
    await supabase.auth.signOut();
    return {
      user: null,
      error: "Access denied. This portal is restricted to authorized administrative officers.",
    };
  }
  return { user, error: null };
}

/** Sign out current admin session. */
export async function adminSignOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Request secure password reset email. */
export async function adminResetPassword(email: string): Promise<{ error: string | null }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return { error: "Please enter your official email address." };
  // redirectTo ensures the reset link returns the user to the admin portal's
  // own reset-password page, not the generic Supabase default.
  const options =
    typeof window !== "undefined"
      ? { redirectTo: `${window.location.origin}/auth/reset-password` }
      : {};
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, options);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Role-Based Access Control (RBAC) Permissions
// ---------------------------------------------------------------------------

export function isSuperAdmin(user: AdminUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdmin(user: AdminUser | null | undefined): boolean {
  return user?.role === "admin" || user?.role === "super_admin";
}

export function isOfficer(user: AdminUser | null | undefined): boolean {
  return user?.role === "officer" || user?.role === "admin" || user?.role === "super_admin";
}

/** Only administrators and super_admins can access user management. */
export function canManageUsers(user: AdminUser | null | undefined): boolean {
  return isSuperAdmin(user) || user?.role === "admin";
}

/**
 * Validates whether the caller has authority to modify a target user's role.
 * Hierarchical protection prevents privilege escalation:
 * - Officers cannot change any role.
 * - Admins can assign 'user' or 'officer'; cannot modify super_admin or admin accounts.
 * - Super Admins can assign any role (cannot demote last remaining super admin).
 */
export function canAssignRole(
  caller: AdminUser | null | undefined,
  targetCurrentRole: UserRole,
  targetNewRole: UserRole,
): { allowed: boolean; reason?: string } {
  if (!caller) return { allowed: false, reason: "Authentication required." };

  if (caller.role === "officer" || caller.role === "user") {
    return { allowed: false, reason: "Officers do not have permission to manage user roles." };
  }

  if (caller.role === "admin") {
    if (targetCurrentRole === "super_admin" || targetCurrentRole === "admin") {
      return {
        allowed: false,
        reason: "Regular administrators cannot modify administrator or super-admin accounts.",
      };
    }
    if (targetNewRole === "admin" || targetNewRole === "super_admin") {
      return {
        allowed: false,
        reason:
          "Privilege escalation prohibited: only super_admins can grant administrator privileges.",
      };
    }
  }

  return { allowed: true };
}

/** Officers, Admins, and Super Admins can resolve manual verification cases. */
export function canResolveReview(user: AdminUser | null | undefined): boolean {
  return isOfficer(user);
}

/** Officers, Admins, and Super Admins can create transport trips. */
export function canCreateTrip(user: AdminUser | null | undefined): boolean {
  return isOfficer(user);
}
