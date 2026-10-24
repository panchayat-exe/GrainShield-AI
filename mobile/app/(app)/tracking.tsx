/**
 * Tracking screen — GPS live tracking with expo-location.
 * Searches trip by code, shows persisted location, allows sharing GPS position.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Image, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { useAuth } from "@/hooks/use-auth";
import { useGpsTracking } from "@/hooks/use-gps-tracking";
import { getLatestLocation, subscribeToLocations } from "@/lib/services/tracking";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { formatTimestamp } from "@/lib/services/audit";
import { supabase } from "@/lib/supabase/client";
import type { Trip, TripLocation, TripEvidence } from "@/lib/supabase/types";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

// Map placeholder image (the web app uses a static map.jpg)
// For production, integrate react-native-maps with a real MapView
const MapPlaceholder = () => (
  <View style={styles.mapPlaceholder}>
    <Text style={styles.mapPlaceholderText}>📍</Text>
    <Text style={styles.mapPlaceholderLabel}>
      Map view requires react-native-maps setup.{"\n"}
      Install and configure with your Google Maps / Apple Maps key.{"\n"}
      See mobile/docs/MAPS_SETUP.md
    </Text>
  </View>
);

const gpsLabel: Record<string, string> = {
  idle: "GPS Off", requesting: "Requesting…", active: "Sharing Live",
  paused: "Paused", error_permission: "Permission Denied", error_unavailable: "GPS Unavailable",
};

const gpsColor: Record<string, string> = {
  idle: Colors.mutedForeground, requesting: Colors.info, active: Colors.success,
  paused: Colors.warning, error_permission: Colors.danger, error_unavailable: Colors.danger,
};

export default function TrackingScreen() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [latestLocation, setLatestLocation] = useState<TripLocation | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const { tracking, gpsStatus, lastError, startTracking, stopTracking } = useGpsTracking(
    trip?.id ?? null,
    user?.id ?? null,
  );

  async function handleSearch() {
    if (!search.trim() || !user) return;
    setLoading(true);
    setNotFound(false);
    setTrip(null);
    setLatestLocation(null);
    setEvidence(null);
    setPhotoUrl(null);
    setSearched(true);

    unsubRef.current?.();
    unsubRef.current = null;

    const { data } = await supabase
      .from("trips")
      .select("*")
      .ilike("trip_code", search.trim().toUpperCase())
      .maybeSingle();

    if (!data) { setNotFound(true); setLoading(false); return; }

    const t = data as Trip;
    setTrip(t);

    const [loc, evArr] = await Promise.all([
      getLatestLocation(t.id),
      getEvidenceForTrip(t.id),
    ]);
    setLatestLocation(loc);
    const ev = evArr[0] ?? null;
    setEvidence(ev);
    if (ev?.storage_path) {
      const url = await getSignedUrl(ev.storage_path);
      setPhotoUrl(url);
    }

    unsubRef.current = subscribeToLocations(t.id, (newLoc) => {
      setLatestLocation(newLoc);
    });

    setLoading(false);
  }

  useEffect(() => {
    return () => {
      unsubRef.current?.();
      stopTracking();
    };
  }, [stopTracking]);

  const tripStatus = trip?.status === "pass" || trip?.status === "completed" ? "Completed" : "On Route";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.pageTitle}>Trip Live Tracking</Text>

        {!user ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>Please sign in to track trips.</Text>
          </View>
        ) : (
          <>
            {/* Search */}
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Trip ID or Vehicle No…"
                placeholderTextColor={Colors.mutedForeground}
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={handleSearch}
                autoCapitalize="characters"
                returnKeyType="search"
              />
              <TouchableOpacity
                style={styles.searchBtn}
                onPress={handleSearch}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.searchBtnText}>🔍</Text>
                }
              </TouchableOpacity>
            </View>

            {searched && notFound && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠ Trip not found. Check the Trip ID and try again.</Text>
              </View>
            )}

            {/* Map placeholder */}
            <View style={styles.mapContainer}>
              {trip ? (
                <View>
                  <MapPlaceholder />
                  <View style={styles.tripBadge}>
                    <Text style={styles.tripBadgeText}>{trip.trip_code}</Text>
                  </View>
                  {latestLocation && (
                    <View style={styles.locationDot} />
                  )}
                </View>
              ) : (
                <View style={styles.mapContainer}>
                  <MapPlaceholder />
                </View>
              )}
            </View>

            {trip && (
              <>
                {/* GPS Share Panel */}
                <Card title="Share My Location">
                  <Text style={styles.gpsDescription}>
                    Field officers can share their live GPS position for this trip.
                    Location is pushed every 30 seconds while active.
                  </Text>

                  <View style={[styles.gpsStatus, { borderColor: gpsColor[gpsStatus] + "40" }]}>
                    <Text style={[styles.gpsStatusText, { color: gpsColor[gpsStatus] }]}>
                      {gpsStatus === "active" ? "✅" : gpsStatus === "requesting" ? "⏳" : "📍"}{" "}
                      {gpsLabel[gpsStatus]}
                    </Text>
                  </View>

                  {lastError && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>⚠ {lastError}</Text>
                    </View>
                  )}

                  <View style={styles.gpsActions}>
                    <TouchableOpacity
                      style={[
                        styles.gpsStartBtn,
                        (tracking || gpsStatus === "requesting" || gpsStatus === "error_permission") && styles.btnDisabled,
                      ]}
                      onPress={startTracking}
                      disabled={tracking || gpsStatus === "requesting" || gpsStatus === "error_permission"}
                    >
                      <Text style={styles.gpsStartBtnText}>📡 Start Sharing</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.gpsStopBtn,
                        !tracking && gpsStatus !== "requesting" && styles.btnDisabled,
                      ]}
                      onPress={stopTracking}
                      disabled={!tracking && gpsStatus !== "requesting"}
                    >
                      <Text style={styles.gpsStopBtnText}>⏹ Stop</Text>
                    </TouchableOpacity>
                  </View>
                </Card>

                {/* Trip Details */}
                <Card title={`Trip Details · ${tripStatus}`}>
                  <Row label="Trip ID" value={trip.trip_code} />
                  <Row label="Vehicle No." value={trip.vehicle_number} />
                  {trip.driver_name && <Row label="Driver" value={trip.driver_name} />}
                  <Row
                    label="Current Location"
                    value={latestLocation
                      ? `${latestLocation.latitude.toFixed(5)}, ${latestLocation.longitude.toFixed(5)}`
                      : "No location data available"}
                  />
                  {latestLocation && (
                    <>
                      <Row label="Last Updated" value={formatTimestamp(latestLocation.recorded_at)} />
                      {latestLocation.accuracy_meters !== null && (
                        <Row label="GPS Accuracy" value={`±${Math.round(latestLocation.accuracy_meters ?? 0)}m`} />
                      )}
                      <Row label="Source" value={latestLocation.source} />
                    </>
                  )}
                </Card>

                {/* Live Feed */}
                {evidence && photoUrl && (
                  <Card title="Live Feed">
                    <View style={styles.liveFeedRow}>
                      <Image source={{ uri: photoUrl }} style={styles.liveFeedPhoto} resizeMode="cover" />
                      <View style={styles.liveFeedInfo}>
                        <Text style={styles.liveFeedText}>
                          Photo uploaded at {trip.origin ?? "origin"}
                        </Text>
                        <Text style={styles.liveFeedTime}>
                          {formatTimestamp(evidence.uploaded_at)}
                        </Text>
                      </View>
                    </View>
                  </Card>
                )}

                {!latestLocation && (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningText}>
                      ⚠ No live location data yet. Tap "Start Sharing" above to share your GPS
                      position, or wait for location updates from the field device.
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing[4], gap: Spacing[3], paddingBottom: Spacing[6] },
  pageTitle: { fontSize: FontSizes.xl, fontWeight: "800", color: Colors.foreground },
  searchRow: { flexDirection: "row", gap: Spacing[2] },
  searchInput: {
    flex: 1, height: 44, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.input, backgroundColor: Colors.card,
    paddingHorizontal: Spacing[3], fontSize: FontSizes.sm, color: Colors.foreground,
  },
  searchBtn: {
    width: 44, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.info,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { fontSize: 18 },
  mapContainer: {
    borderRadius: Radius.xl, overflow: "hidden",
    borderWidth: 1, borderColor: Colors.border,
  },
  mapPlaceholder: {
    height: 220, backgroundColor: Colors.infoSoft,
    alignItems: "center", justifyContent: "center", padding: Spacing[4], gap: Spacing[3],
  },
  mapPlaceholderText: { fontSize: 48 },
  mapPlaceholderLabel: {
    fontSize: FontSizes.xs, color: Colors.info, textAlign: "center", lineHeight: 18,
  },
  tripBadge: {
    position: "absolute", top: Spacing[2], left: Spacing[2],
    backgroundColor: Colors.foreground, borderRadius: Radius.md,
    paddingHorizontal: Spacing[2], paddingVertical: 2,
  },
  tripBadgeText: { color: Colors.card, fontSize: FontSizes.xs, fontWeight: "700" },
  locationDot: {
    position: "absolute", top: "45%", left: "45%",
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.info, borderWidth: 2, borderColor: Colors.card,
  },
  infoBox: {
    backgroundColor: Colors.infoSoft, borderRadius: Radius.lg, padding: Spacing[4],
    borderWidth: 1, borderColor: Colors.info,
  },
  infoText: { color: Colors.info, fontSize: FontSizes.sm, textAlign: "center" },
  gpsDescription: { fontSize: FontSizes.xs, color: Colors.mutedForeground, marginBottom: Spacing[2] },
  gpsStatus: {
    borderWidth: 1, borderRadius: Radius.md, padding: Spacing[2], marginBottom: Spacing[2],
  },
  gpsStatusText: { fontSize: FontSizes.sm, fontWeight: "600" },
  gpsActions: { flexDirection: "row", gap: Spacing[2] },
  gpsStartBtn: {
    flex: 1, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.success,
    alignItems: "center", justifyContent: "center",
  },
  gpsStartBtnText: { color: "#fff", fontWeight: "700", fontSize: FontSizes.sm },
  gpsStopBtn: {
    flex: 1, height: 44, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, alignItems: "center", justifyContent: "center",
  },
  gpsStopBtnText: { color: Colors.foreground, fontWeight: "600", fontSize: FontSizes.sm },
  btnDisabled: { opacity: 0.4 },
  liveFeedRow: { flexDirection: "row", gap: Spacing[3], alignItems: "center" },
  liveFeedPhoto: { width: 80, height: 60, borderRadius: Radius.md },
  liveFeedInfo: { flex: 1, gap: 4 },
  liveFeedText: { fontSize: FontSizes.sm, color: Colors.foreground },
  liveFeedTime: { fontSize: FontSizes.xs, color: Colors.mutedForeground },
  warningBox: {
    backgroundColor: Colors.warningSoft, borderWidth: 1, borderColor: Colors.saffron,
    borderRadius: Radius.lg, padding: Spacing[3],
  },
  warningText: { fontSize: FontSizes.sm, color: Colors.warning },
  errorBox: {
    backgroundColor: Colors.dangerSoft, borderWidth: 1, borderColor: Colors.danger,
    borderRadius: Radius.md, padding: Spacing[3],
  },
  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
});
