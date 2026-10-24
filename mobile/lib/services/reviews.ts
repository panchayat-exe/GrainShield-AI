/**
 * Manual review service — React Native.
 */
import { supabase } from "@/lib/supabase/client";
import type { ManualReviewRequest } from "@/lib/supabase/types";
import { manualReviewSchema } from "@/lib/validation";

export async function submitManualReview(params: {
  tripId: string;
  evidenceId: string;
  requestedBy: string;
  notes?: string;
}): Promise<{ request: ManualReviewRequest | null; error: string | null }> {
  const parsed = manualReviewSchema.safeParse({
    trip_id: params.tripId,
    evidence_id: params.evidenceId,
    notes: params.notes,
  });
  if (!parsed.success) {
    return { request: null, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { data: existing } = await supabase
    .from("manual_review_requests")
    .select("id, status")
    .eq("evidence_id", params.evidenceId)
    .in("status", ["pending", "assigned", "in_review"])
    .maybeSingle();

  if (existing) {
    return { request: null, error: "A review request is already pending for this evidence." };
  }

  const payload = {
    trip_id: params.tripId,
    evidence_id: params.evidenceId,
    requested_by: params.requestedBy,
    user_notes: params.notes ?? null,
    status: "pending" as const,
  };
  const { data, error } = await supabase
    .from("manual_review_requests")
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error("[review] submitManualReview:", error.message);
    return { request: null, error: "Failed to submit review request. Please try again." };
  }
  return { request: data as ManualReviewRequest, error: null };
}

export async function getReviewsForTrip(tripId: string): Promise<ManualReviewRequest[]> {
  const { data, error } = await supabase
    .from("manual_review_requests")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[review] getReviewsForTrip:", error.message);
    return [];
  }
  return (data ?? []) as ManualReviewRequest[];
}
