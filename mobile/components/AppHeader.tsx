/**
 * AppHeader — sticky top header matching the web GrainShield AI branding.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, FontSizes, Spacing } from "@/constants/colors";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "expo-router";

interface AppHeaderProps {
  showBack?: boolean;
}

export function AppHeader({ showBack }: AppHeaderProps) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const displayName = profile?.full_name ?? user?.email?.split("@")[0] ?? "Officer";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.govRow}>
        <Text style={styles.govText}>🏛 Government of Gujarat</Text>
        {user && <Text style={styles.govText}>{displayName}</Text>}
      </View>
      <View style={styles.brandRow}>
        {showBack && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.wheat}>🌾</Text>
        <View style={styles.brandText}>
          <Text style={styles.appName}>
            GRAINSHIELD <Text style={styles.appNameAccent}>AI</Text>
          </Text>
          <Text style={styles.tagline}>AI-Powered Food Grain Transport Verification</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: Colors.header,
  },
  govRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing[4],
    paddingVertical: 4,
    opacity: 0.9,
  },
  govText: {
    color: Colors.maroonForeground,
    fontSize: FontSizes.xs,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
    gap: Spacing[3],
  },
  backBtn: {
    marginRight: 4,
  },
  backText: {
    color: Colors.maroonForeground,
    fontSize: FontSizes.xl,
    fontWeight: "600",
  },
  wheat: {
    fontSize: 28,
  },
  brandText: {
    flex: 1,
  },
  appName: {
    color: Colors.maroonForeground,
    fontSize: FontSizes.lg,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  appNameAccent: {
    color: Colors.saffron,
  },
  tagline: {
    color: Colors.maroonForeground,
    fontSize: FontSizes.xs,
    opacity: 0.8,
  },
});
