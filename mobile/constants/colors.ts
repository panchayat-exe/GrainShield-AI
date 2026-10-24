/**
 * GrainShield AI — Design Tokens for React Native
 *
 * Mirrors the Tailwind CSS custom colors defined in the web app:
 * maroon header, saffron accent, danger/success/info/warning semantics.
 */

export const Colors = {
  // Brand
  maroon: "#7B1D1D",
  maroonForeground: "#FFF8F0",
  saffron: "#E8821A",
  saffronForeground: "#1A0A00",

  // Semantic
  success: "#15803D",
  successSoft: "#F0FDF4",
  danger: "#B91C1C",
  dangerSoft: "#FEF2F2",
  warning: "#B45309",
  warningSoft: "#FFFBEB",
  info: "#1D4ED8",
  infoSoft: "#EFF6FF",

  // Neutral
  background: "#F9FAFB",
  card: "#FFFFFF",
  border: "#E5E7EB",
  foreground: "#111827",
  mutedForeground: "#6B7280",
  input: "#D1D5DB",

  // Header
  header: "#7B1D1D",
} as const;

export const FontSizes = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
} as const;

export const Spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;
