/**
 * Supabase browser client — safe to use in React components and client-side hooks.
 * Uses the publishable (anon) key only. Reads cookies for session state.
 *
 * Import from here in any client component that needs Supabase access.
 *
 * NOTE: The client is intentionally untyped at the createBrowserClient level.
 * @supabase/supabase-js v2 resolves .insert()/.update() to `never[]` when the
 * Database generic is applied alongside exactOptionalPropertyTypes:true.
 * Instead, all service functions cast return values explicitly using the types
 * exported from ./types.ts, which keeps type safety without the compiler bug.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url =
    (import.meta.env["VITE_SUPABASE_URL"] as string) || "https://placeholder-project.supabase.co";
  const key =
    (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string) || "placeholder-anon-key";
  return createBrowserClient(url, key);
}

/** Singleton browser client for use in React components. */
export const supabase = createClient();
