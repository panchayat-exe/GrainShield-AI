/**
 * Offline Outbox System for GrainShield AI — Driver Field Operations.
 *
 * APPROVED PRODUCT SPECIFICATION (Option A):
 * - The driver mobile application is restricted to driver operational workflows.
 * - The driver application MUST NOT create new citizen trip requests.
 * - Inappropriate use of `citizen_create_trip()` is completely removed.
 * - Every queued outbox event MUST reference an existing, authorized trip (tripId + tripCode).
 * - Supported event types:
 *     1. 'checkpoint_evidence' — Checkpoint photographs (CP1-CP4) captured offline
 *     2. 'gps_location'        — GPS telemetry recorded while out of cellular range
 *     3. 'trip_status_update'  — Status transitions on assigned trips
 *
 * Storage Strategy:
 * 1. Evidence photos are stored persistently in `${FileSystem.documentDirectory}grainshield_outbox/`
 * 2. Queued items are stored in AsyncStorage under `@grainshield_outbox_queue`.
 * 3. Once network connectivity is restored, `syncAllOutbox()` or `syncOutboxItem()` pushes items
 *    to Supabase Storage and database without ever calling citizen trip creation.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import { supabase } from "@/lib/supabase/client";
import type { TripStage } from "@/lib/supabase/types";

const OUTBOX_STORAGE_KEY = "@grainshield_outbox_queue";
const OFFLINE_DIR_NAME = "grainshield_outbox/";

export type OutboxEventType =
  "checkpoint_evidence" | "gps_location" | "trip_status_update";

export interface OutboxItem {
  id: string;
  eventType: OutboxEventType;
  tripId: string; // Mandatory UUID of the assigned trip
  tripCode: string; // Mandatory GS-YYYY-NNNNNN human-readable ID
  vehicleNumber: string;
  stage: TripStage;
  checkpointNumber?: number; // 1, 2, 3, or 4
  photoUri?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  statusUpdate?: string;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  errorMessage?: string | null;
}

/**
 * Returns the persistent outbox directory URI.
 */
function getOutboxDirectory(): string {
  const base = FileSystem.documentDirectory ?? "";
  return `${base}${OFFLINE_DIR_NAME}`;
}

/**
 * Ensures the local outbox directory exists on the device.
 */
async function ensureOutboxDirExists(): Promise<string> {
  const dir = getOutboxDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Retrieve all items currently in the offline outbox.
 */
export async function getOutboxItems(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OutboxItem[];
  } catch (err) {
    console.error("[outbox] Failed to read outbox items:", err);
    return [];
  }
}

/**
 * Save a checkpoint evidence photograph event to the offline outbox.
 * Every event MUST reference an existing, authorized trip ID and code.
 */
export async function saveEvidenceToOutbox(params: {
  tripId: string;
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  checkpointNumber?: number;
  sourcePhotoUri: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ item: OutboxItem | null; error: string | null }> {
  try {
    if (!params.tripId || !params.tripCode) {
      return {
        item: null,
        error:
          "Cannot queue offline evidence without a valid assigned trip ID.",
      };
    }

    const id =
      "outbox_ev_" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
    const mimeType = params.mimeType ?? "image/jpeg";
    const ext = params.originalFileName?.split(".").pop() ?? "jpg";
    const persistentFileName = `${id}.${ext}`;

    const dir = await ensureOutboxDirExists();
    const destinationUri = `${dir}${persistentFileName}`;

    await FileSystem.copyAsync({
      from: params.sourcePhotoUri,
      to: destinationUri,
    });

    const newItem: OutboxItem = {
      id,
      eventType: "checkpoint_evidence",
      tripId: params.tripId,
      tripCode: params.tripCode.trim().toUpperCase(),
      vehicleNumber: params.vehicleNumber.trim().toUpperCase(),
      stage: params.stage,
      checkpointNumber: params.checkpointNumber,
      photoUri: destinationUri,
      originalFileName: params.originalFileName ?? persistentFileName,
      mimeType,
      fileSize: params.fileSize ?? 0,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      createdAt: new Date().toISOString(),
      status: "pending",
      errorMessage: null,
    };

    const current = await getOutboxItems();
    const updated = [newItem, ...current];
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(updated));

    return { item: newItem, error: null };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to save offline evidence.";
    console.error("[outbox] saveEvidenceToOutbox error:", msg);
    return { item: null, error: msg };
  }
}

/**
 * Backward-compatible wrapper for evidence saving.
 */
export async function saveToOutbox(params: {
  tripId?: string;
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  sourcePhotoUri: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  checkpointNumber?: number;
}): Promise<{ item: OutboxItem | null; error: string | null }> {
  return saveEvidenceToOutbox({
    tripId: params.tripId ?? "",
    tripCode: params.tripCode,
    vehicleNumber: params.vehicleNumber,
    stage: params.stage,
    checkpointNumber: params.checkpointNumber,
    sourcePhotoUri: params.sourcePhotoUri,
    originalFileName: params.originalFileName,
    mimeType: params.mimeType,
    fileSize: params.fileSize,
  });
}

/**
 * Save an offline GPS location update referencing an existing trip.
 */
export async function saveGpsToOutbox(params: {
  tripId: string;
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}): Promise<{ item: OutboxItem | null; error: string | null }> {
  try {
    if (!params.tripId) {
      return { item: null, error: "Trip ID required for GPS telemetry queue." };
    }

    const id =
      "outbox_gps_" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
    const newItem: OutboxItem = {
      id,
      eventType: "gps_location",
      tripId: params.tripId,
      tripCode: params.tripCode.trim().toUpperCase(),
      vehicleNumber: params.vehicleNumber.trim().toUpperCase(),
      stage: params.stage,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracyMeters: params.accuracyMeters ?? null,
      createdAt: new Date().toISOString(),
      status: "pending",
      errorMessage: null,
    };

    const current = await getOutboxItems();
    const updated = [newItem, ...current];
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(updated));

    return { item: newItem, error: null };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to queue offline GPS.";
    return { item: null, error: msg };
  }
}

/**
 * Remove an item from the offline outbox and delete any persistent image file.
 */
export async function removeOutboxItem(id: string): Promise<void> {
  try {
    const current = await getOutboxItems();
    const target = current.find((i) => i.id === id);
    if (target && target.photoUri) {
      try {
        await FileSystem.deleteAsync(target.photoUri, { idempotent: true });
      } catch {
        // ignore file deletion errors
      }
    }
    const filtered = current.filter((i) => i.id !== id);
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error("[outbox] removeOutboxItem error:", err);
  }
}

/**
 * Synchronize a single queued outbox event against its referenced assigned trip.
 * NEVER creates a citizen trip.
 */
export async function syncOutboxItem(
  item: OutboxItem,
  userId: string,
): Promise<{
  success: boolean;
  tripId?: string;
  evidenceId?: string;
  tripCode?: string;
  error?: string;
}> {
  try {
    if (!item.tripId) {
      return {
        success: false,
        error: "Queued outbox item lacks an assigned trip ID reference.",
      };
    }

    // Mark status as syncing
    try {
      const current = await getOutboxItems();
      const updated = current.map((i) =>
        i.id === item.id ? { ...i, status: "syncing" as const } : i,
      );
      await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Non-fatal status update
    }

    // ── Handle Checkpoint Evidence Upload ────────────────────────────────────
    if (
      item.eventType === "checkpoint_evidence" ||
      (!item.eventType && item.photoUri)
    ) {
      if (!item.photoUri) {
        return {
          success: false,
          error: "Missing photo file for evidence sync.",
        };
      }

      // 1. Upload photo to Supabase Storage (trip-evidence bucket)
      const { evidence, error: evErr } = await uploadEvidence({
        uri: item.photoUri,
        mimeType: item.mimeType ?? "image/jpeg",
        fileSize: item.fileSize ?? 0,
        fileName: item.originalFileName ?? `cp_${item.tripCode}.jpg`,
        tripId: item.tripId,
        stage: item.stage,
        userId,
      });

      if (evErr || !evidence) {
        return {
          success: false,
          error: evErr ?? "Failed to upload photo to storage.",
        };
      }

      // 2. Queue AI Verification for the assigned trip
      const { error: verErr } = await createPendingVerification({
        tripId: item.tripId,
        evidenceId: evidence.id,
        expectedPlate: item.vehicleNumber,
      });

      if (verErr) {
        console.warn("[outbox] Verification queue notice:", verErr);
      }

      // 3. Clean up successfully synced item from outbox
      await removeOutboxItem(item.id);

      return {
        success: true,
        tripId: item.tripId,
        evidenceId: evidence.id,
        tripCode: item.tripCode,
      };
    }

    // ── Handle GPS Location Telemetry ────────────────────────────────────────
    if (item.eventType === "gps_location") {
      if (item.latitude == null || item.longitude == null) {
        return {
          success: false,
          error: "Invalid coordinates in GPS outbox item.",
        };
      }

      const { error: gpsErr } = await supabase.from("trip_locations").insert({
        trip_id: item.tripId,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy_meters: item.accuracyMeters ?? null,
        source: "driver_mobile_offline_flush",
        uploaded_by: userId,
        recorded_at: item.createdAt,
      });

      if (gpsErr) {
        return { success: false, error: gpsErr.message };
      }

      await removeOutboxItem(item.id);
      return { success: true, tripId: item.tripId, tripCode: item.tripCode };
    }

    // ── Handle Trip Status Update ────────────────────────────────────────────
    if (item.eventType === "trip_status_update" && item.statusUpdate) {
      const { error: statusErr } = await supabase
        .from("trips")
        .update({ status: item.statusUpdate as any })
        .eq("id", item.tripId);

      if (statusErr) {
        return { success: false, error: statusErr.message };
      }

      await removeOutboxItem(item.id);
      return { success: true, tripId: item.tripId, tripCode: item.tripCode };
    }

    return { success: false, error: "Unrecognized outbox event type." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Outbox sync failed.";
    return { success: false, error: msg };
  }
}

/**
 * Synchronize all pending items in the driver outbox sequentially.
 */
export async function syncAllOutbox(userId: string): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const items = await getOutboxItems();
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    const res = await syncOutboxItem(item, userId);
    if (res.success) {
      synced++;
    } else {
      failed++;
      if (res.error)
        errors.push(`${item.tripCode || item.vehicleNumber}: ${res.error}`);
    }
  }

  return { synced, failed, errors };
}
