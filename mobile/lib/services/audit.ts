/**
 * Audit service — React Native.
 */
import { supabase } from "@/lib/supabase/client";
import type { AuditLog } from "@/lib/supabase/types";

export async function getAuditLogsForTrip(tripId: string): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[audit] getAuditLogsForTrip:", error.message);
    return [];
  }
  return (data ?? []) as AuditLog[];
}

export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    trip_created: "Trip created",
    trip_assigned: "Trip assigned",
    evidence_uploaded: "Evidence uploaded",
    verification_queued: "Verification queued",
    verification_completed: "Verification completed",
    manual_review_requested: "Manual review requested",
    manual_review_resolved: "Manual review resolved",
    trip_status_updated: "Trip status updated",
    location_recorded: "Location recorded",
  };
  return labels[action] ?? action;
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
