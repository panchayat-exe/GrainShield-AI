/**
 * Verification service — reads and monitors verification results.
 *
 * Actual AI verification is performed by an external processor (not implemented here).
 * This service provides the integration point and read operations.
 *
 * See docs/ADMIN_INTEGRATION.md §8 for how to connect a real AI processor.
 */
import { supabase } from "@/lib/supabase/client";
import type { VerificationResult } from "@/lib/supabase/types";

/** Get the latest verification result for a given trip. */
export async function getLatestVerification(tripId: string): Promise<VerificationResult | null> {
  const { data, error } = await supabase
    .from("verification_results")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[verification] getLatestVerification:", error.message);
    return null;
  }
  return data as VerificationResult | null;
}

/** Get a specific verification result by ID. */
export async function getVerificationById(
  verificationId: string,
): Promise<VerificationResult | null> {
  const { data, error } = await supabase
    .from("verification_results")
    .select("*")
    .eq("id", verificationId)
    .maybeSingle();

  if (error) {
    console.error("[verification] getVerificationById:", error.message);
    return null;
  }
  return data as VerificationResult | null;
}

/** Get all verification results for a trip, newest first. */
export async function getVerificationsForTrip(tripId: string): Promise<VerificationResult[]> {
  const { data, error } = await supabase
    .from("verification_results")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[verification] getVerificationsForTrip:", error.message);
    return [];
  }
  return (data ?? []) as VerificationResult[];
}

/**
 * Create a pending verification record after evidence upload.
 * The actual processing is performed by an external AI worker that updates this record.
 *
 * Integration point: the AI worker should PATCH /verification_results/{id}
 * with status, detected values, and decision, using a service-role key stored
 * only on the worker's server. See docs/ADMIN_INTEGRATION.md §8.
 */
export async function createPendingVerification(params: {
  tripId: string;
  evidenceId: string;
  expectedPlate: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { tripId, evidenceId, expectedPlate } = params;

  const { data, error } = await supabase
    .from("verification_results")
    .insert({
      trip_id: tripId,
      evidence_id: evidenceId,
      status: "pending",
      expected_plate: expectedPlate.toUpperCase(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[verification] createPendingVerification:", error.message);
    return { id: null, error: "Could not queue verification. Please try again." };
  }
  return { id: (data as { id: string }).id, error: null };
}

/**
 * Subscribe to real-time status changes for a specific verification record.
 * Returns an unsubscribe function — call it when the component unmounts.
 */
export function subscribeToVerification(
  verificationId: string,
  onUpdate: (result: VerificationResult) => void,
): () => void {
  const channel = supabase
    .channel(`verification:${verificationId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "verification_results",
        filter: `id=eq.${verificationId}`,
      },
      (payload) => {
        onUpdate(payload.new as VerificationResult);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to verification changes for a trip (any evidence).
 */
export function subscribeToTripVerifications(
  tripId: string,
  onUpdate: (result: VerificationResult) => void,
): () => void {
  const channel = supabase
    .channel(`trip-verifications:${tripId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "verification_results",
        filter: `trip_id=eq.${tripId}`,
      },
      (payload) => {
        if (payload.new && typeof payload.new === "object") {
          onUpdate(payload.new as VerificationResult);
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
