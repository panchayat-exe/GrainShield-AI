/**
 * StatusBadge — colored badge for verification/trip status.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, FontSizes } from "@/constants/colors";

type BadgeVariant = "success" | "danger" | "warning" | "info" | "neutral";

const variantStyles: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: Colors.successSoft, text: Colors.success },
  danger: { bg: Colors.dangerSoft, text: Colors.danger },
  warning: { bg: Colors.warningSoft, text: Colors.warning },
  info: { bg: Colors.infoSoft, text: Colors.info },
  neutral: { bg: Colors.border, text: Colors.mutedForeground },
};

interface StatusBadgeProps {
  label: string;
  variant: BadgeVariant;
}

export function StatusBadge({ label, variant }: StatusBadgeProps) {
  const { bg, text } = variantStyles[variant];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

export function verificationVariant(status: string): BadgeVariant {
  switch (status) {
    case "pass":
      return "success";
    case "retake":
    case "manual_review":
    case "error":
      return "danger";
    case "processing":
      return "info";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: FontSizes.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
