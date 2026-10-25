/**
 * Register screen — mirrors web /register route.
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
import { signUp } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    const parsed = registerSchema.safeParse({
      full_name: fullName,
      email,
      password,
      confirm_password: confirmPassword,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setLoading(true);
    const { error: authError, session } = await signUp(email, password, fullName);
    setLoading(false);
    if (authError) {
      setError(authError);
      return;
    }
    if (session) {
      router.replace("/(app)");
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successText}>
            We sent a confirmation link to {email}. Open it to activate your account, then sign in.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace("/(auth)/login")}>
            <Text style={styles.buttonText}>Go to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Register to submit trip verifications.</Text>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠ {error}</Text>
            </View>
          )}

          {[
            { label: "Full Name", value: fullName, setter: setFullName, placeholder: "Your full name", autoComplete: "name" as const, keyboardType: "default" as const },
            { label: "Email", value: email, setter: setEmail, placeholder: "you@example.com", autoComplete: "email" as const, keyboardType: "email-address" as const },
            { label: "Password", value: password, setter: setPassword, placeholder: "Min. 8 characters", autoComplete: "new-password" as const, keyboardType: "default" as const, secure: true },
            { label: "Confirm Password", value: confirmPassword, setter: setConfirmPassword, placeholder: "Repeat password", autoComplete: "new-password" as const, keyboardType: "default" as const, secure: true },
          ].map(({ label, value, setter, placeholder, autoComplete, keyboardType, secure }) => (
            <View key={label}>
              <Text style={styles.label}>
                {label} <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setter}
                placeholder={placeholder}
                placeholderTextColor={Colors.mutedForeground}
                autoComplete={autoComplete}
                keyboardType={keyboardType}
                autoCapitalize={secure || keyboardType === "email-address" ? "none" : "words"}
                autoCorrect={!secure && keyboardType !== "email-address"}
                secureTextEntry={secure}
                editable={!loading}
              />
            </View>
          ))}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.saffronForeground} />
            ) : (
              <Text style={styles.buttonText}>Register</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.loginLink}>Sign In</Text>
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
  content: { padding: Spacing[4], gap: Spacing[3] },
  backBtn: { marginBottom: Spacing[2] },
  backText: { color: Colors.info, fontSize: FontSizes.sm },
  title: { fontSize: FontSizes["2xl"], fontWeight: "800", color: Colors.foreground },
  subtitle: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  label: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground, marginBottom: 4 },
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
  button: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.saffron,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.saffronForeground, fontWeight: "700", fontSize: FontSizes.base },
  errorBox: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: Radius.md,
    padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  loginRow: { flexDirection: "row", justifyContent: "center", marginTop: Spacing[3] },
  loginText: { color: Colors.mutedForeground, fontSize: FontSizes.sm },
  loginLink: { color: Colors.info, fontWeight: "700", fontSize: FontSizes.sm },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing[6],
    gap: Spacing[4],
  },
  successIcon: { fontSize: 48 },
  successTitle: { fontSize: FontSizes["2xl"], fontWeight: "800", color: Colors.foreground, textAlign: "center" },
  successText: { fontSize: FontSizes.sm, color: Colors.mutedForeground, textAlign: "center", lineHeight: 22 },
});
