/**
 * Re-export the database types for convenience.
 * Also export a helper to check whether Supabase is configured.
 */
export { supabase, createClient } from "./client";
export type { Database } from "./types";
export * from "./types";

/** Returns true when the Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
  return Boolean(url && key && url.startsWith("https://") && key.length > 10);
}
