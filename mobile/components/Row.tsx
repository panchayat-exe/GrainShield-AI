/**
 * Row — a labeled key/value row used inside Cards.
 * Matches the web AppShell Row component.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, FontSizes, Spacing } from "@/constants/colors";

type RowTone = "success" | "danger" | "warning" | "info";

const toneColors: Record<RowTone, string> = {
  success: Colors.success,
  danger: Colors.danger,
  warning: Colors.warning,
  info: Colors.info,
};

interface RowProps {
  label: string;
  value: string;
  tone?: RowTone;
}

export function Row({ label, value, tone }: RowProps) {
  const valueColor = tone ? toneColors[tone] : Colors.foreground;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: Spacing[2],
  },
  label: {
    fontSize: FontSizes.sm,
    color: Colors.mutedForeground,
    flex: 1,
  },
  value: {
    fontSize: FontSizes.sm,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
});
