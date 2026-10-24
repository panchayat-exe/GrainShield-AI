/**
 * Result (Pass) screen — shows actual saved verification data.
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, Image, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getLatestVerification } from "@/lib/services/verification";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { formatTimestamp } from "@/lib/services/audit";
import type { Trip, VerificationResult, TripEvidence } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

function stageName(s: string) {
  return s === "first_mile" ? "First Mile" : s === "last_mile" ? "Last Mile" : s === "mid_mile" ? "Mid Mile" : s;
}

export default function ResultScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.center}>
          <Text style={styles.muted}>Please sign in to view this result.</Text>
        </View>
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
            <TouchableOpacity onPress={() => router.push("/(app)")}>
              <Text style={styles.link}>Go to Upload</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!verification || verification.status !== "pass") {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.content}>
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              This trip does not have a passing verification result.
            </Text>
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Pass Banner */}
        <View style={styles.passBanner}>
          <Text style={styles.passIcon}>✅</Text>
          <View>
            <Text style={styles.passLabel}>PASS</Text>
            <Text style={styles.passSubtitle}>Photo verified successfully</Text>
          </View>
        </View>

        {photoUrl && (
          <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
        )}

        <Card title="Extracted Details">
          <Row
            label="Vehicle Number"
            value={`${verification.detected_plate ?? "—"} ${verification.plate_match ? "(Match)" : ""}`}
            tone={verification.plate_match ? "success" : "warning"}
          />
          <Row
            label="Vehicle Type"
            value={verification.vehicle_type ?? "—"}
            tone={verification.vehicle_detected ? "success" : undefined}
          />
          <Row label="Image Quality" value={verification.image_quality ?? "—"} tone="success" />
          <Row label="Trip Stage" value={stageName(evidence?.stage ?? trip.stage)} tone="success" />
          <Row
            label="Evidence"
            value={verification.plate_match ? "Vehicle + Plate Visible" : "Plate not verified"}
            tone={verification.plate_match ? "success" : "warning"}
          />
        </Card>

        <Card title="Summary">
          <Row label="Trip ID" value={trip.trip_code} />
          <Row
            label="Activity Time"
            value={verification.processing_completed_at
              ? formatTimestamp(verification.processing_completed_at)
              : "—"}
          />
          <Row label="Processed By" value={verification.processor_version ?? "AI System"} />
          {verification.confidence !== null && (
            <Row label="Confidence" value={`${Math.round((verification.confidence ?? 0) * 100)}%`} />
          )}
        </Card>

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
  passBanner: {
    flexDirection: "row", alignItems: "center", gap: Spacing[4],
    backgroundColor: Colors.successSoft, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.success, padding: Spacing[4],
  },
  passIcon: { fontSize: 40 },
  passLabel: { fontSize: FontSizes["3xl"], fontWeight: "900", color: Colors.success },
  passSubtitle: { fontSize: FontSizes.sm, color: Colors.success },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: Radius.xl },
  outlineBtn: {
    height: 48, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnText: { fontSize: FontSizes.sm, fontWeight: "600", color: Colors.foreground },
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
