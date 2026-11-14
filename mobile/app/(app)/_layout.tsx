/**
 * App group layout — bottom tab navigator for authenticated screens.
 * Redirects to /(auth)/login if unauthenticated or if the account
 * role is not 'user' (admins/officers must use the web admin dashboard).
 */
import React from "react";
import { Text, View, ActivityIndicator } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Colors, FontSizes } from "@/constants/colors";

function TabIcon({ icon }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20 }}>{icon}</Text>;
}

export default function AppLayout() {
  const { user, profile, loading, isOffline } = useAuth();
  usePushNotifications(); // register for push + save token to profile

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: Colors.background,
        }}
      >
        <ActivityIndicator size="large" color={Colors.saffron} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  // Block non-citizen accounts from the driver/citizen mobile app.
  // Offline mode users are allowed through (profile may not yet be loaded).
  // Admin, officer, and super_admin roles must use the web admin dashboard.
  if (!isOffline && profile && profile.role !== "user") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.saffron,
        tabBarInactiveTintColor: Colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
        },
        tabBarLabelStyle: {
          fontSize: FontSizes.xs,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Upload",
          tabBarIcon: ({ color }) => <TabIcon icon="📤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="processing"
        options={{
          title: "Processing",
          tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} />,
        }}
      />
      <Tabs.Screen
        name="result"
        options={{
          title: "Result",
          tabBarIcon: ({ color }) => <TabIcon icon="✅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="failed"
        options={{
          title: "Failed",
          tabBarIcon: ({ color }) => <TabIcon icon="❌" color={color} />,
        }}
      />
      <Tabs.Screen
        name="trip"
        options={{
          title: "Trip",
          tabBarIcon: ({ color }) => <TabIcon icon="📋" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: "Tracking",
          tabBarIcon: ({ color }) => <TabIcon icon="📍" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon icon="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}
