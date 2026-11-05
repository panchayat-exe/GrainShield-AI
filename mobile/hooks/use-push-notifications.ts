/**

 * use-push-notifications.ts

 * Registers for Expo push notifications, persists the push token to

 * the user's profile row in Supabase, and surfaces a helper to send

 * local in-app notifications (for status-change banners).

 *

 * Usage:

 *   const { expoPushToken } = usePushNotifications();

 */

import { useEffect, useState } from "react";

import * as Notifications from "expo-notifications";

import Constants from "expo-constants";

import { Platform } from "react-native";

import { supabase } from "@/lib/supabase/client";

import { useAuth } from "@/hooks/use-auth";

// Show alerts while app is foregrounded

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,

    shouldPlaySound: true,

    shouldSetBadge: false,
  }),
});

export type PushNotificationState = {
  expoPushToken: string | null;

  permissionGranted: boolean;
};

export function usePushNotifications(): PushNotificationState {
  const { user } = useAuth();

  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    if (!user) return;

    void registerForPushNotifications().then(async (token) => {
      if (!token) return;

      setExpoPushToken(token);

      setPermissionGranted(true);

      // Persist token to profiles table so the server can send targeted pushes

      await supabase

        .from("profiles")

        .update({ push_token: token })

        .eq("id", user.id);
    });
  }, [user]);

  return { expoPushToken, permissionGranted };
}

async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  // Check / request permission

  const { status: existing } = await Notifications.getPermissionsAsync();

  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();

    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("[push] Permission not granted.");

    return null;
  }

  // Android channel (required for Android 8+)

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("grainshield", {
      name: "GrainShield AI",

      importance: Notifications.AndroidImportance.HIGH,

      vibrationPattern: [0, 250, 250, 250],

      lightColor: "#7C0A02",
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn("[push] No EAS projectId found — skipping push token.");

      return null;
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });

    return data;
  } catch (err) {
    console.warn("[push] Could not get push token:", err);

    return null;
  }
}

/**

 * Schedule a local notification immediately (no server required).

 * Use for in-app status-change alerts when app is backgrounded.

 */

export async function sendLocalNotification(
  title: string,

  body: string,

  data?: Record<string, unknown>,
) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, sound: true },

    trigger: null, // fire immediately
  });
}
