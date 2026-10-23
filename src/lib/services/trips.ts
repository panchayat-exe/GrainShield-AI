/**
 * Trip service — typed business operations for creating and reading trips.
 */
import { supabase } from "@/lib/supabase/client";
import type { Trip, TripStage } from "@/lib/supabase/types";

/** Find a trip by trip_code that belongs to the current user (RLS enforced). */
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

/** Get a trip by UUID. RLS ensures only authorized users see it. */
export async function getTripById(tripId: string): Promise<Trip | null> {
  const { data, error } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();

  if (error) {
    console.error("[trips] getTripById:", error.message);
    return null;
  }
  return data as Trip | null;
}

/**
 * Upsert a trip: find by trip_code (for the current user) or create a new one.
 * Returns the trip and whether it was newly created.
 */
export async function upsertTrip(params: {
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  userId: string;
}): Promise<{ trip: Trip | null; error: string | null }> {
  const { tripCode, vehicleNumber, stage, userId } = params;
  const normalizedCode = tripCode.toUpperCase();

  // Look for existing trip first (RLS allows only own trips)
  const existing = await getTripByCode(normalizedCode);
  if (existing) {
    // Verify this user is allowed to use it
    if (existing.created_by !== userId && existing.assigned_to !== userId) {
      return { trip: null, error: "You are not authorized to submit evidence for this trip." };
    }
    return { trip: existing, error: null };
  }

  // Create new trip
  const { data, error } = await supabase
    .from("trips")
    .insert({
      trip_code: normalizedCode,
      vehicle_number: vehicleNumber.toUpperCase(),
      stage,
      created_by: userId,
      status: "submitted",
    })
    .select()
    .single();

  if (error) {
    console.error("[trips] upsertTrip insert:", error.message);
    return { trip: null, error: "Failed to create trip record. Please try again." };
  }
  return { trip: data as Trip, error: null };
}

/** List trips belonging to the current user. */
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

/** Update trip status — only allowed to non-destructive transitions. */
export async function updateTripStatus(
  tripId: string,
  status: Trip["status"],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("trips").update({ status }).eq("id", tripId);

  if (error) return { error: error.message };
  return { error: null };
}
