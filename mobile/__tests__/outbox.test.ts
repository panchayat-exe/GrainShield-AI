/**
 * Unit tests for Offline Outbox and Offline Auth System
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const mockUpsertTrip = jest.fn();
const mockUploadEvidence = jest.fn();
const mockCreatePendingVerification = jest.fn();

jest.mock('@/lib/services/trips', () => ({
  upsertTrip: (...args: any[]) => mockUpsertTrip(...args),
}));

jest.mock('@/lib/services/evidence', () => ({
  uploadEvidence: (...args: any[]) => mockUploadEvidence(...args),
}));

jest.mock('@/lib/services/verification', () => ({
  createPendingVerification: (...args: any[]) => mockCreatePendingVerification(...args),
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn(),
  },
}));

import {
  saveToOutbox,
  getOutboxItems,
  removeOutboxItem,
  syncOutboxItem,
  syncAllOutbox,
} from '@/lib/offline/outbox';

import {
  enableOfflineMode,
  getOfflineUser,
  disableOfflineMode,
  getAuthUser,
} from '@/lib/auth';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Offline Outbox System', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('saveToOutbox stores item and copies photo to persistent directory', async () => {
    const result = await saveToOutbox({
      tripCode: 'TRIP-999',
      vehicleNumber: 'GJ01AB9999',
      stage: 'first_mile',
      sourcePhotoUri: 'file:///cache/photo_temp.jpg',
      originalFileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024 * 1024,
    });

    expect(result.error).toBeNull();
    expect(result.item).not.toBeNull();
    expect(result.item?.tripCode).toBe('TRIP-999');
    expect(result.item?.vehicleNumber).toBe('GJ01AB9999');
    expect(result.item?.status).toBe('pending');
    expect(FileSystem.copyAsync).toHaveBeenCalledTimes(1);

    // Verify stored in outbox
    const items = await getOutboxItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(result.item?.id);
  });

  it('getOutboxItems returns empty array when nothing queued', async () => {
    const items = await getOutboxItems();
    expect(items).toEqual([]);
  });

  it('removeOutboxItem deletes file and removes from queue', async () => {
    const { item } = await saveToOutbox({
      tripCode: 'TRIP-DELETE',
      vehicleNumber: 'GJ01CD1234',
      stage: 'last_mile',
      sourcePhotoUri: 'file:///cache/temp.jpg',
    });
    expect(item).not.toBeNull();

    await removeOutboxItem(item!.id);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(item!.photoUri, { idempotent: true });

    const items = await getOutboxItems();
    expect(items).toHaveLength(0);
  });

  it('syncOutboxItem executes online pipeline and cleans up outbox on success', async () => {
    mockUpsertTrip.mockResolvedValue({
      trip: { id: 'online-trip-1', trip_code: 'TRIP-SYNC' },
      error: null,
    });
    mockUploadEvidence.mockResolvedValue({
      evidence: { id: 'online-ev-1' },
      error: null,
    });
    mockCreatePendingVerification.mockResolvedValue({ error: null });

    const { item } = await saveToOutbox({
      tripCode: 'TRIP-SYNC',
      vehicleNumber: 'GJ01EF5678',
      stage: 'first_mile',
      sourcePhotoUri: 'file:///cache/photo.jpg',
      fileSize: 5000,
    });

    const syncRes = await syncOutboxItem(item!, 'user-123');
    expect(syncRes.success).toBe(true);
    expect(syncRes.tripId).toBe('online-trip-1');
    expect(syncRes.evidenceId).toBe('online-ev-1');

    // Outbox should now be empty
    const items = await getOutboxItems();
    expect(items).toHaveLength(0);
  });

  it('syncAllOutbox reports success and error counts', async () => {
    mockUpsertTrip.mockResolvedValue({
      trip: { id: 't-1', trip_code: 'TRIP-1' },
      error: null,
    });
    mockUploadEvidence.mockResolvedValue({
      evidence: { id: 'e-1' },
      error: null,
    });
    mockCreatePendingVerification.mockResolvedValue({ error: null });

    await saveToOutbox({
      tripCode: 'TRIP-1',
      vehicleNumber: 'GJ01AA1111',
      stage: 'first_mile',
      sourcePhotoUri: 'file:///cache/1.jpg',
    });

    const res = await syncAllOutbox('user-123');
    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
  });
});

describe('Offline Auth Mode', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('enables offline mode and stores offline user profile', async () => {
    const user = await enableOfflineMode('Ramesh Patel');
    expect(user.is_offline).toBe(true);
    expect(user.full_name).toBe('Ramesh Patel');

    const stored = await getOfflineUser();
    expect(stored).toEqual(user);
  });

  it('getAuthUser falls back to offline user when Supabase session is absent', async () => {
    await enableOfflineMode('Suresh Field');
    const authUser = await getAuthUser();
    expect(authUser).not.toBeNull();
    expect(authUser?.isOffline).toBe(true);
    expect(authUser?.email).toBe('operator@grainshield.local');
  });

  it('disableOfflineMode clears offline user session', async () => {
    await enableOfflineMode('Test User');
    await disableOfflineMode();
    const stored = await getOfflineUser();
    expect(stored).toBeNull();
  });
});
