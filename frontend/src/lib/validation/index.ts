/**
 * Zod validation schemas shared between the user website and (eventually) the admin website.
 *
 * Import these schemas for form validation and server-side input checking.
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
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ------------------------------------
// Trip & Evidence
// ------------------------------------
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const VALID_TRIP_STAGES = ["first_mile", "mid_mile", "last_mile"] as const;

export const tripStageSchema = z.enum(VALID_TRIP_STAGES, {
  errorMap: () => ({ message: "Please select a trip stage" }),
});

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

export const fileValidationSchema = z.object({
  name: z.string(),
  type: z.enum(ALLOWED_MIME_TYPES, { message: "Only JPG, PNG, or WebP images are allowed" }),
  size: z.number().max(MAX_FILE_SIZE_BYTES, "File must not exceed 10 MB"),
});

export function validateFile(file: File): { valid: boolean; error: string | null } {
  const result = fileValidationSchema.safeParse({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!result.success) {
    return { valid: false, error: result.error.errors[0]?.message ?? "Invalid file" };
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

// ------------------------------------
// Profile
// ------------------------------------
export const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  phone: z.string().max(20).optional(),
  district: z.string().max(100).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
