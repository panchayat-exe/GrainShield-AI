/**
 * GrainShield AI Admin — Authentication helpers
 * Sign in, sign out, get current admin session.
 */
import { supabase } from "./supabase";

export type AdminUser = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
};

/** Returns current admin session or null. Checks role server-side via profile. */
export async function getAdminSession(): Promise<AdminUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;
  const role = profile.role as string;
  if (!["admin", "super_admin", "officer"].includes(role)) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    role,
    full_name: profile.full_name ?? null,
  };
}

/** Sign in with email + password. Returns error string on failure. */
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
    return { user: null, error: "Access denied. This portal is restricted to admin and officer accounts." };
  }
  return { user, error: null };
}

/** Sign out current session. */
export async function adminSignOut(): Promise<void> {
  await supabase.auth.signOut();
}
