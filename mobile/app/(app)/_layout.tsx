/**
 * App group layout — bottom tab navigator for authenticated screens.
 */
import { Tabs } from "expo-router";
import { Colors, FontSizes } from "@/constants/colors";

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

function TabIcon({ icon, color }: { icon: string; color: string }) {
  // Simple emoji icon — replace with @expo/vector-icons for production
  const { Text } = require("react-native");
  return <Text style={{ fontSize: 20 }}>{icon}</Text>;
}
