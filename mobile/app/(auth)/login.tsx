/**
 * Login screen — mirrors web /login route.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { signIn } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setLoading(true);
    const { error: authError } = await signIn(email, password);
    setLoading(false);
    if (authError) {
      setError(authError);
      return;
    }
    router.replace("/(app)");
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.govRow}>
          <Text style={styles.govText}>🏛 Government of Gujarat</Text>
        </View>
        <View style={styles.brandRow}>
          <Text style={styles.wheat}>🌾</Text>
          <View>
            <Text style={styles.appName}>
              GRAINSHIELD <Text style={styles.accent}>AI</Text>
            </Text>
            <Text style={styles.tagline}>AI-Powered Food Grain Transport Verification</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Sign In</Text>
          <Text style={styles.subtitle}>Enter your credentials to access GrainShield AI.</Text>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠ {error}</Text>
            </View>
          )}

          <Text style={styles.label}>
            Email <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.mutedForeground}
            editable={!loading}
          />

          <Text style={styles.label}>
            Password <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            placeholder="Min. 8 characters"
            placeholderTextColor={Colors.mutedForeground}
            editable={!loading}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity style={styles.forgotRow}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </Link>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.saffronForeground} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.registerRow}>
            <Text style={styles.registerText}>{"Don't have an account? "}</Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity>
                <Text style={styles.registerLink}>Register</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.header },
  govRow: {
    paddingHorizontal: Spacing[4],
    paddingVertical: 4,
    opacity: 0.9,
  },
  govText: { color: Colors.maroonForeground, fontSize: FontSizes.xs },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
    gap: Spacing[3],
  },
  wheat: { fontSize: 28 },
  appName: {
    color: Colors.maroonForeground,
    fontSize: FontSizes.lg,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  accent: { color: Colors.saffron },
  tagline: { color: Colors.maroonForeground, fontSize: FontSizes.xs, opacity: 0.8 },
  content: { padding: Spacing[4], gap: Spacing[3] },
  title: { fontSize: FontSizes["2xl"], fontWeight: "800", color: Colors.foreground, marginTop: Spacing[4] },
  subtitle: { fontSize: FontSizes.sm, color: Colors.mutedForeground, marginBottom: Spacing[2] },
  label: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
  required: { color: Colors.danger },
  input: {
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.input,
    backgroundColor: Colors.card,
    paddingHorizontal: Spacing[3],
    fontSize: FontSizes.sm,
    color: Colors.foreground,
  },
  forgotRow: { alignSelf: "flex-end" },
  forgotText: { color: Colors.info, fontSize: FontSizes.sm },
  button: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.saffron,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: Colors.saffronForeground,
    fontWeight: "700",
    fontSize: FontSizes.base,
  },
  errorBox: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: Radius.md,
    padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: Spacing[3],
  },
  registerText: { color: Colors.mutedForeground, fontSize: FontSizes.sm },
  registerLink: { color: Colors.info, fontWeight: "700", fontSize: FontSizes.sm },
});
