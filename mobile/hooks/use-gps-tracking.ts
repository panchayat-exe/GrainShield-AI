/**
 * useGpsTracking — React Native version using expo-location.
 *
 * Replaces the web navigator.geolocation API with expo-location,
 * which handles native permission requests on Android and iOS.
 * Pushes device position to trip_locations via recordLocation() every 30 seconds.
 */
import { useState, useRef, useCallback } from "react";
import * as Location from "expo-location";
import { recordLocation } from "@/lib/services/tracking";

export type GpsStatus =
  | "idle"
  | "requesting"
  | "active"
  | "paused"
  | "error_permission"
  | "error_unavailable";

export interface GpsTrackingState {
  tracking: boolean;
  gpsStatus: GpsStatus;
  lastError: string | null;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
}

const PUSH_INTERVAL_MS = 30_000;

export function useGpsTracking(
  tripId: string | null,
  userId: string | null
): GpsTrackingState {
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestPositionRef = useRef<Location.LocationObject | null>(null);

  const stopTracking = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setGpsStatus("idle");
  }, []);

  const pushLocation = useCallback(
    async (pos: Location.LocationObject) => {
      if (!tripId || !userId) return;
      await recordLocation({
        tripId,
        userId,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy ?? undefined,
      });
    },
    [tripId, userId]
  );

  const startTracking = useCallback(async () => {
    if (!tripId || !userId) return;

    setGpsStatus("requesting");
    setLastError(null);

    // Request foreground permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setGpsStatus("error_permission");
      setLastError("Location permission denied. Please allow location access and try again.");
      return;
    }

    // Start watching position
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10_000,
          distanceInterval: 10,
        },
        (pos) => {
          latestPositionRef.current = pos;
          setGpsStatus("active");
          setLastError(null);
        }
      );
      subscriptionRef.current = sub;
    } catch {
      setGpsStatus("error_unavailable");
      setLastError("Could not obtain GPS position. Make sure GPS is enabled.");
      return;
    }

    // Push to Supabase every PUSH_INTERVAL_MS
    intervalRef.current = setInterval(() => {
      if (latestPositionRef.current) {
        void pushLocation(latestPositionRef.current);
      }
    }, PUSH_INTERVAL_MS);
  }, [tripId, userId, pushLocation]);

  return {
    tracking: gpsStatus === "active",
    gpsStatus,
    lastError,
    startTracking,
    stopTracking,
  };
}
