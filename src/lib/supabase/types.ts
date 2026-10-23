/**
 * TypeScript types derived from the GrainShield AI Supabase database schema.
 *
 * Keep these in sync with the SQL migrations in supabase/migrations/.
 * The admin website can import these same types by copying this file or
 * by generating them from the live schema with `supabase gen types typescript`.
 */

export type UserRole = "user" | "officer" | "admin" | "super_admin";
export type TripStage = "first_mile" | "mid_mile" | "last_mile";
export type TripStatus =
  | "draft"
  | "submitted"
  | "processing"
  | "pass"
  | "retake"
  | "manual_review"
  | "rejected"
  | "completed";
export type VerificationStatus =
  "pending" | "processing" | "pass" | "retake" | "manual_review" | "error";
export type ReviewStatus = "pending" | "assigned" | "in_review" | "resolved" | "escalated";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  district: string | null;
  organization_id: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Trip {
  id: string;
  trip_code: string;
  vehicle_number: string;
  driver_name: string | null;
  driver_phone: string | null;
  stage: TripStage;
  origin: string | null;
  destination: string | null;
  created_by: string;
  assigned_to: string | null;
  organization_id: string | null;
  status: TripStatus;
  created_at: string;
  updated_at: string;
}

export interface TripEvidence {
  id: string;
  trip_id: string;
  uploaded_by: string;
  stage: TripStage;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  checksum: string | null;
  uploaded_at: string;
}

export interface VerificationResult {
  id: string;
  trip_id: string;
  evidence_id: string;
  status: VerificationStatus;
  image_quality: string | null;
  vehicle_detected: boolean | null;
  expected_plate: string | null;
  detected_plate: string | null;
  plate_match: boolean | null;
  vehicle_type: string | null;
  evidence_checks: Record<string, unknown> | null;
  confidence: number | null;
  decision: string | null;
  explanation: string | null;
  processor_version: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  raw_output: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TripLocation {
  id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  source: string;
  recorded_at: string;
  uploaded_by: string;
}

export interface ManualReviewRequest {
  id: string;
  trip_id: string;
  evidence_id: string;
  requested_by: string;
  user_notes: string | null;
  status: ReviewStatus;
  assigned_reviewer: string | null;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  trip_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------
// Supabase Database type map (used by the typed client)
// ---------------------------------------------------
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; email: string };
        Update: Partial<Omit<Profile, "id" | "created_at">>;
      };
      trips: {
        Row: Trip;
        // All nullable fields are optional on insert
        Insert: Pick<Trip, "trip_code" | "vehicle_number" | "stage" | "created_by" | "status"> &
          Partial<Pick<Trip, "id" | "driver_name" | "driver_phone" | "origin" | "destination" | "assigned_to" | "organization_id">>;
        Update: Partial<Omit<Trip, "id" | "created_at" | "created_by">>;
      };
      trip_evidence: {
        Row: TripEvidence;
        // checksum is nullable so optional on insert
        Insert: Pick<TripEvidence, "trip_id" | "uploaded_by" | "stage" | "storage_path" | "original_filename" | "mime_type" | "file_size"> &
          Partial<Pick<TripEvidence, "id" | "checksum">>;
        Update: never;
      };
      verification_results: {
        Row: VerificationResult;
        // All fields except the required ones are optional on insert
        Insert: Pick<VerificationResult, "trip_id" | "evidence_id" | "status"> &
          Partial<Omit<VerificationResult, "trip_id" | "evidence_id" | "status" | "created_at" | "updated_at">>;
        Update: Partial<Omit<VerificationResult, "id" | "created_at" | "trip_id" | "evidence_id">>;
      };
      trip_locations: {
        Row: TripLocation;
        Insert: Pick<TripLocation, "trip_id" | "uploaded_by" | "latitude" | "longitude" | "source" | "recorded_at"> &
          Partial<Pick<TripLocation, "id" | "accuracy_meters">>;
        Update: never;
      };
      manual_review_requests: {
        Row: ManualReviewRequest;
        Insert: Pick<ManualReviewRequest, "trip_id" | "evidence_id" | "requested_by" | "status"> &
          Partial<Pick<ManualReviewRequest, "id" | "user_notes" | "assigned_reviewer" | "reviewer_notes">>;
        Update: Partial<
          Pick<
            ManualReviewRequest,
            "status" | "assigned_reviewer" | "reviewer_notes" | "resolved_at"
          >
        >;
      };
      audit_logs: {
        Row: AuditLog;
        Insert: Omit<AuditLog, "id" | "created_at"> & { id?: string };
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_my_role: { Args: Record<string, never>; Returns: string };
      is_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      trip_stage: TripStage;
      trip_status: TripStatus;
      verification_status: VerificationStatus;
      review_status: ReviewStatus;
    };
  };
}
