/**
 * Tracking service — location updates for trips.
 */
import { supabase } from "@/lib/supabase/client";
import type { TripLocation } from "@/lib/supabase/types";

/** Get all location updates for a trip, newest first. */
export async function getTripLocations(tripId: string): Promise<TripLocation[]> {
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
}

/** Get the latest location update for a trip. */
export async function getLatestLocation(tripId: string): Promise<TripLocation | null> {
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
}

/**
 * Submit the current device GPS position for a trip.
 * Requires Geolocation API consent.
 */
export async function recordLocation(params: {
  tripId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}): Promise<{ error: string | null }> {
  const { tripId, userId, latitude, longitude, accuracyMeters } = params;

  // Basic sanity check on coordinate ranges
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { error: "Invalid GPS coordinates." };
  }

  const { error } = await supabase.from("trip_locations").insert({
    trip_id: tripId,
    uploaded_by: userId,
    latitude,
    longitude,
    accuracy_meters: accuracyMeters ?? null,
    source: "device_gps",
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[tracking] recordLocation:", error.message);
    return { error: "Failed to save location." };
  }
  return { error: null };
}

/** Subscribe to real-time location updates for a trip. */
export function subscribeToLocations(
  tripId: string,
  onUpdate: (location: TripLocation) => void,
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
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
