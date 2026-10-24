/**
 * Reusable Card component — wraps content in a styled native View.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Spacing, Radius, FontSizes } from "@/constants/colors";

interface CardProps {
  title?: string;
  children: React.ReactNode;
  style?: object;
}

export function Card({ title, children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing[4],
    gap: Spacing[1],
  },
  title: {
    fontSize: FontSizes.sm,
    fontWeight: "700",
    color: Colors.foreground,
    marginBottom: Spacing[2],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
