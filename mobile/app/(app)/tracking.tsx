/**

 * Tracking screen — GPS live tracking with MapView.

 * Shows a real map centered on the latest GPS location,

 * allows starting/stopping background GPS sharing,

 * and displays trip evidence live feed.

 */

import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";

import { AppHeader } from "@/components/AppHeader";

import { OutboxBanner } from "@/components/OutboxBanner";

import { Card } from "@/components/Card";

import { Row } from "@/components/Row";

import { useAuth } from "@/hooks/use-auth";

import { useGpsTracking } from "@/hooks/use-gps-tracking";

import {
  getLatestLocation,
  subscribeToLocations,
} from "@/lib/services/tracking";

import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";

import { formatTimestamp } from "@/lib/services/audit";

import { supabase } from "@/lib/supabase/client";

import type { Trip, TripLocation, TripEvidence } from "@/lib/supabase/types";

import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";

// Default region: Gujarat, India

const DEFAULT_REGION: Region = {
  latitude: 22.2587,

  longitude: 71.1924,

  latitudeDelta: 5,

  longitudeDelta: 5,
};

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const gpsLabel: Record<string, string> = {
  idle: "GPS Off",

  requesting: "Requesting…",

  active: "Sharing Live",

  paused: "Paused",

  error_permission: "Permission Denied",

  error_unavailable: "GPS Unavailable",
};

const gpsColor: Record<string, string> = {
  idle: Colors.mutedForeground,

  requesting: Colors.info,

  active: Colors.success,

  paused: Colors.warning,

  error_permission: Colors.danger,

  error_unavailable: Colors.danger,
};

export default function TrackingScreen() {
  const { user } = useAuth();

  const [search, setSearch] = useState("");

  const [trip, setTrip] = useState<Trip | null>(null);

  const [latestLocation, setLatestLocation] = useState<TripLocation | null>(
    null,
  );

  const [evidence, setEvidence] = useState<TripEvidence | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const [searched, setSearched] = useState(false);

  const [notFound, setNotFound] = useState(false);

  const mapRef = useRef<MapView | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  const { tracking, gpsStatus, lastError, startTracking, stopTracking } =
    useGpsTracking(
      trip?.id ?? null,

      user?.id ?? null,
    );

  // Fly map to latest location

  useEffect(() => {
    if (!latestLocation || !mapRef.current) return;

    mapRef.current.animateToRegion(
      {
        latitude: latestLocation.latitude,

        longitude: latestLocation.longitude,

        latitudeDelta: 0.05,

        longitudeDelta: 0.05,
      },

      800,
    );
  }, [latestLocation]);

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

    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

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

  // Stale location check

  const isStale = latestLocation
    ? Date.now() - new Date(latestLocation.recorded_at).getTime() >
      STALE_THRESHOLD_MS
    : false;

  const mapRegion: Region | undefined = latestLocation
    ? {
        latitude: latestLocation.latitude,

        longitude: latestLocation.longitude,

        latitudeDelta: 0.05,

        longitudeDelta: 0.05,
      }
    : undefined;

  const tripStatusLabel =
    trip?.status === "pass" || trip?.status === "completed"
      ? "Completed"
      : "On Route";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <AppHeader />

      <OutboxBanner />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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

                autoCapitalize="characters"

                returnKeyType="search"

                onSubmitEditing={handleSearch}
              />

              <TouchableOpacity
                style={styles.searchBtn}

                onPress={handleSearch}

                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.searchBtnText}>🔍</Text>
                )}
              </TouchableOpacity>
            </View>

            {searched && notFound && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Trip not found. Check the trip code.
                </Text>
              </View>
            )}

            {trip && (
              <>
                {/* Map */}

                <View style={styles.mapContainer}>
                  <MapView
                    ref={mapRef}

                    style={styles.map}

                    provider={
                      Platform.OS === "android" ? PROVIDER_GOOGLE : undefined
                    }

                    initialRegion={mapRegion ?? DEFAULT_REGION}

                    showsUserLocation

                    showsMyLocationButton
                  >
                    {latestLocation && (
                      <Marker
                        coordinate={{
                          latitude: latestLocation.latitude,

                          longitude: latestLocation.longitude,
                        }}

                        title={trip.trip_code}

                        description={`Accuracy: ${latestLocation.accuracy_meters?.toFixed(0) ?? "?"}m`}

                        pinColor={Colors.maroon ?? "#7C0A02"}
                      />
                    )}
                  </MapView>

                  {/* Trip code badge */}

                  <View style={styles.tripBadge}>
                    <Text style={styles.tripBadgeText}>{trip.trip_code}</Text>
                  </View>

                  {/* Status badge */}

                  <View
                    style={[
                      styles.statusBadge,

                      {
                        backgroundColor:
                          tripStatusLabel === "Completed"
                            ? Colors.success
                            : Colors.info,
                      },
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>
                      {tripStatusLabel}
                    </Text>
                  </View>
                </View>

                {/* Stale warning */}

                {isStale && latestLocation && (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningText}>
                      ⚠️ Location data is over 5 minutes old. The device may be
                      offline.
                    </Text>
                  </View>
                )}

                {/* GPS Controls */}

                <Card title="GPS Sharing">
                  <Text style={styles.gpsDescription}>
                    Share your live position so the admin map updates in real
                    time.
                  </Text>

                  <View
                    style={[
                      styles.gpsStatus,

                      { borderColor: gpsColor[gpsStatus] ?? Colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        styles.gpsStatusText,
                        { color: gpsColor[gpsStatus] ?? Colors.foreground },
                      ]}
                    >
                      ● {gpsLabel[gpsStatus] ?? gpsStatus}
                    </Text>
                  </View>

                  {lastError && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{lastError}</Text>
                    </View>
                  )}

                  <View style={styles.gpsActions}>
                    <TouchableOpacity
                      style={[
                        styles.gpsStartBtn,
                        tracking && styles.btnDisabled,
                      ]}

                      onPress={startTracking}

                      disabled={tracking}
                    >
                      <Text style={styles.gpsStartBtnText}>
                        ▶ Start Sharing
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.gpsStopBtn,
                        !tracking && styles.btnDisabled,
                      ]}

                      onPress={stopTracking}

                      disabled={!tracking}
                    >
                      <Text style={styles.gpsStopBtnText}>■ Stop</Text>
                    </TouchableOpacity>
                  </View>
                </Card>

                {/* Location Details */}

                {latestLocation && (
                  <Card title="Last Known Location">
                    <Row
                      label="Latitude"
                      value={latestLocation.latitude.toFixed(6)}
                    />

                    <Row
                      label="Longitude"
                      value={latestLocation.longitude.toFixed(6)}
                    />

                    {latestLocation.accuracy_meters != null && (
                      <Row
                        label="Accuracy"
                        value={`±${latestLocation.accuracy_meters?.toFixed(0) ?? "?"} m`}
                      />
                    )}

                    <Row
                      label="Recorded"
                      value={formatTimestamp(latestLocation.recorded_at)}
                    />

                    {isStale && (
                      <Text
                        style={[
                          styles.gpsStatusText,
                          { color: Colors.warning, marginTop: 4 },
                        ]}
                      >
                        ⚠️ Stale — last ping over 5 min ago
                      </Text>
                    )}
                  </Card>
                )}

                {/* Live Feed */}

                {evidence && photoUrl && (
                  <Card title="Live Feed">
                    <View style={styles.liveFeedRow}>
                      <Image
                        source={{ uri: photoUrl }}
                        style={styles.liveFeedPhoto}
                        resizeMode="cover"
                      />

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
                      📡 No live location data yet. Tap "Start Sharing" above to
                      share your GPS position, or wait for location updates from
                      the field device.
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

  pageTitle: {
    fontSize: FontSizes.xl,
    fontWeight: "800",
    color: Colors.foreground,
  },

  searchRow: { flexDirection: "row", gap: Spacing[2] },

  searchInput: {
    flex: 1,
    height: 44,
    borderRadius: Radius.lg,
    borderWidth: 1,

    borderColor: Colors.input,
    backgroundColor: Colors.card,

    paddingHorizontal: Spacing[3],
    fontSize: FontSizes.sm,
    color: Colors.foreground,
  },

  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    backgroundColor: Colors.info,

    alignItems: "center",
    justifyContent: "center",
  },

  searchBtnText: { fontSize: 18 },

  mapContainer: {
    borderRadius: Radius.xl,
    overflow: "hidden",

    borderWidth: 1,
    borderColor: Colors.border,
    height: 260,
  },

  map: { width: "100%", height: "100%" },

  tripBadge: {
    position: "absolute",
    top: Spacing[2],
    left: Spacing[2],

    backgroundColor: Colors.foreground,
    borderRadius: Radius.md,

    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },

  tripBadgeText: {
    color: Colors.card,
    fontSize: FontSizes.xs,
    fontWeight: "700",
  },

  statusBadge: {
    position: "absolute",
    top: Spacing[2],
    right: Spacing[2],

    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },

  statusBadgeText: { color: "#fff", fontSize: FontSizes.xs, fontWeight: "700" },

  infoBox: {
    backgroundColor: Colors.infoSoft,
    borderRadius: Radius.lg,
    padding: Spacing[4],

    borderWidth: 1,
    borderColor: Colors.info,
  },

  infoText: { color: Colors.info, fontSize: FontSizes.sm, textAlign: "center" },

  gpsDescription: {
    fontSize: FontSizes.xs,
    color: Colors.mutedForeground,
    marginBottom: Spacing[2],
  },

  gpsStatus: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[2],
    marginBottom: Spacing[2],
  },

  gpsStatusText: { fontSize: FontSizes.sm, fontWeight: "600" },

  gpsActions: { flexDirection: "row", gap: Spacing[2] },

  gpsStartBtn: {
    flex: 1,
    height: 44,
    borderRadius: Radius.lg,
    backgroundColor: Colors.success,

    alignItems: "center",
    justifyContent: "center",
  },

  gpsStartBtnText: { color: "#fff", fontWeight: "700", fontSize: FontSizes.sm },

  gpsStopBtn: {
    flex: 1,
    height: 44,
    borderRadius: Radius.lg,
    borderWidth: 1,

    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  gpsStopBtnText: {
    color: Colors.foreground,
    fontWeight: "600",
    fontSize: FontSizes.sm,
  },

  btnDisabled: { opacity: 0.4 },

  liveFeedRow: { flexDirection: "row", gap: Spacing[3], alignItems: "center" },

  liveFeedPhoto: { width: 80, height: 60, borderRadius: Radius.md },

  liveFeedInfo: { flex: 1, gap: 4 },

  liveFeedText: { fontSize: FontSizes.sm, color: Colors.foreground },

  liveFeedTime: { fontSize: FontSizes.xs, color: Colors.mutedForeground },

  warningBox: {
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.saffron,

    borderRadius: Radius.lg,
    padding: Spacing[3],
  },

  warningText: { fontSize: FontSizes.sm, color: Colors.warning },

  errorBox: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,

    borderRadius: Radius.md,
    padding: Spacing[3],
  },

  errorText: { color: Colors.danger, fontSize: FontSizes.sm },
});
