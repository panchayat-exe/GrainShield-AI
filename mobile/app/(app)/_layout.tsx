/**
 * App group layout — bottom tab navigator for authenticated screens.
 */
import React from "react";
import { Text } from "react-native";
import { Tabs } from "expo-router";
import { Colors, FontSizes } from "@/constants/colors";

function TabIcon({ icon }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20 }}>{icon}</Text>;
}

export default function AppLayout() {
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
        options={{ title: "Upload", tabBarIcon: ({ color }) => <TabIcon icon="📤" color={color} /> }}
      />
      <Tabs.Screen
        name="processing"
        options={{ title: "Processing", tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} /> }}
      />
      <Tabs.Screen
        name="result"
        options={{ title: "Result", tabBarIcon: ({ color }) => <TabIcon icon="✅" color={color} /> }}
      />
      <Tabs.Screen
        name="failed"
        options={{ title: "Failed", tabBarIcon: ({ color }) => <TabIcon icon="❌" color={color} /> }}
      />
      <Tabs.Screen
        name="trip"
        options={{ title: "Trip", tabBarIcon: ({ color }) => <TabIcon icon="📋" color={color} /> }}
      />
      <Tabs.Screen
        name="tracking"
        options={{ title: "Tracking", tabBarIcon: ({ color }) => <TabIcon icon="📍" color={color} /> }}
      />
    </Tabs>
  );
}
