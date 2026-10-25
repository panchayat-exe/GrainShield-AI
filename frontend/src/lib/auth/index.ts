/**
 * Authentication helpers for GrainShield AI.
 *
 * All session validation is done via supabase.auth.getUser() (trusted server API),
 * NOT by trusting the session object from getSession() for authorization.
 */
import { supabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/types";

export type AuthUser = {
  id: string;
  email: string;
};

/** Returns the currently authenticated user, or null. Uses the trusted getUser() API. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** Returns the profile record for the current user, or null. */
export async function getProfile(): Promise<Profile | null> {
  const user = await getAuthUser();
  if (!user) return null;

  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error || !data) {
      return {
        id: user.id,
        email: user.email,
        full_name: user.email.split("@")[0] || "User",
        phone: null,
        district: null,
        organization_id: null,
        role: "user",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    return data as Profile;
  } catch {
    return {
      id: user.id,
      email: user.email,
      full_name: user.email.split("@")[0] || "User",
      phone: null,
      district: null,
      organization_id: null,
      role: "user",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

/** Signs out the current user. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Signs in with email + password. Returns error message on failure. */
export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const cleanEmail = email.trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) return { error: error.message };
  return { error: null };
}

/** Registers a new user. Returns error message on failure. */
export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ error: string | null }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();
  const { error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: { full_name: cleanName },
    },
  });
  if (error) return { error: error.message };
  return { error: null };
}

/** Sends a password-reset email. */
export async function resetPassword(email: string): Promise<{ error: string | null }> {
  const cleanEmail = email.trim().toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
  if (error) return { error: error.message };
  return { error: null };
}

/** Updates the password for the currently logged-in user (after reset link). */
export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { error: null };
}

/**
 * React hook (via supabase realtime) for auth state.
 * Returns a cleanup function.
 */
export function onAuthStateChange(callback: (userId: string | null) => void): () => void {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.id ?? null);
  });
  return () => listener.subscription.unsubscribe();
}
