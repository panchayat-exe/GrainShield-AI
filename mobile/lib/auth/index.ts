/**
 * Auth helpers for React Native.
 * Same API as web auth/index.ts but using the RN Supabase client,
 * with built-in Offline Field Mode support.
 */
import { supabase } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const OFFLINE_AUTH_KEY = "@grainshield_offline_auth";

export type AuthUser = {
  id: string;
  email: string;
  isOffline?: boolean;
};

export interface OfflineUser {
  id: string;
  email: string;
  full_name: string;
  is_offline: true;
}

export async function enableOfflineMode(fullName?: string): Promise<OfflineUser> {
  const offlineUser: OfflineUser = {
    id: "offline-field-operator",
    email: "operator@grainshield.local",
    full_name: fullName?.trim() || "Field Operator (Offline)",
    is_offline: true,
  };
  await AsyncStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(offlineUser));
  return offlineUser;
}

export async function getOfflineUser(): Promise<OfflineUser | null> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OfflineUser;
  } catch {
    return null;
  }
}

export async function disableOfflineMode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_AUTH_KEY);
  } catch {
    // ignore
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) {
      return { id: data.user.id, email: data.user.email ?? "" };
    }
  } catch {
    // network failure while offline
  }

  // Fallback to offline session
  const offline = await getOfflineUser();
  if (offline) {
    return { id: offline.id, email: offline.email, isOffline: true };
  }
  return null;
}

export async function getProfile(): Promise<Profile | null> {
  const user = await getAuthUser();
  if (!user) return null;

  if (user.isOffline) {
    const off = await getOfflineUser();
    return {
      id: user.id,
      email: user.email,
      full_name: off?.full_name ?? "Field Operator (Offline)",
      phone: null,
      district: null,
      organization_id: null,
      role: "user",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (error) return null;
    return data as Profile;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await disableOfflineMode();
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore network failure on sign out
  }
}

export async function signIn(
  email: string,
  password: string
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await disableOfflineMode();
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network connection failed";
    return { error: msg };
  }
}

export async function signUp(
  email: string,
  password: string,
  fullName: string
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network connection failed";
    return { error: msg };
  }
}

/**
 * Send a password-reset email.
 * The deep link redirectTo matches the scheme defined in app.json.
 */
export async function resetPassword(email: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "grainshield://auth/reset-password",
    });
    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network connection failed";
    return { error: msg };
  }
}

export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network connection failed";
    return { error: msg };
  }
}

export function onAuthStateChange(callback: (userId: string | null) => void): () => void {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.id ?? null);
  });
  return () => listener.subscription.unsubscribe();
}
