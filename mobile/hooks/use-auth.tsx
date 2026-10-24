/**
 * useAuth — React Native Auth Context and Hook.
 * Uses instant local storage inspection (<5ms) for zero-latency screen transitions,
 * with background session sync.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
      // 1. Instant local storage inspection (< 5ms)
      const [keys, offlineUser] = await Promise.all([
        AsyncStorage.getAllKeys().catch(() => [] as string[]),
        getOfflineUser().catch(() => null),
      ]);

      if (offlineUser) {
        const synthetic = {
          id: offlineUser.id,
          email: offlineUser.email,
          app_metadata: {},
          user_metadata: { full_name: offlineUser.full_name },
          aud: "authenticated",
          created_at: new Date().toISOString(),
        } as unknown as User;
        setUser(synthetic);
        setIsOffline(true);
        setLoading(false);
        void getProfile().then(setProfile).catch(() => {});
        return;
      }

      const authKey = keys.find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (authKey) {
        const raw = await AsyncStorage.getItem(authKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedUser = parsed?.user ?? parsed?.currentSession?.user ?? null;
          if (cachedUser) {
            setUser(cachedUser);
            setIsOffline(false);
            setLoading(false);
            // Refresh token & profile asynchronously in the background
            void supabase.auth.getSession().catch(() => {});
            void getProfile().then(setProfile).catch(() => {});
            return;
          }
        }
      }
    } catch {
      // Storage read error — fall through
    }

    // Unauthenticated: unblock UI immediately
    setUser(null);
    setProfile(null);
    setIsOffline(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void restoreSession();

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
