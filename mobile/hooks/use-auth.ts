/**
 * useAuth — React Native equivalent of the web useAuth hook.
 * Uses the RN Supabase client with SecureStore session persistence,
 * with fallback to local Offline Field Mode.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  getProfile,
  signOut as authSignOut,
  getOfflineUser,
  enableOfflineMode,
  disableOfflineMode,
} from "@/lib/auth";
import type { Profile } from "@/lib/supabase/types";
import type { User } from "@supabase/supabase-js";

export interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isOffline: boolean;
  signOut: () => Promise<void>;
  enterOfflineMode: (fullName?: string) => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      return;
    }
    const p = await getProfile();
    setProfile(p);
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        setUser(data.session.user);
        setIsOffline(false);
        await loadProfile(data.session.user);
        return;
      }
    } catch {
      // offline
    }

    // Check for offline session
    const offline = await getOfflineUser();
    if (offline) {
      const synthetic = {
        id: offline.id,
        email: offline.email,
        app_metadata: {},
        user_metadata: { full_name: offline.full_name },
        aud: "authenticated",
        created_at: new Date().toISOString(),
      } as unknown as User;
      setUser(synthetic);
      setIsOffline(true);
      await loadProfile(synthetic);
      return;
    }

    setUser(null);
    setProfile(null);
    setIsOffline(false);
  }, [loadProfile]);

  useEffect(() => {
    void restoreSession().finally(() => setLoading(false));

    // Subscribe to auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsOffline(false);
        await loadProfile(session.user);
      } else {
        const offline = await getOfflineUser();
        if (!offline) {
          setUser(null);
          setProfile(null);
          setIsOffline(false);
        }
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [loadProfile, restoreSession]);

  const signOut = useCallback(async () => {
    await authSignOut();
    await disableOfflineMode();
    setUser(null);
    setProfile(null);
    setIsOffline(false);
  }, []);

  const enterOfflineMode = useCallback(async (fullName?: string) => {
    const off = await enableOfflineMode(fullName);
    const synthetic = {
      id: off.id,
      email: off.email,
      app_metadata: {},
      user_metadata: { full_name: off.full_name },
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as unknown as User;
    setUser(synthetic);
    setIsOffline(true);
    await loadProfile(synthetic);
  }, [loadProfile]);

  return { user, profile, loading, isOffline, signOut, enterOfflineMode };
}
