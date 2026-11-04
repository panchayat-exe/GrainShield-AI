/**
 * GrainShield AI Admin — Supabase Query & Mutation Services
 * Genuine Supabase backend operations backed by RLS and database RPCs.
 */
import { supabase } from "./supabase";
import type {
  Trip,
  TripEvidence,
  VerificationResult,
  ManualReviewRequest,
  AuditLog,
  Profile,
  TripStage,
  TripStatus,
  UserRole,
} from "./supabase";
import { canAssignRole, type AdminUser } from "./admin-auth";

// ---------------------------------------------------------------------------
// Dashboard Statistics
// ---------------------------------------------------------------------------
export async function getDashboardStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    tripsRes,
    reviewRes,
    passRes,
    processingRes,
    rejectedRes,
    retakeRes,
    firstMileRes,
    midMileRes,
    lastMileRes,
    todayRes,
  ] = await Promise.all([
    supabase.from("trips").select("id", { count: "exact", head: true }),
    supabase
      .from("manual_review_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "assigned", "in_review"]),
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .in("status", ["pass", "completed"]),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("status", "rejected"),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("status", "retake"),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("stage", "first_mile"),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("stage", "mid_mile"),
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("stage", "last_mile"),
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
  ]);

  return {
    totalTrips: tripsRes.count ?? 0,
    pendingReview: reviewRes.count ?? 0,
    passed: passRes.count ?? 0,
    processing: processingRes.count ?? 0,
    rejected: rejectedRes.count ?? 0,
    retake: retakeRes.count ?? 0,
    firstMile: firstMileRes.count ?? 0,
    midMile: midMileRes.count ?? 0,
    lastMile: lastMileRes.count ?? 0,
    todayCount: todayRes.count ?? 0,
    error:
      tripsRes.error?.message ??
      reviewRes.error?.message ??
      passRes.error?.message ??
      processingRes.error?.message ??
      null,
  };
}

// ---------------------------------------------------------------------------
// Trips Management
// ---------------------------------------------------------------------------
export interface TripsFilter {
  page?: number | undefined;
  pageSize?: number | undefined;
  stage?: TripStage | "" | undefined;
  status?: TripStatus | "" | undefined;
  search?: string | undefined;
  district?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function getTrips({
  page = 1,
  pageSize = 20,
  stage = "",
  status = "",
  search = "",
  district = "",
  dateFrom = "",
  dateTo = "",
}: TripsFilter = {}) {
  let query = supabase
    .from("trips")
    .select(
      "id, trip_code, vehicle_number, driver_name, driver_phone, stage, origin, destination, status, created_at, updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (stage) query = query.eq("stage", stage);
  if (status) query = query.eq("status", status);
  if (district) query = query.or(`origin.ilike.%${district}%,destination.ilike.%${district}%`);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59Z");
  if (search)
    query = query.or(
      `trip_code.ilike.%${search}%,vehicle_number.ilike.%${search}%,driver_name.ilike.%${search}%`,
    );

  const { data, error, count } = await query;
  return {
    trips: (data as Trip[]) ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function getTripById(tripId: string) {
  const { data, error } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
  return { trip: data as Trip | null, error: error?.message ?? null };
}

export interface CreateTripInput {
  trip_code: string;
  vehicle_number: string;
  driver_name?: string | undefined;
  driver_phone?: string | undefined;
  stage: TripStage;
  origin?: string | undefined;
  destination?: string | undefined;
  created_by: string;
}

/** Creates a new transport trip and logs an audit record. */
export async function createAdminTrip(input: CreateTripInput) {
  const cleanPlate = input.vehicle_number.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Try RPC first
  const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_create_trip", {
    p_trip_code: input.trip_code.trim(),
    p_vehicle_number: cleanPlate,
    p_driver_name: input.driver_name?.trim() ?? "",
    p_driver_phone: input.driver_phone?.trim() ?? "",
    p_stage: input.stage,
    p_origin: input.origin?.trim() ?? "",
    p_destination: input.destination?.trim() ?? "",
  });

  if (!rpcErr && rpcData?.success) {
    return { trip: rpcData, error: null };
  }

  // Fallback to direct insert with audit logging
  const { data, error } = await supabase
    .from("trips")
    .insert({
      trip_code: input.trip_code.trim(),
      vehicle_number: cleanPlate,
      driver_name: input.driver_name?.trim() || null,
      driver_phone: input.driver_phone?.trim() || null,
      stage: input.stage,
      origin: input.origin?.trim() || null,
      destination: input.destination?.trim() || null,
      created_by: input.created_by,
      status: "submitted",
    })
    .select()
    .single();

  if (error) return { trip: null, error: error.message };

  // Log audit record
  await supabase.from("audit_logs").insert({
    actor_id: input.created_by,
    action: "trip_created",
    entity_type: "trips",
    entity_id: data.id,
    trip_id: data.id,
    metadata: {
      trip_code: input.trip_code,
      vehicle_number: cleanPlate,
      stage: input.stage,
    },
  });

  return { trip: data as Trip, error: null };
}

export async function updateTripStatus(tripId: string, status: TripStatus, actorId?: string) {
  const { error } = await supabase
    .from("trips")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", tripId);
  if (!error && actorId) {
    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "trip_status_updated",
      entity_type: "trips",
      entity_id: tripId,
      trip_id: tripId,
      metadata: { new_status: status },
    });
  }
  return { error: error?.message ?? null };
}

/** Fetches full GPS breadcrumb history for a trip. */
export async function getTripLocations(tripId: string) {
  const { data, error } = await supabase
    .from("trip_locations")
    .select("*")
    .eq("trip_id", tripId)
    .order("recorded_at", { ascending: true });

  return { locations: data ?? [], error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Manual Review Queue
// ---------------------------------------------------------------------------
export interface ReviewQueueFilter {
  page?: number | undefined;
  pageSize?: number | undefined;
  stage?: TripStage | "" | undefined;
  reviewStatus?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function getReviewQueue({
  page = 1,
  pageSize = 20,
  stage = "",
  reviewStatus = "",
  dateFrom = "",
  dateTo = "",
}: ReviewQueueFilter = {}) {
  let query = supabase
    .from("manual_review_requests")
    .select(
      `
      id, status, user_notes, created_at, resolved_at, reviewer_notes, assigned_reviewer,
      trips!inner(id, trip_code, vehicle_number, stage, origin, destination, status),
      trip_evidence(id, original_filename, storage_path, uploaded_at)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (reviewStatus) query = query.eq("status", reviewStatus);
  else query = query.in("status", ["pending", "assigned", "in_review"]);

  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59Z");

  const { data, error, count } = await query;
  return {
    reviews: data ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function assignReviewer(reviewId: string, reviewerId: string) {
  const { error } = await supabase
    .from("manual_review_requests")
    .update({
      assigned_reviewer: reviewerId,
      status: "assigned",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  return { error: error?.message ?? null };
}

export async function resolveReview(
  reviewId: string,
  decision: "resolved" | "escalated",
  notes: string,
) {
  const { error } = await supabase
    .from("manual_review_requests")
    .update({
      status: decision,
      reviewer_notes: notes,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  return { error: error?.message ?? null };
}

export interface ResolveManualReviewInput {
  reviewId: string;
  tripId: string;
  decision: "pass" | "retake" | "rejected";
  notes: string;
  reviewerId: string;
  reviewerEmail?: string | undefined;
}

/**
 * Resolves a manual review case atomically via the resolve_manual_review RPC (Migration 016).
 *
 * The RPC handles:
 *  - Authorization (officer/admin/super_admin only)
 *  - FOR UPDATE lock — prevents double-resolution race condition
 *  - Back-fills evidence_id if missing (fixes M013 multi-row subquery bug)
 *  - Updates verification_results WHERE evidence_id = ... (strict, not wildcard)
 *  - Sets consumed_at support for once-only override enforcement (Migration 015)
 *  - Updates trip status via state-machine trigger
 *  - Writes immutable audit log
 *
 * The JS multi-table fallback has been removed: the old fallback reproduced the
 * same multi-row bug (UPDATE verification_results WHERE trip_id = ...).
 * Any DB error is surfaced directly as actionable text to the officer UI.
 */
export async function resolveManualReview(input: ResolveManualReviewInput) {
  if (!input.notes || input.notes.trim().length < 5) {
    return { error: "Reviewer justification notes are mandatory (minimum 5 characters)." };
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc("resolve_manual_review", {
    p_review_id: input.reviewId,
    p_decision: input.decision,
    p_notes: input.notes.trim(),
  });

  if (rpcErr) {
    // Surface the actual DB error so officers see actionable text, e.g.:
    // "This review request has already been resolved by another officer."
    return { error: rpcErr.message ?? "Database error resolving review. Please retry." };
  }

  if (!rpcData?.success) {
    return {
      error:
        "Review resolution returned no confirmation. Please check the audit log and retry if needed.",
    };
  }

  return { success: true, error: null };
}

// ---------------------------------------------------------------------------
// Trip Detail (Evidence + Verifications + Reviews + Locations)
// ---------------------------------------------------------------------------
export async function getTripDetail(tripId: string) {
  const [tripRes, evidenceRes, verificationRes, reviewRes, locationsRes] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
    supabase
      .from("trip_evidence")
      .select("*")
      .eq("trip_id", tripId)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("verification_results")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false }),
    supabase
      .from("manual_review_requests")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false }),
    supabase
      .from("trip_locations")
      .select("*")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: true }),
  ]);

  return {
    trip: tripRes.data as Trip | null,
    evidence: (evidenceRes.data as TripEvidence[]) ?? [],
    verifications: (verificationRes.data as VerificationResult[]) ?? [],
    reviews: (reviewRes.data as ManualReviewRequest[]) ?? [],
    locations: locationsRes.data ?? [],
    error:
      tripRes.error?.message ??
      evidenceRes.error?.message ??
      verificationRes.error?.message ??
      reviewRes.error?.message ??
      null,
  };
}

// ---------------------------------------------------------------------------
// Evidence — Signed URLs for private storage
// ---------------------------------------------------------------------------
export async function getEvidenceSignedUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage
    .from("trip-evidence")
    .createSignedUrl(storagePath, expiresInSeconds);
  return { url: data?.signedUrl ?? null, error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------
export interface AuditLogFilter {
  page?: number | undefined;
  pageSize?: number | undefined;
  tripId?: string | undefined;
  action?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function getAuditLogs({
  page = 1,
  pageSize = 50,
  tripId = "",
  action = "",
  dateFrom = "",
  dateTo = "",
}: AuditLogFilter = {}) {
  let query = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, trip_id, metadata, created_at, actor_id", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (tripId) query = query.eq("trip_id", tripId);
  if (action) query = query.eq("action", action);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59Z");

  const { data, error, count } = await query;
  return {
    logs: (data as AuditLog[]) ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reports — Aggregated trip and verification statistics
// ---------------------------------------------------------------------------
export interface ReportStatsFilter {
  stage?: TripStage | "" | undefined;
  periodDays?: number | undefined;
  district?: string | undefined;
}

export async function getReportStats({
  stage = "",
  periodDays = 0,
  district = "",
}: ReportStatsFilter = {}) {
  let query = supabase.from("trips").select("origin, destination, status, stage, created_at");

  if (stage) query = query.eq("stage", stage);
  if (district && district !== "All Districts") {
    query = query.or(`origin.ilike.%${district}%,destination.ilike.%${district}%`);
  }
  if (periodDays > 0) {
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;

  if (error || !data) return { districts: [], error: error?.message ?? null };

  // Aggregate by district (origin or destination)
  const districtMap: Record<
    string,
    {
      total: number;
      pass: number;
      review: number;
      rejected: number;
      firstMile: number;
      lastMile: number;
    }
  > = {};

  for (const trip of data) {
    const dName = trip.origin || trip.destination || "General";
    if (!districtMap[dName]) {
      districtMap[dName] = { total: 0, pass: 0, review: 0, rejected: 0, firstMile: 0, lastMile: 0 };
    }
    districtMap[dName].total++;
    if (trip.status === "pass" || trip.status === "completed") districtMap[dName].pass++;
    else if (trip.status === "manual_review") districtMap[dName].review++;
    else if (trip.status === "rejected") districtMap[dName].rejected++;

    if (trip.stage === "first_mile") districtMap[dName].firstMile++;
    else if (trip.stage === "last_mile") districtMap[dName].lastMile++;
  }

  const districts = Object.entries(districtMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.total - a.total);

  return { districts, error: null };
}

/** Logs report export event in audit trail. */
export async function logReportExport(actorId: string, metadata: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action: "report_exported",
    entity_type: "reports",
    metadata,
  });
}

// ---------------------------------------------------------------------------
// Profiles & User Role Management
// ---------------------------------------------------------------------------
export async function getProfiles({ page = 1, pageSize = 50, search = "" } = {}) {
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, role, district, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);

  const { data, error, count } = await query;
  return {
    profiles: (data as Profile[]) ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

/** Updates user role with strict RBAC privilege checks. */
export async function updateUserRole(
  targetUserId: string,
  targetCurrentRole: UserRole,
  newRole: UserRole,
  caller: AdminUser | null | undefined,
) {
  // Validate authorization
  const authCheck = canAssignRole(caller, targetCurrentRole, newRole);
  if (!authCheck.allowed) {
    return { error: authCheck.reason ?? "Permission denied." };
  }

  // 1. Try secure RPC
  const { data: rpcData, error: rpcErr } = await supabase.rpc("manage_user_role", {
    target_user_id: targetUserId,
    new_role: newRole,
  });

  if (!rpcErr && rpcData?.success) {
    return { success: true, error: null };
  }

  // 2. Direct update fallback (service_role or authorized session)
  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", targetUserId);

  if (error) return { error: error.message };

  // Write audit log
  if (caller) {
    await supabase.from("audit_logs").insert({
      actor_id: caller.id,
      action: "user_role_changed",
      entity_type: "profiles",
      entity_id: targetUserId,
      metadata: {
        old_role: targetCurrentRole,
        new_role: newRole,
        assigned_by: caller.id,
      },
    });
  }

  return { success: true, error: null };
}

// ---------------------------------------------------------------------------
// Live Tracking — Latest GPS Location per Active Trip
// ---------------------------------------------------------------------------
export type ActiveTripLocation = {
  tripId: string;
  tripCode: string;
  vehicleNumber: string;
  driverName: string | null;
  stage: TripStage;
  status: TripStatus;
  origin: string | null;
  destination: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
};

export async function getActiveTripLocations(): Promise<{
  locations: ActiveTripLocation[];
  error: string | null;
}> {
  const { data: trips, error: tripErr } = await supabase
    .from("trips")
    .select("id, trip_code, vehicle_number, driver_name, stage, status, origin, destination")
    .in("status", ["submitted", "processing", "manual_review"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (tripErr || !trips?.length) {
    return { locations: [], error: tripErr?.message ?? null };
  }

  const tripIds = trips.map((t) => t.id as string);

  const { data: locs, error: locErr } = await supabase
    .from("trip_locations")
    .select("trip_id, latitude, longitude, accuracy_meters, recorded_at")
    .in("trip_id", tripIds)
    .order("recorded_at", { ascending: false });

  if (locErr) {
    return { locations: [], error: locErr.message };
  }

  const seen = new Set<string>();
  const latestByTrip = (locs ?? []).filter((l) => {
    if (seen.has(l.trip_id)) return false;
    seen.add(l.trip_id);
    return true;
  });

  const locations: ActiveTripLocation[] = latestByTrip.map((loc) => {
    const trip = trips.find((t) => t.id === loc.trip_id)!;
    return {
      tripId: trip.id,
      tripCode: trip.trip_code,
      vehicleNumber: trip.vehicle_number,
      driverName: trip.driver_name ?? null,
      stage: trip.stage as TripStage,
      status: trip.status as TripStatus,
      origin: trip.origin ?? null,
      destination: trip.destination ?? null,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracyMeters: loc.accuracy_meters ?? null,
      recordedAt: loc.recorded_at,
    };
  });

  return { locations, error: null };
}
