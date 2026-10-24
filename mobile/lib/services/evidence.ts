/**
 * Evidence service — React Native.
 *
 * Key differences from the web version:
 * - No File object or WebCrypto API in React Native.
 * - Uses fetch() to read the image from a local URI as a blob/ArrayBuffer.
 * - Uploads via supabase.storage.from().upload() with the blob.
 * - SHA-256 checksum omitted (WebCrypto unavailable in RN; could add react-native-crypto if needed).
 *
 * Storage bucket: trip-evidence (private, RLS-enforced policies)
 * Path convention: {uploader_uuid}/{trip_uuid}/{uuid}_{original_filename}
 */
import { supabase } from "@/lib/supabase/client";
import { validatePhotoAsset } from "@/lib/validation";
import type { TripEvidence, TripStage } from "@/lib/supabase/types";
import * as FileSystem from "expo-file-system";

const BUCKET = "trip-evidence";

/**
 * Upload a photograph from a local URI and insert the evidence record.
 *
 * @param params.uri        Local file URI from expo-image-picker
 * @param params.mimeType   MIME type reported by the picker
 * @param params.fileSize   File size in bytes reported by the picker
 * @param params.fileName   Original filename (e.g. "photo.jpg")
 * @param params.tripId     UUID of the trip
 * @param params.stage      Trip stage
 * @param params.userId     Authenticated user's UUID
 */
export async function uploadEvidence(params: {
  uri: string;
  mimeType: string;
  fileSize: number;
  fileName: string;
  tripId: string;
  stage: TripStage;
  userId: string;
}): Promise<{ evidence: TripEvidence | null; error: string | null }> {
  const { uri, mimeType, fileSize, fileName, tripId, stage, userId } = params;

  // Client-side validation
  const validation = validatePhotoAsset({ mimeType, fileSize });
  if (!validation.valid) {
    return { evidence: null, error: validation.error };
  }

  // Build storage path
  const ext = fileName.split(".").pop() ?? "jpg";
  const uniqueId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const storagePath = `${userId}/${tripId}/${uniqueId}.${ext}`;

  // Read file as base64 and convert to ArrayBuffer for upload
  let uploadError: string | null = null;
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Convert base64 to Uint8Array
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes.buffer, {
      cacheControl: "3600",
      upsert: false,
      contentType: mimeType,
    });
    if (error) {
      uploadError = error.message;
    }
  } catch (err) {
    uploadError = err instanceof Error ? err.message : "Unknown upload error";
  }

  if (uploadError) {
    console.error("[evidence] upload error:", uploadError);
    return { evidence: null, error: "File upload failed. Please try again." };
  }

  // Insert DB record only after successful upload
  const payload = {
    trip_id: tripId,
    uploaded_by: userId,
    stage,
    storage_path: storagePath,
    original_filename: fileName,
    mime_type: mimeType,
    file_size: fileSize,
    checksum: null as string | null,
  };
  const { data, error: dbError } = await supabase
    .from("trip_evidence")
    .insert(payload)
    .select()
    .single();

  if (dbError) {
    console.error("[evidence] db insert error:", dbError.message);
    // Best-effort cleanup
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { evidence: null, error: "Failed to save evidence record. The file has been removed." };
  }

  return { evidence: data as TripEvidence, error: null };
}

export async function getEvidenceForTrip(tripId: string): Promise<TripEvidence[]> {
  const { data, error } = await supabase
    .from("trip_evidence")
    .select("*")
    .eq("trip_id", tripId)
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error("[evidence] getEvidenceForTrip:", error.message);
    return [];
  }
  return (data ?? []) as TripEvidence[];
}

/**
 * Create a short-lived signed URL for viewing a private evidence photograph.
 * Expires in 60 seconds.
 */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) {
    console.error("[evidence] getSignedUrl:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
