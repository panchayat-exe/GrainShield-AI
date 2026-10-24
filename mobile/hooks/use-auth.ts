/**
 * useAuth — React Native equivalent of the web useAuth hook.
 * Uses the RN Supabase client with SecureStore session persistence.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { getProfile, signOut as authSignOut } from "@/lib/auth";
import type { Profile } from "@/lib/supabase/types";
import type { User } from "@supabase/supabase-js";

export interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      return;
    }
    const p = await getProfile();
    setProfile(p);
  }, []);

  useEffect(() => {
    // Initial session restore from SecureStore
    void supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      void loadProfile(u).finally(() => setLoading(false));
    });

    // Subscribe to auth changes (sign in / sign out / token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      void loadProfile(u);
    });

    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setProfile(null);
  }, []);

  return { user, profile, loading, signOut };
}
