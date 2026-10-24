/**
 * Services unit tests — trips, evidence, reviews
 * All Supabase calls are mocked.
 */

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();
const mockStorageUpload = jest.fn();
const mockStorageCreateSignedUrl = jest.fn();

// Build a chainable mock
const buildChain = () => {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.insert = mockInsert;
  chain.upsert = mockUpsert;
  chain.update = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  return chain;
};

jest.mock('../lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
    from: jest.fn(() => buildChain()),
    storage: {
      from: jest.fn(() => ({
        upload: mockStorageUpload,
        createSignedUrl: mockStorageCreateSignedUrl,
      })),
    },
  },
}));

// ─── Trips ────────────────────────────────────────────────────────────────────

describe('trips service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getTripByCode: imports without error', async () => {
    // Just verify the module loads (imports are lazy in Jest)
    const { getTripByCode } = await import('../lib/services/trips');
    expect(typeof getTripByCode).toBe('function');
  });

  it('listMyTrips: imports without error', async () => {
    const { listMyTrips } = await import('../lib/services/trips');
    expect(typeof listMyTrips).toBe('function');
  });
});

// ─── Evidence ─────────────────────────────────────────────────────────────────

describe('evidence service', () => {
  it('uploadEvidence: imports without error', async () => {
    const { uploadEvidence } = await import('../lib/services/evidence');
    expect(typeof uploadEvidence).toBe('function');
  });

  it('getEvidenceForTrip: imports without error', async () => {
    const { getEvidenceForTrip } = await import('../lib/services/evidence');
    expect(typeof getEvidenceForTrip).toBe('function');
  });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

describe('reviews service', () => {
  it('submitManualReview: imports without error', async () => {
    const { submitManualReview } = await import('../lib/services/reviews');
    expect(typeof submitManualReview).toBe('function');
  });

  it('getReviewsForTrip: imports without error', async () => {
    const { getReviewsForTrip } = await import('../lib/services/reviews');
    expect(typeof getReviewsForTrip).toBe('function');
  });
});

// ─── Verification ─────────────────────────────────────────────────────────────

describe('verification service', () => {
  it('getLatestVerification: imports without error', async () => {
    const { getLatestVerification } = await import('../lib/services/verification');
    expect(typeof getLatestVerification).toBe('function');
  });

  it('createPendingVerification: imports without error', async () => {
    const { createPendingVerification } = await import('../lib/services/verification');
    expect(typeof createPendingVerification).toBe('function');
  });
});

// ─── Tracking ─────────────────────────────────────────────────────────────────

describe('tracking service', () => {
  it('recordLocation: imports without error', async () => {
    const { recordLocation } = await import('../lib/services/tracking');
    expect(typeof recordLocation).toBe('function');
  });

  it('getLatestLocation: imports without error', async () => {
    const { getLatestLocation } = await import('../lib/services/tracking');
    expect(typeof getLatestLocation).toBe('function');
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe('audit service', () => {
  it('auditActionLabel: returns human-readable label', async () => {
    const { auditActionLabel } = await import('../lib/services/audit');
    // Should return a non-empty string for any known action
    const label = auditActionLabel('evidence_uploaded');
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  it('formatTimestamp: formats ISO date string', async () => {
    const { formatTimestamp } = await import('../lib/services/audit');
    const ts = '2024-01-15T10:30:00.000Z';
    const formatted = formatTimestamp(ts);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});
