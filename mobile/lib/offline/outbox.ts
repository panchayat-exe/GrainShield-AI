/**
 * Offline Outbox System for GrainShield AI.
 *
 * Allows citizens and field drivers to capture trip details and evidence
 * photographs completely offline (in areas with zero cellular reception).
 *
 * Storage Strategy:
 * 1. Photographs are copied to persistent device storage:
 *    `${FileSystem.documentDirectory}grainshield_outbox/`
 * 2. Submission metadata (trip ID, vehicle, stage, timestamp) is queued
 *    in AsyncStorage under `@grainshield_outbox_queue`.
 * 3. Once internet connection is restored, `syncAllOutbox()` or `syncItem()`
 *    pushes the queued items to the Supabase database and storage bucket.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { upsertTrip } from "@/lib/services/trips";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import type { TripStage } from "@/lib/supabase/types";

const OUTBOX_STORAGE_KEY = "@grainshield_outbox_queue";
const OFFLINE_DIR_NAME = "grainshield_outbox/";

export interface OutboxItem {
  id: string;
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  photoUri: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
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
 * Save an item to the offline outbox.
 * Copies the photo from temporary cache to persistent storage so it is never deleted by the OS.
 */
export async function saveToOutbox(params: {
  tripCode: string;
  vehicleNumber: string;
  stage: TripStage;
  sourcePhotoUri: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
}): Promise<{ item: OutboxItem | null; error: string | null }> {
  try {
    const id = "outbox_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const mimeType = params.mimeType ?? "image/jpeg";
    const ext = params.originalFileName?.split(".").pop() ?? "jpg";
    const persistentFileName = `${id}.${ext}`;

    // Ensure persistent directory exists
    const dir = await ensureOutboxDirExists();
    const destinationUri = `${dir}${persistentFileName}`;

    // Copy file to persistent storage
    await FileSystem.copyAsync({
      from: params.sourcePhotoUri,
      to: destinationUri,
    });

    const newItem: OutboxItem = {
      id,
      tripCode: params.tripCode.trim().toUpperCase(),
      vehicleNumber: params.vehicleNumber.trim().toUpperCase(),
      stage: params.stage,
      photoUri: destinationUri,
      originalFileName: params.originalFileName ?? persistentFileName,
      mimeType,
      fileSize: params.fileSize ?? 0,
      createdAt: new Date().toISOString(),
      status: "pending",
      errorMessage: null,
    };

    const current = await getOutboxItems();
    const updated = [newItem, ...current];
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(updated));

    return { item: newItem, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save offline evidence.";
    console.error("[outbox] saveToOutbox error:", msg);
    return { item: null, error: msg };
  }
}

/**
 * Remove an item from the offline outbox and delete its persistent image file.
 */
export async function removeOutboxItem(id: string): Promise<void> {
  try {
    const current = await getOutboxItems();
    const target = current.find((i) => i.id === id);
    if (target) {
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
 * Attempt to sync a single outbox item to Supabase.
 * Returns the created trip and evidence record on success, and removes the item from outbox.
 */
export async function syncOutboxItem(
  item: OutboxItem,
  userId: string
): Promise<{ success: boolean; tripId?: string; evidenceId?: string; error?: string }> {
  try {
    // 1. Create / Upsert trip in Supabase
    const { trip, error: tripErr } = await upsertTrip({
      tripCode: item.tripCode,
      vehicleNumber: item.vehicleNumber,
      stage: item.stage,
      userId,
    });
    if (tripErr || !trip) {
      return { success: false, error: tripErr ?? "Failed to create trip online" };
    }

    // 2. Upload persistent photo to Supabase Storage
    const { evidence, error: evErr } = await uploadEvidence({
      uri: item.photoUri,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      fileName: item.originalFileName,
      tripId: trip.id,
      stage: item.stage,
      userId,
    });
    if (evErr || !evidence) {
      return { success: false, error: evErr ?? "Failed to upload photo" };
    }

    // 3. Create pending verification record
    const { error: verErr } = await createPendingVerification({
      tripId: trip.id,
      evidenceId: evidence.id,
      expectedPlate: item.vehicleNumber,
    });
    if (verErr) {
      return { success: false, error: verErr };
    }

    // Clean up successfully synced item from outbox
    await removeOutboxItem(item.id);

    return {
      success: true,
      tripId: trip.id,
      evidenceId: evidence.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    return { success: false, error: msg };
  }
}

/**
 * Synchronize all pending items in the outbox.
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
      if (res.error) errors.push(`${item.tripCode}: ${res.error}`);
    }
  }

  return { synced, failed, errors };
}
