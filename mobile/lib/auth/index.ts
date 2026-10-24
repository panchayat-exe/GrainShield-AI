/**
 * Auth helpers for React Native.
 * Same API as web auth/index.ts but using the RN Supabase client.
 * NOTE: resetPassword does NOT use window.location — it uses a deep link scheme.
 */
import { supabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/types";

export type AuthUser = {
  id: string;
  email: string;
};

export async function getAuthUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

export async function getProfile(): Promise<Profile | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) return null;
  return data as Profile;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function signIn(
  email: string,
  password: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signUp(
  email: string,
  password: string,
  fullName: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) return { error: error.message };
  return { error: null };
}

/**
 * Send a password-reset email.
 * The deep link redirectTo should match the scheme defined in app.json.
 */
export async function resetPassword(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "grainshield://auth/reset-password",
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { error: null };
}

export function onAuthStateChange(callback: (userId: string | null) => void): () => void {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.id ?? null);
  });
  return () => listener.subscription.unsubscribe();
}
