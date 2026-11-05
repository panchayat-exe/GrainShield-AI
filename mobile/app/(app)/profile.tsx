import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase/client";

const BURGUNDY = "#7C0A02";
const GOLD = "#C8972B";
const NAVY = "#1B2A4A";
const BG = "#F5F3EF";
const CARD = "#FFFFFF";
const TEXT = "#1a1a1a";
const MUTED = "#6B7280";
const BORDER = "#E5E7EB";
const SUCCESS = "#16a34a";
const ERROR = "#DC2626";

export default function ProfileScreen() {
  const { user, profile, loading: authLoading } = useAuth();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/(auth)/login");
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
      setDistrict(profile.district ?? "");
    }
  }, [profile]);

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        district: district.trim() || null,
      })
      .eq("id", user.id);

    if (error) {
      setSaveError(error.message);
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  }, [user, fullName, phone, district]);

  const handleChangePassword = useCallback(async () => {
    setPwError(null);
    setPwSuccess(false);

    if (!newPw || newPw.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match.");
      return;
    }

    Alert.alert(
      "Change Password",
      "Are you sure you want to update your password?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          style: "destructive",
          onPress: async () => {
            setPwSaving(true);
            const { error } = await supabase.auth.updateUser({
              password: newPw,
            });
            if (error) {
              setPwError(error.message);
            } else {
              setPwSuccess(true);
              setNewPw("");
              setConfirmPw("");
              setTimeout(() => setPwSuccess(false), 3000);
            }
            setPwSaving(false);
          },
        },
      ],
    );
  }, [newPw, confirmPw]);

  if (authLoading) {
    return (
      <View style={styles.centeredLoader}>
        <ActivityIndicator size="large" color={BURGUNDY} />
      </View>
    );
  }

  if (!user) return null;

  const roleName = (profile?.role ?? "user").replace(/_/g, " ");
  const initials = (profile?.full_name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen
        options={{
          title: "My Profile",
          headerStyle: { backgroundColor: NAVY },
          headerTintColor: "#FFFFFF",
          headerTitleStyle: { fontWeight: "bold" },
        }}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.displayName}>
            {profile?.full_name ?? user.email}
          </Text>
          <Text style={styles.email}>{user.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="shield-checkmark" size={12} color={BURGUNDY} />
            <Text style={styles.roleText}>{roleName}</Text>
          </View>
        </View>

        {/* Edit Profile Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Edit Profile</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ramesh Patel"
            placeholderTextColor={MUTED}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 98765 43210"
            placeholderTextColor={MUTED}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>District</Text>
          <TextInput
            style={styles.input}
            value={district}
            onChangeText={setDistrict}
            placeholder="Ahmedabad"
            placeholderTextColor={MUTED}
            autoCapitalize="words"
          />

          {saveError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color={ERROR} />
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          )}
          {saveSuccess && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
              <Text style={styles.successText}>
                Profile saved successfully.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={handleSaveProfile}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="save" size={16} color="#fff" />
            )}
            <Text style={styles.btnText}>
              {saving ? "Saving…" : "Save Profile"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Change Password Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change Password</Text>

          <Text style={styles.label}>New Password</Text>
          <TextInput
            style={styles.input}
            value={newPw}
            onChangeText={setNewPw}
            placeholder="Minimum 8 characters"
            placeholderTextColor={MUTED}
            secureTextEntry
          />

          <Text style={styles.label}>Confirm New Password</Text>
          <TextInput
            style={styles.input}
            value={confirmPw}
            onChangeText={setConfirmPw}
            placeholder="Repeat password"
            placeholderTextColor={MUTED}
            secureTextEntry
          />

          {pwError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color={ERROR} />
              <Text style={styles.errorText}>{pwError}</Text>
            </View>
          )}
          {pwSuccess && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
              <Text style={styles.successText}>
                Password changed. Use new password on next sign-in.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnSecondary,
              pwSaving && styles.btnDisabled,
            ]}
            onPress={handleChangePassword}
            disabled={pwSaving}
          >
            {pwSaving ? (
              <ActivityIndicator size="small" color={BURGUNDY} />
            ) : (
              <Ionicons name="lock-closed" size={16} color={BURGUNDY} />
            )}
            <Text style={[styles.btnText, { color: BURGUNDY }]}>
              {pwSaving ? "Updating…" : "Change Password"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={async () => {
            try {
              await supabase.auth.signOut();
            } catch (err) {
              console.warn("[Profile] signOut error:", err);
            }
            router.replace("/(auth)/login");
          }}
        >
          <Ionicons name="log-out" size={16} color={ERROR} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: BG },
  content: { padding: 16 },
  centeredLoader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
  },

  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: BURGUNDY + "20",
    borderWidth: 2,
    borderColor: BURGUNDY,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  avatarText: { fontSize: 26, fontWeight: "bold", color: BURGUNDY },
  displayName: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT,
    marginBottom: 2,
  },
  email: { fontSize: 13, color: MUTED, marginBottom: 8 },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: BURGUNDY + "12",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
  },
  roleText: {
    fontSize: 11,
    fontWeight: "600",
    color: BURGUNDY,
    textTransform: "capitalize",
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: "700", color: NAVY, marginBottom: 14 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: TEXT,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: TEXT,
    backgroundColor: "#FAFAFA",
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: ERROR + "10",
    borderWidth: 1,
    borderColor: ERROR + "30",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  errorText: { fontSize: 12, color: ERROR, flex: 1 },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: SUCCESS + "10",
    borderWidth: 1,
    borderColor: SUCCESS + "30",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  successText: { fontSize: 12, color: SUCCESS, flex: 1 },

  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: BURGUNDY,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 16,
  },
  btnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: BURGUNDY,
  },
  btnDisabled: { opacity: 0.55 },
  btnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ERROR + "40",
    backgroundColor: ERROR + "08",
    marginBottom: 8,
  },
  signOutText: { fontSize: 14, fontWeight: "600", color: ERROR },
});
