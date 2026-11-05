/**
 * useGpsTracking — React Native version using expo-location.
 *
 * Replaces the web navigator.geolocation API with expo-location,
 * which handles native permission requests on Android and iOS.
 * Pushes device position to trip_locations via recordLocation() every 30 seconds.
 */
import { useState, useRef, useCallback } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
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
const LOCATION_TASK_NAME = "grainshield-location-task";

// Module-level shared state for background task to access
let _backgroundTripId: string | null = null;
let _backgroundUserId: string | null = null;
let _latestBackgroundPosition: Location.LocationObject | null = null;


// Register background location task (must be at module level, outside any component/hook)
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.warn("[GpsTracking] Background task error:", error.message);
    return;
  }
  if (data?.locations?.length) {
    _latestBackgroundPosition = data.locations[data.locations.length - 1];
  }
});

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
    // Stop background location updates if running
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      .then((running) => {
        if (running) return Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      })
      .catch(() => {/* ignore */});
    _backgroundTripId = null;
    _backgroundUserId = null;
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
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      setGpsStatus("error_permission");
      setLastError("Location permission denied. Please allow location access and try again.");
      return;
    }

    // Request background permission (Android 10+ requires explicit grant)
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    const hasBackground = bgStatus === "granted";

    // Set module-level trip context for background task
    _backgroundTripId = tripId;
    _backgroundUserId = userId;

    if (hasBackground) {
      // Start background location updates via TaskManager
      try {
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: 10_000,
            distanceInterval: 10,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "GrainShield AI",
              notificationBody: "Tracking trip location…",
              notificationColor: "#7C0A02",
            },
          });
        }
        // Also watch in foreground to update latestPositionRef
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
          (pos) => {
            latestPositionRef.current = pos;
            setGpsStatus("active");
            setLastError(null);
          }
        );
        subscriptionRef.current = sub;
      } catch (err) {
        console.warn("[GpsTracking] Background start failed, falling back to foreground:", err);
        hasBackground && console.warn("[GpsTracking] Will use foreground only.");
        // Fall through to foreground watch
        try {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
            (pos) => { latestPositionRef.current = pos; setGpsStatus("active"); setLastError(null); }
          );
          subscriptionRef.current = sub;
        } catch {
          setGpsStatus("error_unavailable");
          setLastError("Could not obtain GPS position. Make sure GPS is enabled.");
          return;
        }
      }
    } else {
      // No background permission — foreground only
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
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
