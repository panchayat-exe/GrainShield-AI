/**
 * Zod validation schemas for the mobile app.
 * Identical to frontend/src/lib/validation/index.ts — pure TypeScript, no DOM.
 */
import { z } from "zod";

// ------------------------------------
// Auth
// ------------------------------------
export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

// ------------------------------------
// Trip & Evidence
// ------------------------------------
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const VALID_TRIP_STAGES = ["first_mile", "mid_mile", "last_mile"] as const;

export const tripStageSchema = z.enum(VALID_TRIP_STAGES);

/**
 * @deprecated Requires a manually-entered trip_code.
 * Use tripSubmitSchema for citizen submission — backend auto-generates Trip ID.
 */
export const uploadSchema = z.object({
  trip_code: z
    .string()
    .min(1, "Trip ID is required")
    .max(50, "Trip ID too long")
    .regex(/^[A-Z0-9\-_]+$/i, "Trip ID may only contain letters, digits, hyphens, and underscores"),
  vehicle_number: z
    .string()
    .min(1, "Vehicle number is required")
    .max(20, "Vehicle number too long")
    .regex(/^[A-Z0-9 ]+$/i, "Invalid vehicle number format"),
  stage: tripStageSchema,
});
export type UploadInput = z.infer<typeof uploadSchema>;

/**
 * Citizen trip submission schema — no trip_code.
 * The backend generates GS-YYYY-NNNNNN automatically via citizen_create_trip() RPC.
 */
export const tripSubmitSchema = z.object({
  vehicle_number: z
    .string()
    .min(4, "Vehicle number must be at least 4 characters")
    .max(20, "Vehicle number too long")
    .regex(/^[A-Z0-9 ]+$/i, "Invalid vehicle number format"),
  stage: tripStageSchema,
  origin: z.string().max(200, "Origin too long").optional(),
  destination: z.string().max(200, "Destination too long").optional(),
  commodity: z.string().max(100, "Commodity too long").optional(),
});
export type TripSubmitInput = z.infer<typeof tripSubmitSchema>;

/**
 * Validate a photo before upload.
 * In React Native we get: uri, type (MIME string), fileSize from ImagePicker.
 */
export function validatePhotoAsset(asset: {
  mimeType?: string | null;
  fileSize?: number | null;
}): { valid: boolean; error: string | null } {
  const mime = asset.mimeType ?? "";
  if (!ALLOWED_MIME_TYPES.includes(mime as (typeof ALLOWED_MIME_TYPES)[number])) {
    return { valid: false, error: "Only JPG, PNG, or WebP images are allowed." };
  }
  const size = asset.fileSize ?? 0;
  if (size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: "File must not exceed 10 MB." };
  }
  if (size === 0) {
    return { valid: false, error: "Selected file appears empty." };
  }
  return { valid: true, error: null };
}

// ------------------------------------
// Manual Review
// ------------------------------------
export const manualReviewSchema = z.object({
  trip_id: z.string().uuid("Invalid trip ID"),
  evidence_id: z.string().uuid("Invalid evidence ID"),
  notes: z.string().max(1000, "Notes must not exceed 1000 characters").optional(),
});
export type ManualReviewInput = z.infer<typeof manualReviewSchema>;
