/**
 * useAuth — React Native Auth Context and Hook.
 * Uses the RN Supabase client with AsyncStorage session persistence,
 * with fast timeout fallback to local Offline Field Mode.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
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

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  const restoreSession = useCallback(async () => {
    try {
      // 2-second timeout so app NEVER hangs on network or cellular blips
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 2000)
      );

      const { data } = await Promise.race([sessionPromise, timeoutPromise]);
      if (data?.session?.user) {
        setUser(data.session.user);
        setIsOffline(false);
        // Load profile in background without blocking screen render
        void getProfile().then(setProfile).catch(() => {});
        return;
      }
    } catch {
      // network / storage blip — fall through
    }

    // Check for offline session
    try {
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
        void getProfile().then(setProfile).catch(() => {});
        return;
      }
    } catch {
      // ignore
    }

    setUser(null);
    setProfile(null);
    setIsOffline(false);
  }, []);

  useEffect(() => {
    void restoreSession().finally(() => setLoading(false));

    // Subscribe to auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsOffline(false);
        void getProfile().then(setProfile).catch(() => {});
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
  }, [restoreSession]);

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
    void getProfile().then(setProfile).catch(() => {});
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      loading,
      isOffline,
      signOut,
      enterOfflineMode,
    }),
    [user, profile, loading, isOffline, signOut, enterOfflineMode]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    // Return safe default if rendered outside provider (e.g. isolated test environments)
    return {
      user: null,
      profile: null,
      loading: false,
      isOffline: false,
      signOut: async () => {},
      enterOfflineMode: async () => {},
    };
  }
  return context;
}
