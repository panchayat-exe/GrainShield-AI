/**
 * Processing screen — live AI verification status with Offline Outbox support.
 * Uses active polling fallback + Supabase Realtime to auto-update when online,
 * or renders the local outbox status when offline with one-tap sync.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { OutboxBanner } from "@/components/OutboxBanner";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { useAuth } from "@/hooks/use-auth";
import { getLatestVerification, subscribeToTripVerifications } from "@/lib/services/verification";
import { getTripById } from "@/lib/services/trips";
import { getOutboxItems, syncOutboxItem, type OutboxItem } from "@/lib/offline/outbox";
import type { VerificationResult } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

const STEPS = ["Image Quality", "Vehicle Detection", "Plate OCR", "Evidence Checks", "Final Decision"];

const STATUS_STEP: Record<string, number> = {
  pending: 0,
  processing: 2,
  pass: 5,
  retake: 5,
  manual_review: 5,
  error: 5,
};

export default function ProcessingScreen() {
  const router = useRouter();
  const { tripId, outboxId } = useLocalSearchParams<{ tripId?: string; outboxId?: string }>();
  const { user } = useAuth();

  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [tripCode, setTripCode] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [outboxItem, setOutboxItem] = useState<OutboxItem | null>(null);
  const [syncingOutbox, setSyncingOutbox] = useState(false);
  const hasNavigated = useRef(false);

  // Load online trip or outbox item
  const loadData = useCallback(async (isManualRefresh = false) => {
    if (!isManualRefresh) setLoadingInitial(true);

    try {
      // 1. If outboxId passed, load from local Outbox
      if (outboxId) {
        const items = await getOutboxItems();
        const match = items.find((i) => i.id === outboxId);
        if (match) {
          setOutboxItem(match);
          setTripCode(match.tripCode);
          setNotFound(false);
          return;
        }
      }

      // 2. If online tripId passed, load from Supabase
      if (tripId) {
        const [trip, result] = await Promise.all([
          getTripById(tripId),
          getLatestVerification(tripId),
        ]);
        if (!trip) {
          setNotFound(true);
        } else {
          setTripCode(trip.trip_code);
          setNotFound(false);
        }
        setVerification(result);
        return;
      }

      // 3. Fallback: check if any outbox items exist
      const items = await getOutboxItems();
      if (items.length > 0) {
        setOutboxItem(items[0]);
        setTripCode(items[0].tripCode);
        setNotFound(false);
        return;
      }

      setNotFound(true);
    } finally {
      setLoadingInitial(false);
      setRefreshing(false);
    }
  }, [tripId, outboxId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData(true);
  }, [loadData]);

  // Realtime subscription for online verification
  useEffect(() => {
    if (!tripId) return;
    const unsub = subscribeToTripVerifications(tripId, (updated) => {
      setVerification(updated);
    });
    return unsub;
  }, [tripId]);

  // Active polling fallback: every 2 seconds check Supabase while status is pending or processing
  useEffect(() => {
    if (!tripId) return;
    if (verification && ["pass", "retake", "manual_review", "error"].includes(verification.status)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const latest = await getLatestVerification(tripId);
        if (latest) {
          setVerification(latest);
        }
      } catch {
        // Network blips during polling are ignored
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [tripId, verification?.status]);

  // Navigate when online verification completes
  useEffect(() => {
    if (!verification || hasNavigated.current) return;
    if (verification.status === "pass") {
      hasNavigated.current = true;
      const t = setTimeout(() => {
        router.push({ pathname: "/(app)/result", params: { tripId: tripId ?? "" } });
      }, 1000);
      return () => clearTimeout(t);
    } else if (
      verification.status === "retake" ||
      verification.status === "manual_review" ||
      verification.status === "error"
    ) {
      hasNavigated.current = true;
      const t = setTimeout(() => {
        router.push({ pathname: "/(app)/failed", params: { tripId: tripId ?? "" } });
      }, 1000);
      return () => clearTimeout(t);
    }
  }, [verification, tripId, router]);

  async function handleSyncOutbox() {
    if (!outboxItem || !user) return;
    setSyncingOutbox(true);
    try {
      const res = await syncOutboxItem(outboxItem, user.id);
      if (res.success && res.tripId) {
        Alert.alert("Success", "Evidence uploaded to Supabase cloud! Initiating AI verification.");
        router.replace({ pathname: "/(app)/processing", params: { tripId: res.tripId } });
      } else {
        Alert.alert("Sync Error", res.error ?? "Failed to connect to Supabase. Please verify your connection.");
      }
    } finally {
      setSyncingOutbox(false);
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.center}>
          <Text style={styles.muted}>Please sign in to view verification status.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadingInitial) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.info} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── OFFLINE OUTBOX ITEM VIEW ──────────────────────────────────────────────
  if (outboxItem) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <AppHeader />
        <OutboxBanner />
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <Text style={styles.pageTitle}>Stored in Offline Outbox</Text>
          <Text style={styles.subtitle}>
            This evidence is stored locally on this phone. Connect to the internet to submit for AI verification.
          </Text>

          <Card>
            <Row label="Trip ID" value={outboxItem.tripCode} />
            <Row label="Vehicle No." value={outboxItem.vehicleNumber} />
            <Row label="Trip Stage" value={outboxItem.stage.replace("_", " ").toUpperCase()} />
            <Row label="Captured" value={new Date(outboxItem.createdAt).toLocaleTimeString()} />
            <Row label="Status" value="Stored Offline (Ready to Sync)" tone="warning" />
          </Card>

          {outboxItem.photoUri && (
            <Card title="Captured Evidence">
              <Image source={{ uri: outboxItem.photoUri }} style={styles.photoPreview} resizeMode="cover" />
            </Card>
          )}

          <TouchableOpacity
            style={[styles.syncButton, syncingOutbox && styles.buttonDisabled]}
            onPress={handleSyncOutbox}
            disabled={syncingOutbox}
          >
            {syncingOutbox ? (
              <ActivityIndicator color={Colors.saffronForeground} />
            ) : (
              <Text style={styles.syncButtonText}>Sync to Cloud & Verify</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── NOT FOUND VIEW ────────────────────────────────────────────────────────
  if (notFound || !tripId) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <OutboxBanner />
        <View style={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>No active verification found.</Text>
            <TouchableOpacity onPress={() => router.push("/(app)")}>
              <Text style={styles.link}>Upload a new photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── ONLINE VERIFICATION VIEW ──────────────────────────────────────────────
  const status = verification?.status ?? "pending";
  const activeStep = STATUS_STEP[status] ?? 0;
  const isDone = ["pass", "retake", "manual_review", "error"].includes(status);
  const progressPct = isDone ? 100 : Math.min(90, activeStep * 20 + 5);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <OutboxBanner />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={styles.pageTitle}>AI Verification in Progress</Text>
        <Text style={styles.subtitle}>Analyzing your image. Results will update automatically.</Text>

        {tripCode && (
          <Text style={styles.tripRef}>
            Trip: <Text style={styles.tripCode}>{tripCode}</Text>
          </Text>
        )}

        <Card>
          {STEPS.map((s, i) => {
            const stepStatus = isDone || i < activeStep ? "done" : i === activeStep ? "run" : "wait";
            return (
              <View key={s} style={[styles.stepRow, stepStatus === "run" && styles.stepRowActive]}>
                <Text style={styles.stepIcon}>
                  {stepStatus === "done" ? "✅" : stepStatus === "run" ? "⏳" : "⭕"}
                </Text>
                <Text style={styles.stepLabel}>{s}</Text>
                <Text
                  style={[
                    styles.stepStatus,
                    stepStatus === "done" && { color: Colors.success },
                    stepStatus === "run" && { color: Colors.info },
                    stepStatus === "wait" && { color: Colors.warning },
                  ]}
                >
                  {stepStatus === "done" ? "Done" : stepStatus === "run" ? "Running…" : "Pending"}
                </Text>
              </View>
            );
          })}
        </Card>

        {/* Progress bar */}
        <Card style={{ backgroundColor: Colors.infoSoft, borderColor: Colors.info }}>
          <Text style={styles.progressLabel}>
            {isDone
              ? status === "pass"
                ? "Verification Passed ✓"
                : "Verification Complete — Redirecting..."
              : STEPS[activeStep] ?? "Queued"}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` as `${number}%` }]} />
          </View>
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </Card>

        {/* Refresh button */}
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={Colors.info} />
          ) : (
            <Text style={styles.refreshButtonText}>🔄 Refresh Status</Text>
          )}
        </TouchableOpacity>

        {!isDone && status === "pending" && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⏳ Verification is queued. The AI processor checks every few seconds.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing[4] },
  muted: { color: Colors.mutedForeground, fontSize: FontSizes.sm, textAlign: "center" },
  pageTitle: { fontSize: FontSizes.xl, fontWeight: "800", color: Colors.foreground },
  subtitle: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  tripRef: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  tripCode: { fontWeight: "700", color: Colors.foreground },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepRowActive: { backgroundColor: Colors.infoSoft, borderRadius: Radius.sm, paddingHorizontal: Spacing[2] },
  stepIcon: { fontSize: 16, width: 28 },
  stepLabel: { flex: 1, fontSize: FontSizes.sm, color: Colors.foreground, fontWeight: "500" },
  stepStatus: { fontSize: FontSizes.xs, fontWeight: "600" },
  progressLabel: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.info, marginBottom: Spacing[2] },
  progressTrack: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: Colors.info, borderRadius: 4 },
  progressPct: { fontSize: FontSizes.xs, color: Colors.mutedForeground, marginTop: 4, textAlign: "right" },
  warningBox: {
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.md,
    padding: Spacing[3],
  },
  warningText: { color: Colors.warning, fontSize: FontSizes.sm },
  errorBox: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: Radius.md,
    padding: Spacing[4],
    gap: Spacing[2],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  link: { color: Colors.info, fontWeight: "600", fontSize: FontSizes.sm },
  photoPreview: { width: "100%", height: 200, borderRadius: Radius.md, marginTop: Spacing[2] },
  syncButton: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.saffron,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing[2],
  },
  buttonDisabled: { opacity: 0.6 },
  syncButtonText: {
    color: Colors.saffronForeground,
    fontWeight: "700",
    fontSize: FontSizes.base,
  },
  refreshButton: {
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshButtonText: {
    color: Colors.foreground,
    fontWeight: "600",
    fontSize: FontSizes.sm,
  },
});
