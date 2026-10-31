/**
 * GrainShield AI Admin — Real Supabase Query Functions
 * Replaces hardcoded mock data with live Supabase queries.
 * All queries rely on DB-level RLS (is_admin()) for authorization.
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
} from "./supabase";

// ---------------------------------------------------------------------------
// Dashboard Statistics
// ---------------------------------------------------------------------------
export async function getDashboardStats() {
  const [tripsRes, reviewRes, passRes, processingRes] = await Promise.all([
    supabase.from("trips").select("id", { count: "exact", head: true }),
    supabase
      .from("manual_review_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "assigned", "in_review"]),
    supabase
      .from("verification_results")
      .select("id", { count: "exact", head: true })
      .eq("status", "pass"),
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing"),
  ]);
  return {
    totalTrips: tripsRes.count ?? 0,
    pendingReview: reviewRes.count ?? 0,
    passed: passRes.count ?? 0,
    processing: processingRes.count ?? 0,
    error:
      tripsRes.error?.message ??
      reviewRes.error?.message ??
      passRes.error?.message ??
      processingRes.error?.message ??
      null,
  };
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------
export interface TripsFilter {
  page?: number;
  pageSize?: number;
  stage?: TripStage | "";
  status?: TripStatus | "";
  search?: string;
}

export async function getTrips({
  page = 1,
  pageSize = 20,
  stage = "",
  status = "",
  search = "",
}: TripsFilter = {}) {
  let query = supabase
    .from("trips")
    .select(
      "id, trip_code, vehicle_number, driver_name, driver_phone, stage, origin, destination, status, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (stage) query = query.eq("stage", stage);
  if (status) query = query.eq("status", status);
  if (search)
    query = query.or(
      `trip_code.ilike.%${search}%,vehicle_number.ilike.%${search}%,driver_name.ilike.%${search}%`
    );

  const { data, error, count } = await query;
  return {
    trips: (data as Trip[]) ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function getTripById(tripId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  return { trip: data as Trip | null, error: error?.message ?? null };
}

export async function updateTripStatus(tripId: string, status: TripStatus) {
  const { error } = await supabase.from("trips").update({ status }).eq("id", tripId);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Manual Review Queue
// ---------------------------------------------------------------------------
export interface ReviewQueueFilter {
  page?: number;
  pageSize?: number;
  stage?: TripStage | "";
  reviewStatus?: string;
}

export async function getReviewQueue({
  page = 1,
  pageSize = 20,
  stage = "",
  reviewStatus = "",
}: ReviewQueueFilter = {}) {
  let query = supabase
    .from("manual_review_requests")
    .select(
      `
      id, status, user_notes, created_at, resolved_at, reviewer_notes,
      trips!inner(id, trip_code, vehicle_number, stage, origin, destination, status),
      trip_evidence!inner(id, original_filename, storage_path, uploaded_at)
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (reviewStatus) query = query.eq("status", reviewStatus);
  else query = query.in("status", ["pending", "assigned", "in_review"]);

  const { data, error, count } = await query;
  return {
    reviews: data ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function resolveReview(
  reviewId: string,
  decision: "resolved" | "escalated",
  notes: string
) {
  const { error } = await supabase
    .from("manual_review_requests")
    .update({
      status: decision,
      reviewer_notes: notes,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Trip Detail (evidence + verifications + reviews)
// ---------------------------------------------------------------------------
export async function getTripDetail(tripId: string) {
  const [tripRes, evidenceRes, verificationRes, reviewRes] = await Promise.all([
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
  ]);

  return {
    trip: tripRes.data as Trip | null,
    evidence: (evidenceRes.data as TripEvidence[]) ?? [],
    verifications: (verificationRes.data as VerificationResult[]) ?? [],
    reviews: (reviewRes.data as ManualReviewRequest[]) ?? [],
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
  page?: number;
  pageSize?: number;
  tripId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
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
// Reports — Aggregated trip stats
// ---------------------------------------------------------------------------
export interface ReportStatsFilter {
  stage?: TripStage | "";
  periodDays?: number; // 0 = all time, 7 = last 7 days, 30 = last 30 days, 90 = this quarter
}

export async function getReportStats({ stage = "", periodDays = 0 }: ReportStatsFilter = {}) {
  let query = supabase.from("trips").select("origin, status, stage, created_at");

  if (stage) query = query.eq("stage", stage);
  if (periodDays > 0) {
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;

  if (error || !data) return { districts: [], error: error?.message ?? null };

  // Aggregate by district (origin)
  const districtMap: Record<
    string,
    { total: number; pass: number; review: number; rejected: number }
  > = {};

  for (const trip of data) {
    const district = trip.origin ?? "Unknown";
    if (!districtMap[district]) {
      districtMap[district] = { total: 0, pass: 0, review: 0, rejected: 0 };
    }
    districtMap[district].total++;
    if (trip.status === "pass" || trip.status === "completed") districtMap[district].pass++;
    else if (trip.status === "manual_review") districtMap[district].review++;
    else if (trip.status === "rejected") districtMap[district].rejected++;
  }

  const districts = Object.entries(districtMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.total - a.total); // highest traffic first

  return { districts, error: null };
}

// ---------------------------------------------------------------------------
// Profiles (admin user management)
// ---------------------------------------------------------------------------
export async function getProfiles({ page = 1, pageSize = 50, search = "" } = {}) {
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, role, district, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search)
    query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);

  const { data, error, count } = await query;
  return {
    profiles: (data as Profile[]) ?? [],
    total: count ?? 0,
    error: error?.message ?? null,
  };
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

/**
 * Returns the latest GPS ping for every active (processing/submitted) trip.
 * Falls back to empty array when trip_locations table is empty.
 */
export async function getActiveTripLocations(): Promise<{
  locations: ActiveTripLocation[];
  error: string | null;
}> {
  // Get active trips
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

  // Get latest location per trip
  const { data: locs, error: locErr } = await supabase
    .from("trip_locations")
    .select("trip_id, latitude, longitude, accuracy_meters, recorded_at")
    .in("trip_id", tripIds)
    .order("recorded_at", { ascending: false });

  if (locErr) {
    return { locations: [], error: locErr.message };
  }

  // Keep only the latest location per trip
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
