/**
 * Forgot Password screen.
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { resetPassword } from "@/lib/auth";
import { forgotPasswordSchema } from "@/lib/validation";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid email");
      return;
    }
    setLoading(true);
    const { error: authError } = await resetPassword(email);
    setLoading(false);
    if (authError) { setError(authError); return; }
    setSent(true);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back to Sign In</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          Enter your email address and we'll send you a reset link.
        </Text>

        {sent ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              ✅ Reset link sent to {email}. Check your inbox (and spam folder).
            </Text>
          </View>
        ) : (
          <>
            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠ {error}</Text>
              </View>
            )}
            <Text style={styles.label}>Email <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.mutedForeground}
              editable={!loading}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.saffronForeground} />
                : <Text style={styles.buttonText}>Send Reset Link</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
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
  label: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
  required: { color: Colors.danger },
  input: {
    height: 48, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.input, backgroundColor: Colors.card,
    paddingHorizontal: Spacing[3], fontSize: FontSizes.sm, color: Colors.foreground,
  },
  button: {
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.saffron,
    alignItems: "center", justifyContent: "center", marginTop: Spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: Colors.saffronForeground, fontWeight: "700", fontSize: FontSizes.base },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1,
    borderColor: Colors.danger, borderRadius: Radius.md, padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  successBox: {
    backgroundColor: Colors.successSoft, borderWidth: 1,
    borderColor: Colors.success, borderRadius: Radius.md, padding: Spacing[4],
  },
  successText: { color: Colors.success, fontSize: FontSizes.sm, lineHeight: 22 },
});
