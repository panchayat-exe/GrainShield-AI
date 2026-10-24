/**
 * Trip details screen — evidence checklist, verification attempts, audit log.
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
import { StatusBadge, verificationVariant } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { getVerificationsForTrip } from "@/lib/services/verification";
import { getAuditLogsForTrip, auditActionLabel, formatTimestamp } from "@/lib/services/audit";
import type { Trip, TripEvidence, VerificationResult, AuditLog } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

function stageName(s: string) {
  return s === "first_mile" ? "First Mile" : s === "last_mile" ? "Last Mile" : s === "mid_mile" ? "Mid Mile" : s;
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    pending: "Pending", processing: "Processing", pass: "Pass",
    retake: "Retake", manual_review: "Manual Review", error: "Error",
    submitted: "Submitted", draft: "Draft", rejected: "Rejected", completed: "Completed",
  };
  return m[s] ?? s;
}

export default function TripScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence[]>([]);
  const [verifications, setVerifications] = useState<VerificationResult[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tripId || !user) { setLoading(false); return; }
    void (async () => {
      const [t, evArr, verArr, logs] = await Promise.all([
        getTripById(tripId),
        getEvidenceForTrip(tripId),
        getVerificationsForTrip(tripId),
        getAuditLogsForTrip(tripId),
      ]);
      if (!t) { setNotFound(true); setLoading(false); return; }
      setTrip(t); setEvidence(evArr); setVerifications(verArr); setAuditLogs(logs);
      const urls: Record<string, string> = {};
      await Promise.all(evArr.map(async (ev) => {
        if (ev.storage_path) {
          const url = await getSignedUrl(ev.storage_path);
          if (url) urls[ev.id] = url;
        }
      }));
      setPhotoUrls(urls);
      setLoading(false);
    })();
  }, [tripId, user]);

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

  if (notFound || !trip) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader />
        <View style={styles.content}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Trip not found or access denied.</Text>
            <TouchableOpacity onPress={() => router.push("/(app)")}>
              <Text style={styles.link}>Upload a new photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const latestVerification = verifications[0] ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.pageTitle}>Trip Photo Verification</Text>

        {evidence[0] && photoUrls[evidence[0].id] && (
          <Image source={{ uri: photoUrls[evidence[0].id] }} style={styles.photo} resizeMode="cover" />
        )}

        <Card title="Trip Details">
          <Row label="Trip ID" value={trip.trip_code} />
          <Row label="Vehicle No." value={trip.vehicle_number} />
          <Row label="Stage" value={stageName(trip.stage)} />
          <Row label="Status" value={statusLabel(trip.status)} />
          <Row label="Created" value={formatTimestamp(trip.created_at)} />
        </Card>

        {/* Evidence Checklist */}
        <Card title="Evidence Checklist">
          {latestVerification ? (
            <View style={{ gap: 2 }}>
              {[
                {
                  label: "Image Quality",
                  pass: latestVerification.image_quality === "clear",
                  value: latestVerification.image_quality ?? "—",
                },
                {
                  label: "Vehicle Detection",
                  pass: !!latestVerification.vehicle_detected,
                  value: latestVerification.vehicle_detected ? "Detected" : "Not Detected",
                },
                {
                  label: "Number Plate OCR",
                  pass: !!latestVerification.plate_match,
                  value: `${latestVerification.detected_plate ?? "—"} ${latestVerification.plate_match ? "(Match)" : "(Mismatch)"}`,
                },
                {
                  label: "Vehicle Type",
                  pass: true,
                  value: latestVerification.vehicle_type ?? "—",
                },
                {
                  label: "Required Evidence",
                  pass: !!latestVerification.plate_match,
                  value: latestVerification.plate_match ? "Vehicle + Plate Visible" : "Incomplete",
                },
              ].map(({ label, pass, value }) => (
                <View key={label} style={styles.checkRow}>
                  <Text style={styles.checkLabel}>{label}</Text>
                  <View style={styles.checkRight}>
                    <Text style={styles.checkIcon}>{pass ? "✅" : "❌"}</Text>
                    <Text style={[styles.checkValue, { color: pass ? Colors.success : Colors.danger }]}>
                      {value}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.pendingRow}>
              <Text style={styles.pendingText}>⏱ No verification result yet.</Text>
              {tripId && (
                <TouchableOpacity
                  onPress={() => router.push({ pathname: "/(app)/processing", params: { tripId } })}
                >
                  <Text style={styles.link}>Check processing</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Card>

        {/* Verification Attempts */}
        {verifications.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Verification Attempts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attemptsScroll}>
              {verifications.map((v) => (
                <View
                  key={v.id}
                  style={[
                    styles.attemptCard,
                    {
                      borderColor: v.status === "pass"
                        ? Colors.success
                        : v.status === "manual_review"
                          ? Colors.danger
                          : Colors.saffron,
                    },
                  ]}
                >
                  <StatusBadge
                    label={v.status.toUpperCase().replace("_", " ")}
                    variant={verificationVariant(v.status)}
                  />
                  {photoUrls[v.evidence_id] && (
                    <Image
                      source={{ uri: photoUrls[v.evidence_id] }}
                      style={styles.attemptPhoto}
                      resizeMode="cover"
                    />
                  )}
                  <Text style={styles.attemptPlate}>{v.detected_plate ?? "Plate: —"}</Text>
                  <Text style={styles.attemptExplanation} numberOfLines={2}>
                    {v.explanation ?? (v.status === "pass" ? "All checks passed." : "See failure reasons.")}
                  </Text>
                  <Text style={styles.attemptTime}>{formatTimestamp(v.created_at)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Audit Log */}
        <Card title="📋 Audit Log">
          {auditLogs.length === 0 ? (
            <Text style={styles.muted}>No audit events yet.</Text>
          ) : (
            auditLogs.map((log) => (
              <Row key={log.id} label={auditActionLabel(log.action)} value={formatTimestamp(log.created_at)} />
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3], paddingBottom: Spacing[6] },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: FontSizes.xl, fontWeight: "800", color: Colors.foreground },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: Radius.xl },
  checkRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: Spacing[2], borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  checkLabel: { fontSize: FontSizes.sm, color: Colors.foreground, flex: 1 },
  checkRight: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1, justifyContent: "flex-end" },
  checkIcon: { fontSize: 14 },
  checkValue: { fontSize: FontSizes.sm, fontWeight: "600", textAlign: "right" },
  pendingRow: { gap: 4 },
  pendingText: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
  sectionTitle: { fontSize: FontSizes.base, fontWeight: "700", color: Colors.foreground, marginBottom: Spacing[2] },
  attemptsScroll: { marginHorizontal: -Spacing[4] },
  attemptCard: {
    width: 220, marginHorizontal: Spacing[2], borderRadius: Radius.xl,
    borderWidth: 1, padding: Spacing[3], backgroundColor: Colors.card, gap: Spacing[2],
  },
  attemptPhoto: { width: "100%", aspectRatio: 16 / 9, borderRadius: Radius.md },
  attemptPlate: { fontSize: FontSizes.sm, fontWeight: "700", color: Colors.foreground },
  attemptExplanation: { fontSize: FontSizes.xs, color: Colors.mutedForeground },
  attemptTime: { fontSize: FontSizes.xs, color: Colors.mutedForeground },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1, borderColor: Colors.danger,
    borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[2],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
  link: { color: Colors.info, fontSize: FontSizes.sm, textDecorationLine: "underline" },
  muted: { fontSize: FontSizes.sm, color: Colors.mutedForeground },
});
