/**
 * Processing screen — live AI verification status.
 * Uses Supabase Realtime to auto-update; navigates on completion.
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/Card";
import { useAuth } from "@/hooks/use-auth";
import { getLatestVerification, subscribeToTripVerifications } from "@/lib/services/verification";
import { getTripById } from "@/lib/services/trips";
import type { VerificationResult } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

const STEPS = ["Image Quality", "Vehicle Detection", "Plate OCR", "Evidence Checks", "Final Decision"];

const STATUS_STEP: Record<string, number> = {
  pending: 0, processing: 2, pass: 5, retake: 5, manual_review: 5, error: 5,
};

export default function ProcessingScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const { user } = useAuth();

  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [tripCode, setTripCode] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tripId) { setLoadingInitial(false); setNotFound(true); return; }
    void (async () => {
      const [trip, result] = await Promise.all([
        getTripById(tripId),
        getLatestVerification(tripId),
      ]);
      if (!trip) { setNotFound(true); }
      else { setTripCode(trip.trip_code); }
      setVerification(result);
      setLoadingInitial(false);
    })();
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    const unsub = subscribeToTripVerifications(tripId, (updated) => {
      setVerification(updated);
    });
    return unsub;
  }, [tripId]);

  // Navigate when done
  useEffect(() => {
    if (!verification) return;
    if (verification.status === "pass") {
      setTimeout(() => {
        router.push({ pathname: "/(app)/result", params: { tripId: tripId ?? "" } });
      }, 1200);
    } else if (
      verification.status === "retake" ||
      verification.status === "manual_review" ||
      verification.status === "error"
    ) {
      setTimeout(() => {
        router.push({ pathname: "/(app)/failed", params: { tripId: tripId ?? "" } });
      }, 1200);
    }
  }, [verification, tripId, router]);

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
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.info} /></View>
      </SafeAreaView>
    );
  }

  if (notFound || !tripId) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Trip not found or you don't have access.</Text>
            <TouchableOpacity onPress={() => router.push("/(app)")}>
              <Text style={styles.link}>Upload a new photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const status = verification?.status ?? "pending";
  const activeStep = STATUS_STEP[status] ?? 0;
  const isDone = ["pass", "retake", "manual_review", "error"].includes(status);
  const progressPct = isDone ? 100 : Math.min(90, activeStep * 20 + 5);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>AI Verification in Progress</Text>
        <Text style={styles.subtitle}>Analyzing your image. Please do not close this screen.</Text>

        {tripCode && (
          <Text style={styles.tripRef}>Trip: <Text style={styles.tripCode}>{tripCode}</Text></Text>
        )}

        <Card>
          {STEPS.map((s, i) => {
            const stepStatus = isDone || i < activeStep ? "done" : i === activeStep ? "run" : "wait";
            return (
              <View
                key={s}
                style={[styles.stepRow, stepStatus === "run" && styles.stepRowActive]}
              >
                <Text style={styles.stepIcon}>
                  {stepStatus === "done" ? "✅" : stepStatus === "run" ? "⏳" : "⭕"}
                </Text>
                <Text style={styles.stepLabel}>{s}</Text>
                <Text style={[
                  styles.stepStatus,
                  stepStatus === "done" && { color: Colors.success },
                  stepStatus === "run" && { color: Colors.info },
                  stepStatus === "wait" && { color: Colors.warning },
                ]}>
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
              ? status === "pass" ? "Verification Passed ✓" : "Verification Complete"
              : (STEPS[activeStep] ?? "Queued")}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` as `${number}%` }]} />
          </View>
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </Card>

        {!isDone && status === "pending" && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⚠ Verification is queued. Results will update automatically once the AI processor runs.
            </Text>
          </View>
        )}

        {isDone && (
          <View style={styles.doneRow}>
            <TouchableOpacity
              style={status === "pass" ? styles.successBtn : styles.dangerBtn}
              onPress={() => router.push({
                pathname: status === "pass" ? "/(app)/result" : "/(app)/failed",
                params: { tripId },
              })}
            >
              <Text style={styles.btnText}>View Result</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => router.push({ pathname: "/(app)/trip", params: { tripId } })}
            >
              <Text style={styles.outlineBtnText}>Trip Details</Text>
            </TouchableOpacity>
          </View>
        )}

        {!isDone && (
          <Text style={styles.waitText}>⏱ Waiting for AI processor. This updates automatically.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3], paddingBottom: Spacing[6] },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: FontSizes.xl, fontWeight: "800", color: Colors.foreground },
  subtitle: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  tripRef: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  tripCode: { fontWeight: "700", color: Colors.foreground },
  stepRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2], borderRadius: Radius.md, gap: Spacing[2],
  },
  stepRowActive: { backgroundColor: Colors.infoSoft },
  stepIcon: { fontSize: 18 },
  stepLabel: { flex: 1, fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
  stepStatus: { fontSize: FontSizes.xs, fontWeight: "600" },
  progressLabel: { fontSize: FontSizes.sm, fontWeight: "700", color: Colors.info, marginBottom: Spacing[2] },
  progressTrack: {
    height: 10, borderRadius: 999, backgroundColor: Colors.infoSoft,
    overflow: "hidden", marginBottom: 4,
  },
  progressFill: { height: "100%", backgroundColor: Colors.info, borderRadius: 999 },
  progressPct: { fontSize: FontSizes.xs, color: Colors.mutedForeground, textAlign: "right" },
  warningBox: {
    backgroundColor: Colors.warningSoft, borderWidth: 1, borderColor: Colors.saffron,
    borderRadius: Radius.lg, padding: Spacing[3],
  },
  warningText: { fontSize: FontSizes.sm, color: Colors.warning },
  doneRow: { flexDirection: "row", gap: Spacing[3] },
  successBtn: {
    flex: 1, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.success,
    alignItems: "center", justifyContent: "center",
  },
  dangerBtn: {
    flex: 1, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtn: {
    flex: 1, height: 48, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnText: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
  btnText: { color: "#fff", fontWeight: "700", fontSize: FontSizes.sm },
  waitText: { fontSize: FontSizes.sm, color: Colors.mutedForeground, textAlign: "center" },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1, borderColor: Colors.danger,
    borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[2],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  link: { color: Colors.info, fontSize: FontSizes.sm, textDecorationLine: "underline" },
  muted: { color: Colors.mutedForeground, fontSize: FontSizes.sm },
});
