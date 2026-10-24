/**
 * Failed screen — verification failed/retake/manual_review result.
 * Allows manual review request and retake navigation.
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { OutboxBanner } from "@/components/OutboxBanner";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getLatestVerification } from "@/lib/services/verification";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { submitManualReview } from "@/lib/services/reviews";
import { formatTimestamp } from "@/lib/services/audit";
import type { Trip, VerificationResult, TripEvidence } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

function stageName(s: string) {
  return s === "first_mile" ? "First Mile" : s === "last_mile" ? "Last Mile" : s === "mid_mile" ? "Mid Mile" : s;
}

export default function FailedScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notAuthorized, setNotAuthorized] = useState(false);

  useEffect(() => {
    if (!tripId || !user) { setLoading(false); return; }
    void (async () => {
      const [t, v, evArr] = await Promise.all([
        getTripById(tripId),
        getLatestVerification(tripId),
        getEvidenceForTrip(tripId),
      ]);
      if (!t) { setNotAuthorized(true); setLoading(false); return; }
      setTrip(t);
      setVerification(v);
      const ev = evArr[0] ?? null;
      setEvidence(ev);
      if (ev?.storage_path) {
        const url = await getSignedUrl(ev.storage_path);
        setPhotoUrl(url);
      }
      setLoading(false);
    })();
  }, [tripId, user]);

  async function handleManualReview() {
    if (!trip || !evidence || !user) return;
    setReviewLoading(true);
    setReviewMessage(null);
    const { error } = await submitManualReview({
      tripId: trip.id,
      evidenceId: evidence.id,
      requestedBy: user.id,
      notes: "Requested via Failed Verification screen",
    });
    setReviewLoading(false);
    if (error) {
      setReviewMessage({ ok: false, text: error });
    } else {
      setReviewMessage({
        ok: true,
        text: "Manual review request submitted. An officer will review your submission.",
      });
    }
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.center}><Text style={styles.muted}>Please sign in.</Text></View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.info} /></View>
      </SafeAreaView>
    );
  }

  if (notAuthorized || !trip) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Trip not found or access denied.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!verification || verification.status === "pending" || verification.status === "processing") {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.content}>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>Verification is still in progress.</Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/(app)/processing", params: { tripId: tripId ?? "" } })}
            >
              <Text style={styles.link}>Check processing status</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Build failure reasons from real verification data
  const failureReasons: Array<{ label: string; value: string; tone?: "success" | "danger" | "warning" }> = [];
  if (verification.image_quality && verification.image_quality !== "clear") {
    failureReasons.push({ label: "Image Quality", value: verification.image_quality, tone: "danger" });
  }
  if (verification.vehicle_detected === false) {
    failureReasons.push({ label: "Vehicle Detection", value: "Not detected", tone: "danger" });
  }
  if (verification.plate_match === false) {
    failureReasons.push({ label: "Number Plate", value: "Not readable / Mismatch", tone: "danger" });
  }
  if (verification.detected_plate) {
    failureReasons.push({ label: "Detected Plate", value: verification.detected_plate });
  }
  if (verification.expected_plate) {
    failureReasons.push({ label: "Expected Plate", value: verification.expected_plate });
  }
  if (failureReasons.length === 0) {
    failureReasons.push({
      label: "Reason",
      value: verification.explanation ?? "Verification could not be completed",
      tone: "danger",
    });
  }

  const isManualReview = verification.status === "manual_review";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <OutboxBanner />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Fail Banner */}
        <View style={styles.failBanner}>
          <Text style={styles.failIcon}>❌</Text>
          <View>
            <Text style={styles.failLabel}>
              {isManualReview ? "MANUAL REVIEW" : "FAILED"}
            </Text>
            <Text style={styles.failSubtitle}>
              {isManualReview ? "Sent for manual review" : "Photo could not be verified"}
            </Text>
          </View>
        </View>

        {photoUrl && (
          <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
        )}

        <Card title="Failure Reasons">
          {failureReasons.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} tone={r.tone} />
          ))}
          <Row label="Trip Stage" value={stageName(evidence?.stage ?? trip.stage)} />
        </Card>

        {/* How to Fix */}
        <View style={styles.howToBox}>
          <Text style={styles.howToTitle}>💡 How to fix</Text>
          {[
            "Take the photo in daylight",
            "Hold the phone steady, vehicle stationary",
            "Keep the number plate fully in frame",
          ].map((tip) => (
            <Text key={tip} style={styles.howToItem}>• {tip}</Text>
          ))}
        </View>

        <Card title="Summary">
          <Row label="Trip ID" value={trip.trip_code} />
          <Row
            label="Activity Time"
            value={verification.processing_completed_at
              ? formatTimestamp(verification.processing_completed_at)
              : formatTimestamp(verification.created_at)}
          />
          <Row label="Processed By" value={verification.processor_version ?? "AI System"} />
        </Card>

        {reviewMessage && (
          <View style={[styles.reviewMsgBox, reviewMessage.ok ? styles.successBorder : styles.errorBorder]}>
            <Text style={[styles.reviewMsgText, { color: reviewMessage.ok ? Colors.success : Colors.danger }]}>
              {reviewMessage.ok ? "✅" : "⚠"} {reviewMessage.text}
            </Text>
          </View>
        )}

        {/* Actions */}
        <TouchableOpacity
          style={styles.saffronBtn}
          onPress={() => router.push("/(app)")}
        >
          <Text style={styles.saffronBtnText}>🔄 Retake Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.maroonBtn, (reviewLoading || reviewMessage?.ok) && styles.btnDisabled]}
          onPress={handleManualReview}
          disabled={reviewLoading || reviewMessage?.ok === true}
        >
          {reviewLoading
            ? <ActivityIndicator color={Colors.maroonForeground} />
            : <Text style={styles.maroonBtnText}>👤 Send for Manual Review</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.outlineBtn}
          onPress={() => router.push({ pathname: "/(app)/trip", params: { tripId: tripId ?? "" } })}
        >
          <Text style={styles.outlineBtnText}>← Back to Trip Report</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3], paddingBottom: Spacing[6] },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  failBanner: {
    flexDirection: "row", alignItems: "center", gap: Spacing[4],
    backgroundColor: Colors.dangerSoft, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.danger, padding: Spacing[4],
  },
  failIcon: { fontSize: 40 },
  failLabel: { fontSize: FontSizes["3xl"], fontWeight: "900", color: Colors.danger },
  failSubtitle: { fontSize: FontSizes.sm, color: Colors.danger },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: Radius.xl },
  howToBox: {
    backgroundColor: Colors.warningSoft, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.saffron, padding: Spacing[4], gap: 4,
  },
  howToTitle: { fontSize: FontSizes.sm, fontWeight: "700", color: Colors.warning, marginBottom: 4 },
  howToItem: { fontSize: FontSizes.sm, color: Colors.foreground },
  reviewMsgBox: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing[3] },
  successBorder: { borderColor: Colors.success, backgroundColor: Colors.successSoft },
  errorBorder: { borderColor: Colors.danger, backgroundColor: Colors.dangerSoft },
  reviewMsgText: { fontSize: FontSizes.sm },
  saffronBtn: {
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.saffron,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  saffronBtnText: { color: Colors.saffronForeground, fontWeight: "700", fontSize: FontSizes.base },
  maroonBtn: {
    height: 48, borderRadius: Radius.lg, backgroundColor: Colors.maroon,
    alignItems: "center", justifyContent: "center",
  },
  maroonBtnText: { color: Colors.maroonForeground, fontWeight: "700", fontSize: FontSizes.base },
  outlineBtn: {
    height: 48, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnText: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
  btnDisabled: { opacity: 0.5 },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1, borderColor: Colors.danger,
    borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[2],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  warningBox: {
    backgroundColor: Colors.warningSoft, borderWidth: 1, borderColor: Colors.saffron,
    borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[2],
  },
  warningText: { color: Colors.warning, fontSize: FontSizes.sm },
  link: { color: Colors.info, fontSize: FontSizes.sm, textDecorationLine: "underline" },
  muted: { color: Colors.mutedForeground, fontSize: FontSizes.sm },
});
