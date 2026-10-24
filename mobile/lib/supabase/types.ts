/**
 * TypeScript types derived from the GrainShield AI Supabase database schema.
 * Kept in sync with frontend/src/lib/supabase/types.ts
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
  | "pending"
  | "processing"
  | "pass"
  | "retake"
  | "manual_review"
  | "error";
export type ReviewStatus =
  | "pending"
  | "assigned"
  | "in_review"
  | "resolved"
  | "escalated";

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
  driver_name?: string | null;
  driver_phone?: string | null;
  stage: TripStage;
  origin?: string | null;
  destination?: string | null;
  created_by: string;
  assigned_to?: string | null;
  organization_id?: string | null;
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
  image_quality?: string | null;
  vehicle_detected?: boolean | null;
  expected_plate?: string | null;
  detected_plate?: string | null;
  plate_match?: boolean | null;
  vehicle_type?: string | null;
  evidence_checks?: Record<string, unknown> | null;
  confidence?: number | null;
  decision?: string | null;
  explanation?: string | null;
  processor_version?: string | null;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  raw_output?: Record<string, unknown> | null;
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
  user_notes?: string | null;
  status: ReviewStatus;
  assigned_reviewer?: string | null;
  reviewer_notes?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
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
