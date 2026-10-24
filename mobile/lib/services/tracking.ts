/**
 * Tracking service — React Native.
 * Location recording uses expo-location with automatic offline buffering.
 * If cellular connectivity is lost, coordinates are stored in local storage
 * and automatically flushed when connection is restored.
 */
import { supabase } from "@/lib/supabase/client";
import type { TripLocation } from "@/lib/supabase/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const OFFLINE_LOCATIONS_KEY = "@grainshield_offline_locations";

async function queueOfflineLocation(payload: Record<string, unknown>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_LOCATIONS_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    // Keep max 500 coordinates to avoid storage ballooning
    const updated = [...existing.slice(-499), payload];
    await AsyncStorage.setItem(OFFLINE_LOCATIONS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error("[tracking] queueOfflineLocation error:", err);
  }
}

export async function flushOfflineLocations(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_LOCATIONS_KEY);
    if (!raw) return;
    const queued = JSON.parse(raw);
    if (!Array.isArray(queued) || queued.length === 0) return;

    const { error } = await supabase.from("trip_locations").insert(queued);
    if (!error) {
      await AsyncStorage.removeItem(OFFLINE_LOCATIONS_KEY);
      console.log(`[tracking] Flushed ${queued.length} offline GPS coordinates to Supabase.`);
    }
  } catch {
    // still offline, retain buffer
  }
}

export async function getTripLocations(tripId: string): Promise<TripLocation[]> {
  try {
    const { data, error } = await supabase
      .from("trip_locations")
      .select("*")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: false });
    if (error) {
      console.error("[tracking] getTripLocations:", error.message);
      return [];
    }
    return (data ?? []) as TripLocation[];
  } catch {
    return [];
  }
}

export async function getLatestLocation(tripId: string): Promise<TripLocation | null> {
  try {
    const { data, error } = await supabase
      .from("trip_locations")
      .select("*")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[tracking] getLatestLocation:", error.message);
      return null;
    }
    return data as TripLocation | null;
  } catch {
    return null;
  }
}

export async function recordLocation(params: {
  tripId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}): Promise<{ error: string | null }> {
  const { tripId, userId, latitude, longitude, accuracyMeters } = params;

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { error: "Invalid GPS coordinates." };
  }

  const payload = {
    trip_id: tripId,
    uploaded_by: userId,
    latitude,
    longitude,
    accuracy_meters: accuracyMeters ?? null,
    source: "device_gps",
    recorded_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from("trip_locations").insert(payload);
    if (error) {
      // Buffer locally when database insert fails
      await queueOfflineLocation(payload);
      return { error: null };
    }
    // Try to flush buffered locations if any
    void flushOfflineLocations();
    return { error: null };
  } catch {
    await queueOfflineLocation(payload);
    return { error: null };
  }
}

export function subscribeToLocations(
  tripId: string,
  onUpdate: (location: TripLocation) => void
): () => void {
  const channel = supabase
    .channel(`locations:${tripId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "trip_locations",
        filter: `trip_id=eq.${tripId}`,
      },
      (payload) => {
        onUpdate(payload.new as TripLocation);
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
