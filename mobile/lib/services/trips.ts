/**
 * Trip service — React Native.
 * Identical logic to web trips.ts; no platform-specific APIs used.
 */
import { supabase } from "@/lib/supabase/client";
import type { Trip, TripStage } from "@/lib/supabase/types";

// ─── Citizen automatic trip creation ─────────────────────────────────────────

/**
 * Create a new citizen trip via the citizen_create_trip() SECURITY DEFINER RPC.
 * The backend auto-generates a GS-YYYY-NNNNNN Trip ID.
 * Citizens NEVER supply the Trip ID.
 */
export async function createCitizenTrip(params: {
  vehicleNumber: string;
  stage: TripStage;
  origin?: string;
  destination?: string;
  commodity?: string;
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
    p_quantity_kg: null,
  });

  if (error) {
    console.error("[trips] createCitizenTrip RPC error:", error.message);
    return { tripId: "", tripCode: "", error: error.message };
  }

  const result = data as {
    success: boolean;
    trip_id?: string;
    trip_code?: string;
    error?: string;
  };

  if (!result.success || !result.trip_id || !result.trip_code) {
    const msg = result.error ?? "Failed to create trip — please try again.";
    return { tripId: "", tripCode: "", error: msg };
  }

  return { tripId: result.trip_id, tripCode: result.trip_code, error: null };
}

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
    // Also allow the driver who is assigned via driver_id column (migration 023)
    if (
      existing.created_by !== userId &&
      existing.assigned_to !== userId &&
      (existing as any).driver_id !== userId
    ) {
      return {
        trip: null,
        error: "You are not authorized to submit evidence for this trip.",
      };
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
  const { data, error } = await supabase
    .from("trips")
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error("[trips] upsertTrip insert:", error.message);
    return {
      trip: null,
      error: "Failed to create trip record. Please try again.",
    };
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
  status: Trip["status"],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("trips")
    .update({ status })
    .eq("id", tripId);
  if (error) return { error: error.message };
  return { error: null };
}
