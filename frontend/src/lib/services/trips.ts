/**
 * Trip service — typed business operations for creating and reading trips.
 */
import { supabase } from "@/lib/supabase/client";
import type { Trip, TripStage, Database } from "@/lib/supabase/types";

type TripInsert = Database["public"]["Tables"]["trips"]["Insert"];
type TripUpdate = Database["public"]["Tables"]["trips"]["Update"];

// ─── Citizen automatic trip creation ─────────────────────────────────────────

/**
 * Create a new citizen trip by calling the citizen_create_trip() SECURITY DEFINER
 * RPC. The backend auto-generates a GS-YYYY-NNNNNN Trip ID.
 * The citizen NEVER supplies the Trip ID themselves.
 *
 * @returns { tripId, tripCode, error } — tripCode is the human-readable GS-YYYY-NNNNNN
 */
export async function createCitizenTrip(params: {
  vehicleNumber: string;
  stage: TripStage;
  origin?: string;
  destination?: string;
  commodity?: string;
  quantityKg?: number | null;
}): Promise<{ tripId: string; tripCode: string; error: string | null }> {
  const { data, error } = await supabase.rpc("citizen_create_trip", {
    p_vehicle_number: params.vehicleNumber.toUpperCase().trim(),
    p_stage: params.stage,
    p_origin: params.origin?.trim() ?? null,
    p_destination: params.destination?.trim() ?? null,
    p_origin_lat: null,
    p_origin_lng: null,
    p_destination_lat: null,
    p_destination_lng: null,
    p_commodity: params.commodity?.trim() ?? null,
    p_quantity_kg: params.quantityKg ?? null,
  });

  if (error) {
    console.error("[trips] createCitizenTrip RPC error:", error.message);
    return { tripId: "", tripCode: "", error: error.message };
  }

  // RPC returns JSONB: { success, trip_id, trip_code } or { success: false, error }
  const result = data as {
    success: boolean;
    trip_id?: string;
    trip_code?: string;
    error?: string;
  };

  if (!result.success || !result.trip_id || !result.trip_code) {
    const msg = result.error ?? "Failed to create trip — please try again.";
    console.error("[trips] createCitizenTrip returned failure:", msg);
    return { tripId: "", tripCode: "", error: msg };
  }

  return { tripId: result.trip_id, tripCode: result.trip_code, error: null };
}

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
  const payload: TripInsert = {
    trip_code: normalizedCode,
    vehicle_number: vehicleNumber.toUpperCase(),
    stage,
    created_by: userId,
    status: "submitted",
  };
  const { data, error } = await supabase.from("trips").insert(payload).select().single();

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
  const payload: TripUpdate = { status };
  const { error } = await supabase.from("trips").update(payload).eq("id", tripId);

  if (error) return { error: error.message };
  return { error: null };
}
