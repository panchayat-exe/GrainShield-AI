/**
 * Driver Checkpoint Evidence Upload Screen — React Native.
 *
 * Implements Approved Option A:
 * - Drivers do NOT create new citizen trips.
 * - Drivers operate exclusively on authorized trips assigned to them.
 * - Captures checkpoint evidence (CP1-CP4) for the selected assigned trip.
 * - If offline, queues the evidence in the offline outbox referencing the trip ID.
 * - When online, uploads directly to Supabase Storage and triggers verification.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { OutboxBanner } from "@/components/OutboxBanner";
import { Card } from "@/components/Card";
import { useAuth } from "@/hooks/use-auth";
import { listMyTrips, getTripByCode } from "@/lib/services/trips";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import { saveEvidenceToOutbox } from "@/lib/offline/outbox";
import { validatePhotoAsset } from "@/lib/validation";
import type { Trip, TripStage } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

type PhotoAsset = ImagePicker.ImagePickerAsset;

const CACHED_TRIPS_KEY = "@grainshield_assigned_trips";

export default function DriverUploadScreen() {
  const router = useRouter();
  const { user, isOffline } = useAuth();

  const [assignedTrips, setAssignedTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [manualTripCode, setManualTripCode] = useState("");
  const [searchingTrip, setSearchingTrip] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<number>(1);
  const [photo, setPhoto] = useState<PhotoAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // ── 1. Load assigned trips (with local offline cache) ─────────────────────
  useEffect(() => {
    async function fetchTrips() {
      setLoadingTrips(true);
      try {
        if (!isOffline) {
          const fresh = await listMyTrips();
          if (fresh.length > 0) {
            setAssignedTrips(fresh);
            setSelectedTrip(fresh[0]);
            await AsyncStorage.setItem(CACHED_TRIPS_KEY, JSON.stringify(fresh));
            setLoadingTrips(false);
            return;
          }
        }
        // Fallback to cached trips for field operations
        const cached = await AsyncStorage.getItem(CACHED_TRIPS_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as Trip[];
          setAssignedTrips(parsed);
          if (parsed.length > 0) setSelectedTrip(parsed[0]);
        }
      } catch (err) {
        console.warn("[driver-upload] Error loading trips:", err);
      } finally {
        setLoadingTrips(false);
      }
    }

    if (user) {
      void fetchTrips();
    }
  }, [user, isOffline]);

  // Adjust default checkpoint based on trip stage
  useEffect(() => {
    if (selectedTrip) {
      if (selectedTrip.stage === "last_mile") {
        setSelectedCheckpoint(3);
      } else {
        setSelectedCheckpoint(1);
      }
    }
  }, [selectedTrip]);

  // ── Search trip manually by code ─────────────────────────────────────────
  async function handleSearchTripCode() {
    if (!manualTripCode.trim()) return;
    setSearchingTrip(true);
    setError(null);
    try {
      const found = await getTripByCode(manualTripCode.trim());
      if (found) {
        setSelectedTrip(found);
        setManualTripCode("");
      } else {
        setError(
          `Trip ${manualTripCode.trim().toUpperCase()} not found or not assigned.`,
        );
      }
    } catch {
      setError("Failed to look up trip. Check connectivity.");
    } finally {
      setSearchingTrip(false);
    }
  }

  // ── Photo selection ──────────────────────────────────────────────────────
  async function requestCameraPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Camera Permission Required",
        "Please allow camera access in Settings to capture checkpoint photographs.",
        [{ text: "OK" }],
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
        "Permission Required",
        "Please allow photo library access in Settings.",
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
    setPhoto(null);
    setError(null);
    setPhotoError(null);
  }

  // ── Submit Checkpoint Evidence ───────────────────────────────────────────
  async function handleSubmit() {
    setError(null);
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }

    if (!selectedTrip) {
      setError("Please select or search for an assigned transport trip.");
      return;
    }

    if (!photo) {
      setError(
        "Please capture or select a checkpoint photograph before submitting.",
      );
      return;
    }

    setSubmitting(true);

    const fileName =
      photo.fileName ?? `cp${selectedCheckpoint}_${Date.now()}.jpg`;
    const mimeType = photo.mimeType ?? "image/jpeg";
    const fileSize = photo.fileSize ?? 0;

    // Offline queuing fallback
    const queueOffline = async () => {
      const { item, error: outboxError } = await saveEvidenceToOutbox({
        tripId: selectedTrip.id,
        tripCode: selectedTrip.trip_code,
        vehicleNumber: selectedTrip.vehicle_number,
        stage: selectedTrip.stage as TripStage,
        checkpointNumber: selectedCheckpoint,
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
        `Checkpoint ${selectedCheckpoint} evidence for trip ${selectedTrip.trip_code} is stored locally. It will upload automatically when online.`,
        [
          {
            text: "View Status",
            onPress: () => {
              router.push({
                pathname: "/(app)/trip",
                params: { tripId: selectedTrip.id },
              });
            },
          },
          { text: "Done" },
        ],
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
      // 1. Upload evidence directly to existing assigned trip
      const { evidence, error: uploadErr } = await uploadEvidence({
        uri: photo.uri,
        mimeType,
        fileSize,
        fileName,
        tripId: selectedTrip.id,
        stage: selectedTrip.stage as TripStage,
        userId: user.id,
      });

      if (uploadErr || !evidence) {
        console.warn(
          "[upload] Direct upload failed, falling back to outbox:",
          uploadErr,
        );
        await queueOffline();
        return;
      }

      // 2. Queue AI Verification
      const { error: verError } = await createPendingVerification({
        tripId: selectedTrip.id,
        evidenceId: evidence.id,
        expectedPlate: selectedTrip.vehicle_number,
      });

      if (verError) {
        console.warn("[upload] Verification queue notice:", verError);
      }

      handleReset();
      Alert.alert(
        "✅ Evidence Uploaded",
        `Checkpoint ${selectedCheckpoint} evidence submitted for Trip ${selectedTrip.trip_code}. AI verification initiated.`,
        [
          {
            text: "View Trip",
            onPress: () => {
              router.push({
                pathname: "/(app)/trip",
                params: { tripId: selectedTrip.id },
              });
            },
          },
        ],
      );
    } catch (err) {
      console.warn("[upload] Exception during upload, queuing offline:", err);
      await queueOffline();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.authGate}>
          <Text style={styles.authGateText}>
            You must be signed in as an assigned driver.
          </Text>
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

  const checkpointsForStage =
    selectedTrip?.stage === "last_mile"
      ? [
          { number: 3, label: "CP3 — Godown Departure" },
          { number: 4, label: "CP4 — Fair Price Shop Delivery" },
        ]
      : [
          { number: 1, label: "CP1 — Mandi/Warehouse Departure" },
          { number: 2, label: "CP2 — Godown Arrival" },
        ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <OutboxBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.pageTitle}>Checkpoint Evidence</Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {error}</Text>
          </View>
        )}

        {/* ── Assigned Trip Selection Card ── */}
        <Card title="Assigned Transport Trip">
          {loadingTrips ? (
            <ActivityIndicator
              color={Colors.saffron}
              style={{ marginVertical: Spacing[2] }}
            />
          ) : assignedTrips.length > 0 ? (
            <View style={{ gap: Spacing[2] }}>
              <Text style={styles.label}>Select Assigned Trip:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tripChipRow}
              >
                {assignedTrips.map((t) => {
                  const isSelected = selectedTrip?.id === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.tripChip,
                        isSelected && styles.tripChipActive,
                      ]}
                      onPress={() => setSelectedTrip(t)}
                    >
                      <Text
                        style={[
                          styles.tripChipCode,
                          isSelected && styles.tripChipTextActive,
                        ]}
                      >
                        {t.trip_code}
                      </Text>
                      <Text
                        style={[
                          styles.tripChipSub,
                          isSelected && styles.tripChipTextActive,
                        ]}
                      >
                        {t.vehicle_number}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <Text style={styles.noTripsText}>
              No dispatched trips currently assigned to your account.
            </Text>
          )}

          {/* Manual trip search if trip isn't listed */}
          <View style={styles.manualSearchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Or enter Trip Code (e.g. GS-2026-100001)"
              placeholderTextColor={Colors.mutedForeground}
              value={manualTripCode}
              onChangeText={setManualTripCode}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={handleSearchTripCode}
              disabled={searchingTrip}
            >
              {searchingTrip ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.searchBtnText}>Find</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Selected Trip Info Summary */}
          {selectedTrip && (
            <View style={styles.tripSummaryBox}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Active Trip:</Text>
                <Text style={styles.summaryCode}>{selectedTrip.trip_code}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Vehicle:</Text>
                <Text style={styles.summaryVal}>
                  {selectedTrip.vehicle_number}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Stage:</Text>
                <Text style={styles.summaryVal}>
                  {selectedTrip.stage === "first_mile"
                    ? "First Mile (Mandi → Godown)"
                    : selectedTrip.stage === "last_mile"
                      ? "Last Mile (Godown → FPS)"
                      : selectedTrip.stage}
                </Text>
              </View>
              {selectedTrip.origin && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Route:</Text>
                  <Text style={styles.summaryVal}>
                    {selectedTrip.origin} → {selectedTrip.destination ?? "—"}
                  </Text>
                </View>
              )}
            </View>
          )}
        </Card>

        {/* ── Checkpoint Selection Card ── */}
        {selectedTrip && (
          <Card title="Select Checkpoint">
            <View style={{ gap: Spacing[2] }}>
              {checkpointsForStage.map((cp) => {
                const active = selectedCheckpoint === cp.number;
                return (
                  <TouchableOpacity
                    key={cp.number}
                    style={[styles.cpPill, active && styles.cpPillActive]}
                    onPress={() => setSelectedCheckpoint(cp.number)}
                  >
                    <Text
                      style={[styles.cpNumber, active && styles.cpTextActive]}
                    >
                      CP{cp.number}
                    </Text>
                    <Text
                      style={[styles.cpLabel, active && styles.cpTextActive]}
                    >
                      {cp.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>
        )}

        {/* ── Checkpoint Photograph Upload Card ── */}
        <Card title="Evidence Photograph">
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
            <Text style={styles.infoTitle}>Field Evidence Standards</Text>
            <Text style={styles.infoItem}>
              • Photograph license plate clearly with vehicle body
            </Text>
            <Text style={styles.infoItem}>
              • Ensure adequate lighting at checkpoint location
            </Text>
            <Text style={styles.infoItem}>
              • Works offline: will buffer locally if out of reception
            </Text>
          </View>
        </Card>

        {/* ── Actions ── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.maroonBtn, { flex: 1 }]}
            onPress={handleReset}
            disabled={submitting}
          >
            <Text style={styles.maroonBtnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saffronBtn,
              { flex: 1 },
              (!selectedTrip || !photo || submitting) && styles.btnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedTrip || !photo || submitting}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.saffronForeground} />
            ) : (
              <Text style={styles.saffronBtnText}>
                {isOffline ? "Save to Outbox" : "Submit Evidence"}
              </Text>
            )}
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
  label: {
    fontSize: FontSizes.xs,
    fontWeight: "600",
    color: Colors.mutedForeground,
  },
  tripChipRow: { flexDirection: "row", marginVertical: 4 },
  tripChip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    marginRight: Spacing[2],
    minWidth: 120,
  },
  tripChipActive: {
    borderColor: Colors.saffron,
    backgroundColor: Colors.saffron,
  },
  tripChipCode: {
    fontSize: FontSizes.sm,
    fontWeight: "700",
    color: Colors.foreground,
  },
  tripChipSub: { fontSize: FontSizes.xs, color: Colors.mutedForeground },
  tripChipTextActive: { color: Colors.saffronForeground },
  noTripsText: {
    fontSize: FontSizes.xs,
    color: Colors.mutedForeground,
    fontStyle: "italic",
  },
  manualSearchRow: {
    flexDirection: "row",
    gap: Spacing[2],
    marginTop: Spacing[2],
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.input,
    paddingHorizontal: Spacing[3],
    fontSize: FontSizes.xs,
    color: Colors.foreground,
    backgroundColor: Colors.background,
  },
  searchBtn: {
    backgroundColor: Colors.info,
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: FontSizes.xs },
  tripSummaryBox: {
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: FontSizes.xs, color: Colors.mutedForeground },
  summaryCode: {
    fontSize: FontSizes.xs,
    fontWeight: "800",
    color: Colors.saffron,
  },
  summaryVal: {
    fontSize: FontSizes.xs,
    fontWeight: "600",
    color: Colors.foreground,
  },
  cpPill: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    gap: Spacing[3],
  },
  cpPillActive: {
    borderColor: Colors.saffron,
    backgroundColor: Colors.warningSoft,
  },
  cpNumber: {
    fontSize: FontSizes.sm,
    fontWeight: "800",
    color: Colors.foreground,
    backgroundColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cpLabel: { fontSize: FontSizes.sm, color: Colors.foreground, flex: 1 },
  cpTextActive: { color: Colors.foreground, fontWeight: "700" },
  preview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: Radius.lg,
    marginBottom: Spacing[2],
  },
  photoActionRow: {
    flexDirection: "row",
    gap: Spacing[2],
    marginTop: Spacing[2],
  },
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
  cameraBtnText: {
    fontSize: FontSizes.sm,
    fontWeight: "600",
    color: Colors.info,
  },
  outlineBtn: {
    height: 44,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineBtnText: {
    fontSize: FontSizes.sm,
    color: Colors.foreground,
    fontWeight: "600",
  },
  infoBox: {
    marginTop: Spacing[3],
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.saffron,
    padding: Spacing[3],
    gap: 4,
  },
  infoTitle: {
    fontSize: FontSizes.xs,
    fontWeight: "700",
    color: Colors.warning,
    marginBottom: 2,
  },
  infoItem: { fontSize: FontSizes.xs, color: Colors.foreground },
  actionRow: { flexDirection: "row", gap: Spacing[3] },
  saffronBtn: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.saffron,
    alignItems: "center",
    justifyContent: "center",
  },
  saffronBtnText: {
    color: Colors.saffronForeground,
    fontWeight: "700",
    fontSize: FontSizes.base,
  },
  maroonBtn: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.maroon,
    alignItems: "center",
    justifyContent: "center",
  },
  maroonBtnText: {
    color: Colors.maroonForeground,
    fontWeight: "700",
    fontSize: FontSizes.base,
  },
  btnDisabled: { opacity: 0.6 },
  errorBox: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: Radius.md,
    padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  authGate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing[6],
    gap: Spacing[4],
  },
  authGateText: {
    fontSize: FontSizes.base,
    color: Colors.mutedForeground,
    textAlign: "center",
  },
});
