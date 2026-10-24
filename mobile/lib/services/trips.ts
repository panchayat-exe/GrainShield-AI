/**
 * Trip service — React Native.
 * Identical logic to web trips.ts; no platform-specific APIs used.
 */
import { supabase } from "@/lib/supabase/client";
import type { Trip, TripStage } from "@/lib/supabase/types";

export async function getTripByCode(tripCode: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("trip_code", tripCode.toUpperCase())
    .maybeSingle();
  if (error) {
    console.error("[trips] getTripByCode:", error.message);
    return null;
  }
  return data as Trip | null;
}

export async function getTripById(tripId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  if (error) {
    console.error("[trips] getTripById:", error.message);
    return null;
  }
  return data as Trip | null;
}

export async function upsertTrip(params: {
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  userId: string;
}): Promise<{ trip: Trip | null; error: string | null }> {
  const { tripCode, vehicleNumber, stage, userId } = params;
  const normalizedCode = tripCode.toUpperCase();

  const existing = await getTripByCode(normalizedCode);
  if (existing) {
    if (existing.created_by !== userId && existing.assigned_to !== userId) {
      return { trip: null, error: "You are not authorized to submit evidence for this trip." };
    }
    return { trip: existing, error: null };
  }

  const payload = {
    trip_code: normalizedCode,
    vehicle_number: vehicleNumber.toUpperCase(),
    stage,
    created_by: userId,
    status: "submitted" as const,
  };
  const { data, error } = await supabase.from("trips").insert(payload).select().single();
  if (error) {
    console.error("[trips] upsertTrip insert:", error.message);
    return { trip: null, error: "Failed to create trip record. Please try again." };
  }
  return { trip: data as Trip, error: null };
}

export async function listMyTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[trips] listMyTrips:", error.message);
    return [];
  }
  return (data ?? []) as Trip[];
}

export async function updateTripStatus(
  tripId: string,
  status: Trip["status"]
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("trips").update({ status }).eq("id", tripId);
  if (error) return { error: error.message };
  return { error: null };
}
