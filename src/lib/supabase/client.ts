/**
 * Supabase browser client — safe to use in React components and client-side hooks.
 * Uses the publishable (anon) key only. Reads cookies for session state.
 *
 * Import from here in any client component that needs Supabase access.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    import.meta.env["VITE_SUPABASE_URL"] as string,
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string,
  );
}

/** Singleton browser client for use in React components. */
export const supabase = createClient();
