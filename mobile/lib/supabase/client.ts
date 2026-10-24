/**
 * Supabase client for React Native.
 *
 * Key differences from the web client:
 * - Uses @supabase/supabase-js directly (not @supabase/ssr)
 * - Session stored in expo-secure-store (encrypted native storage)
 * - Requires react-native-url-polyfill
 * - Credentials come from EXPO_PUBLIC_ env vars (safe — anon/publishable key only)
 */
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// SecureStore adapter for Supabase session persistence
// ---------------------------------------------------------------------------
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** True only if real credentials are configured */
export function isSupabaseConfigured(): boolean {
  return (
    supabaseUrl !== "https://placeholder-project.supabase.co" &&
    supabaseAnonKey !== "placeholder-anon-key"
  );
}
