/**
 * Verification service — React Native.
 * Logic identical to web version; Supabase Realtime works the same in RN.
 */
import { supabase } from "@/lib/supabase/client";
import type { VerificationResult } from "@/lib/supabase/types";

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

export async function getVerificationById(
  verificationId: string
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

export async function createPendingVerification(params: {
  tripId: string;
  evidenceId: string;
  expectedPlate: string;
}): Promise<{ id: string | null; error: string | null }> {
  const { tripId, evidenceId, expectedPlate } = params;
  const payload = {
    trip_id: tripId,
    evidence_id: evidenceId,
    status: "pending" as const,
    expected_plate: expectedPlate.toUpperCase(),
  };
  const { data, error } = await supabase
    .from("verification_results")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("[verification] createPendingVerification:", error.message);
    return { id: null, error: "Could not queue verification. Please try again." };
  }
  return { id: (data as { id: string }).id, error: null };
}

export function subscribeToVerification(
  verificationId: string,
  onUpdate: (result: VerificationResult) => void
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
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToTripVerifications(
  tripId: string,
  onUpdate: (result: VerificationResult) => void
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
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
