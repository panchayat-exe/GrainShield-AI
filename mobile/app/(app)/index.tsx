/**
 * Upload screen — main citizen workflow.
 * Mirrors web / (index) route.
 *
 * Features:
 * - Trip code + vehicle number + stage form with Zod validation
 * - expo-image-picker: camera capture OR gallery selection
 * - Photo preview with retake
 * - Uploads to Supabase Storage (private bucket)
 * - Creates pending verification record
 * - Navigates to /processing on success
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Image, ActivityIndicator, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { OutboxBanner } from "@/components/OutboxBanner";
import { Card } from "@/components/Card";
import { useAuth } from "@/hooks/use-auth";
import { upsertTrip } from "@/lib/services/trips";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import { saveToOutbox } from "@/lib/offline/outbox";
import { uploadSchema, validatePhotoAsset } from "@/lib/validation";
import type { TripStage } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

type PhotoAsset = ImagePicker.ImagePickerAsset;

const STAGES: { label: string; value: TripStage }[] = [
  { label: "First Mile", value: "first_mile" },
  { label: "Last Mile", value: "last_mile" },
];

export default function UploadScreen() {
  const router = useRouter();
  const { user, isOffline } = useAuth();

  const [tripCode, setTripCode] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [stage, setStage] = useState<TripStage | "">("");
  const [photo, setPhoto] = useState<PhotoAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // ─── Photo selection ──────────────────────────────────────────────
  async function requestCameraPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Camera Permission Required",
        "Please allow camera access in Settings to capture trip photographs.",
        [{ text: "OK" }]
      );
      return false;
    }
    return true;
  }

  async function handleTakePhoto() {
    const granted = await requestCameraPermission();
    if (!granted) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
      exif: false,
    });

    if (result.canceled || !result.assets[0]) return;
    applyPhoto(result.assets[0]);
  }

  async function handleChoosePhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Photo Library Permission Required",
        "Please allow photo library access in Settings.",
        [{ text: "OK" }]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
      exif: false,
    });

    if (result.canceled || !result.assets[0]) return;
    applyPhoto(result.assets[0]);
  }

  function applyPhoto(asset: PhotoAsset) {
    const validation = validatePhotoAsset({
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
    });
    if (!validation.valid) {
      setPhotoError(validation.error);
      return;
    }
    setPhotoError(null);
    setPhoto(asset);
  }

  function handleReset() {
    setTripCode("");
    setVehicleNumber("");
    setStage("");
    setPhoto(null);
    setError(null);
    setPhotoError(null);
  }

  // ─── Submit ───────────────────────────────────────────────────────
  async function handleSubmit() {
    setError(null);
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }

    const parsed = uploadSchema.safeParse({
      trip_code: tripCode,
      vehicle_number: vehicleNumber,
      stage,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Please fill in all required fields.");
      return;
    }
    if (!photo) {
      setError("Please capture or select a photograph before submitting.");
      return;
    }

    setSubmitting(true);

    const queueOffline = async () => {
      const fileName = photo.fileName ?? `photo_${Date.now()}.jpg`;
      const mimeType = photo.mimeType ?? "image/jpeg";
      const fileSize = photo.fileSize ?? 0;

      const { item, error: outboxError } = await saveToOutbox({
        tripCode: parsed.data.trip_code,
        vehicleNumber: parsed.data.vehicle_number,
        stage: parsed.data.stage as TripStage,
        sourcePhotoUri: photo.uri,
        originalFileName: fileName,
        mimeType,
        fileSize,
      });

      if (outboxError || !item) {
        setError(outboxError ?? "Failed to save offline evidence.");
        return;
      }

      handleReset();
      Alert.alert(
        "📦 Saved to Offline Outbox",
        `Trip ${item.tripCode} and evidence photograph have been stored safely on your device.\n\nWhen internet is restored, tap "Sync Now" in the outbox banner to upload to Supabase cloud.`,
        [
          {
            text: "View Outbox / Processing",
            onPress: () => {
              router.push({
                pathname: "/(app)/processing",
                params: { outboxId: item.id },
              });
            },
          },
          { text: "Done" },
        ]
      );
    };

    if (isOffline) {
      try {
        await queueOffline();
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      // 1. Upsert trip
      const { trip, error: tripError } = await upsertTrip({
        tripCode: parsed.data.trip_code,
        vehicleNumber: parsed.data.vehicle_number,
        stage: parsed.data.stage as TripStage,
        userId: user.id,
      });
      if (tripError || !trip) {
        console.warn("[upload] Network trip error, saving to outbox:", tripError);
        await queueOffline();
        return;
      }

      // 2. Upload evidence photograph
      const fileName = photo.fileName ?? `photo_${Date.now()}.jpg`;
      const mimeType = photo.mimeType ?? "image/jpeg";
      const fileSize = photo.fileSize ?? 0;

      const { evidence, error: evidenceError } = await uploadEvidence({
        uri: photo.uri,
        mimeType,
        fileSize,
        fileName,
        tripId: trip.id,
        stage: parsed.data.stage as TripStage,
        userId: user.id,
      });
      if (evidenceError || !evidence) {
        console.warn("[upload] Network evidence upload error, saving to outbox:", evidenceError);
        await queueOffline();
        return;
      }

      // 3. Create pending verification record
      const { error: verError } = await createPendingVerification({
        tripId: trip.id,
        evidenceId: evidence.id,
        expectedPlate: parsed.data.vehicle_number,
      });
      if (verError) {
        console.warn("[upload] verification queue error:", verError);
      }

      // 4. Navigate to processing
      router.push({
        pathname: "/(app)/processing",
        params: { tripId: trip.id },
      });
    } catch (err) {
      console.warn("[upload] Exception during online submit, falling back to outbox:", err);
      await queueOffline();
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Auth gate ────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.authGate}>
          <Text style={styles.authGateText}>You must be signed in to submit trip evidence.</Text>
          <TouchableOpacity
            style={styles.saffronBtn}
            onPress={() => router.replace("/(auth)/login")}
          >
            <Text style={styles.saffronBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <OutboxBanner />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.pageTitle}>Upload Photo for Verification</Text>

        {/* ── Trip Details Card ── */}
        <Card>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠ {error}</Text>
            </View>
          )}

          <Text style={styles.label}>Trip ID <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. TRIP-1042"
            placeholderTextColor={Colors.mutedForeground}
            value={tripCode}
            onChangeText={(t) => setTripCode(t.toUpperCase())}
            autoCapitalize="characters"
            editable={!submitting}
          />

          <Text style={styles.label}>Vehicle No. <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. GJ01AB1234"
            placeholderTextColor={Colors.mutedForeground}
            value={vehicleNumber}
            onChangeText={(t) => setVehicleNumber(t.toUpperCase())}
            autoCapitalize="characters"
            editable={!submitting}
          />

          <Text style={styles.label}>Trip Stage <Text style={styles.required}>*</Text></Text>
          <View style={styles.stageRow}>
            {STAGES.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[
                  styles.stagePill,
                  stage === s.value && styles.stagePillActive,
                ]}
                onPress={() => setStage(s.value)}
                disabled={submitting}
              >
                <Text
                  style={[
                    styles.stagePillText,
                    stage === s.value && styles.stagePillTextActive,
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* ── Photo Upload Card ── */}
        <Card title="Photograph">
          {photoError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠ {photoError}</Text>
            </View>
          )}

          {photo ? (
            <View>
              <Image
                source={{ uri: photo.uri }}
                style={styles.preview}
                resizeMode="cover"
              />
              <View style={styles.photoActionRow}>
                <TouchableOpacity
                  style={[styles.outlineBtn, { flex: 1 }]}
                  onPress={handleTakePhoto}
                  disabled={submitting}
                >
                  <Text style={styles.outlineBtnText}>📷 Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.outlineBtn, { flex: 1 }]}
                  onPress={handleChoosePhoto}
                  disabled={submitting}
                >
                  <Text style={styles.outlineBtnText}>🖼 Gallery</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.photoActionRow}>
              <TouchableOpacity
                style={[styles.cameraBtn, { flex: 1 }]}
                onPress={handleTakePhoto}
                disabled={submitting}
              >
                <Text style={styles.cameraBtnIcon}>📷</Text>
                <Text style={styles.cameraBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cameraBtn, { flex: 1 }]}
                onPress={handleChoosePhoto}
                disabled={submitting}
              >
                <Text style={styles.cameraBtnIcon}>🖼</Text>
                <Text style={styles.cameraBtnText}>From Gallery</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>⚠ Image Requirements</Text>
            {[
              "Image must be clear and in focus",
              "Vehicle number plate must be visible",
              "Photograph must be taken in daylight",
              "File size should not exceed 10 MB",
            ].map((req) => (
              <Text key={req} style={styles.infoItem}>• {req}</Text>
            ))}
          </View>
        </Card>

        {/* ── Actions ── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.maroonBtn, { flex: 1 }]}
            onPress={handleReset}
            disabled={submitting}
          >
            <Text style={styles.maroonBtnText}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saffronBtn, { flex: 1 }, submitting && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color={Colors.saffronForeground} />
              : <Text style={styles.saffronBtnText}>Submit</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3], paddingBottom: Spacing[6] },
  pageTitle: {
    fontSize: FontSizes.xl,
    fontWeight: "800",
    color: Colors.foreground,
  },
  label: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground, marginTop: Spacing[2] },
  required: { color: Colors.danger },
  input: {
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.input,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing[3],
    fontSize: FontSizes.sm,
    color: Colors.foreground,
    marginTop: 4,
  },
  stageRow: { flexDirection: "row", gap: Spacing[2], marginTop: Spacing[2] },
  stagePill: {
    flex: 1,
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    backgroundColor: Colors.card,
  },
  stagePillActive: { backgroundColor: Colors.saffron, borderColor: Colors.saffron },
  stagePillText: { fontSize: FontSizes.sm, color: Colors.mutedForeground, fontWeight: "600" },
  stagePillTextActive: { color: Colors.saffronForeground },
  preview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: Radius.lg,
    marginBottom: Spacing[2],
  },
  photoActionRow: { flexDirection: "row", gap: Spacing[2], marginTop: Spacing[2] },
  cameraBtn: {
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.info,
    borderStyle: "dashed",
    backgroundColor: Colors.infoSoft,
    paddingVertical: Spacing[5],
    alignItems: "center",
    gap: 4,
  },
  cameraBtnIcon: { fontSize: 28 },
  cameraBtnText: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.info },
  outlineBtn: {
    height: 44,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineBtnText: { fontSize: FontSizes.sm, color: Colors.foreground, fontWeight: "600" },
  infoBox: {
    marginTop: Spacing[3],
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.saffron,
    padding: Spacing[3],
    gap: 4,
  },
  infoTitle: { fontSize: FontSizes.sm, fontWeight: "700", color: Colors.warning, marginBottom: 4 },
  infoItem: { fontSize: FontSizes.sm, color: Colors.foreground },
  actionRow: { flexDirection: "row", gap: Spacing[3] },
  saffronBtn: {
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.saffron,
    alignItems: "center", justifyContent: "center",
  },
  saffronBtnText: { color: Colors.saffronForeground, fontWeight: "700", fontSize: FontSizes.base },
  maroonBtn: {
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.maroon,
    alignItems: "center", justifyContent: "center",
  },
  maroonBtnText: { color: Colors.maroonForeground, fontWeight: "700", fontSize: FontSizes.base },
  btnDisabled: { opacity: 0.6 },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1,
    borderColor: Colors.danger, borderRadius: Radius.md, padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  authGate: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: Spacing[6], gap: Spacing[4],
  },
  authGateText: {
    fontSize: FontSizes.base, color: Colors.mutedForeground,
    textAlign: "center",
  },
});
