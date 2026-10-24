/**
 * Services unit tests — trips, evidence, reviews, verification, tracking, audit
 * All Supabase calls are mocked; uses static imports.
 */

// ─── Supabase mock ────────────────────────────────────────────────────────────

jest.mock('../lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'test/path.jpg' }, error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/test.jpg' }, error: null }),
      })),
    },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
  },
}));

// ─── Static imports ───────────────────────────────────────────────────────────

import { getTripByCode, listMyTrips, updateTripStatus } from '../lib/services/trips';
import { uploadEvidence, getEvidenceForTrip } from '../lib/services/evidence';
import { submitManualReview, getReviewsForTrip } from '../lib/services/reviews';
import { getLatestVerification, createPendingVerification } from '../lib/services/verification';
import { recordLocation, getLatestLocation } from '../lib/services/tracking';
import { auditActionLabel, formatTimestamp } from '../lib/services/audit';

// ─── Trips ────────────────────────────────────────────────────────────────────

describe('trips service', () => {
  it('getTripByCode is a function', () => {
    expect(typeof getTripByCode).toBe('function');
  });

  it('listMyTrips is a function', () => {
    expect(typeof listMyTrips).toBe('function');
  });

  it('updateTripStatus is a function', () => {
    expect(typeof updateTripStatus).toBe('function');
  });
});

// ─── Evidence ─────────────────────────────────────────────────────────────────

describe('evidence service', () => {
  it('uploadEvidence is a function', () => {
    expect(typeof uploadEvidence).toBe('function');
  });

  it('getEvidenceForTrip is a function', () => {
    expect(typeof getEvidenceForTrip).toBe('function');
  });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

describe('reviews service', () => {
  it('submitManualReview is a function', () => {
    expect(typeof submitManualReview).toBe('function');
  });

  it('getReviewsForTrip is a function', () => {
    expect(typeof getReviewsForTrip).toBe('function');
  });
});

// ─── Verification ─────────────────────────────────────────────────────────────

describe('verification service', () => {
  it('getLatestVerification is a function', () => {
    expect(typeof getLatestVerification).toBe('function');
  });

  it('createPendingVerification is a function', () => {
    expect(typeof createPendingVerification).toBe('function');
  });
});

// ─── Tracking ─────────────────────────────────────────────────────────────────

describe('tracking service', () => {
  it('recordLocation is a function', () => {
    expect(typeof recordLocation).toBe('function');
  });

  it('getLatestLocation is a function', () => {
    expect(typeof getLatestLocation).toBe('function');
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe('audit service', () => {
  it('auditActionLabel returns a human-readable label for evidence_uploaded', () => {
    const label = auditActionLabel('evidence_uploaded');
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('auditActionLabel returns a non-empty string for unknown actions', () => {
    const label = auditActionLabel('unknown_action_xyz');
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('formatTimestamp formats ISO date string to a non-empty string', () => {
    const ts = '2024-01-15T10:30:00.000Z';
    const formatted = formatTimestamp(ts);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('formatTimestamp handles current time without crashing', () => {
    const ts = new Date().toISOString();
    expect(() => formatTimestamp(ts)).not.toThrow();
  });
});
