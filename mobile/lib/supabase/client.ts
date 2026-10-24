/**
 * Supabase client for React Native.
 *
 * Session persistence uses @react-native-async-storage/async-storage
 * (recommended by Supabase for React Native to avoid Android Keystore 2048-byte limits).
 */
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
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
