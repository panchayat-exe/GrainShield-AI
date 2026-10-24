/**
 * Validation tests — Zod schemas and photo asset validation
 */
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  uploadSchema,
  manualReviewSchema,
  validatePhotoAsset,
} from '../lib/validation';

// ─── loginSchema ─────────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'secret123' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'notanemail', password: 'secret123' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── registerSchema ───────────────────────────────────────────────────────────

describe('registerSchema', () => {
  const validPayload = {
    email: 'new@example.com',
    password: 'StrongPass1',
    confirm_password: 'StrongPass1',
    full_name: 'Ravi Sharma',
  };

  it('accepts valid registration data', () => {
    const result = registerSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({ ...validPayload, confirm_password: 'WrongPass' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /match/i.test(m))).toBe(true);
    }
  });

  it('rejects short password', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: 'ab', confirm_password: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects empty full name', () => {
    const result = registerSchema.safeParse({ ...validPayload, full_name: '' });
    expect(result.success).toBe(false);
  });
});

// ─── forgotPasswordSchema ─────────────────────────────────────────────────────

describe('forgotPasswordSchema', () => {
  it('accepts valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'test@gov.in' }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'bad' }).success).toBe(false);
  });
});

// ─── uploadSchema ─────────────────────────────────────────────────────────────

describe('uploadSchema', () => {
  const validUpload = {
    trip_code: 'TRIP001',
    vehicle_number: 'GJ01AB1234',
    stage: 'first_mile' as const,
  };

  it('accepts valid upload fields', () => {
    expect(uploadSchema.safeParse(validUpload).success).toBe(true);
  });

  it('rejects empty trip_code', () => {
    expect(uploadSchema.safeParse({ ...validUpload, trip_code: '' }).success).toBe(false);
  });

  it('rejects empty vehicle_number', () => {
    expect(uploadSchema.safeParse({ ...validUpload, vehicle_number: '' }).success).toBe(false);
  });

  it('rejects invalid stage', () => {
    expect(uploadSchema.safeParse({ ...validUpload, stage: 'invalid_stage' }).success).toBe(false);
  });
});

// ─── manualReviewSchema ───────────────────────────────────────────────────────

describe('manualReviewSchema', () => {
  const validPayload = {
    trip_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    evidence_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    notes: 'Please review this manually.',
  };

  it('accepts valid review payload with notes', () => {
    expect(manualReviewSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts valid review payload without notes (notes is optional)', () => {
    const { notes: _n, ...withoutNotes } = validPayload;
    expect(manualReviewSchema.safeParse(withoutNotes).success).toBe(true);
  });

  it('rejects invalid trip_id UUID', () => {
    expect(manualReviewSchema.safeParse({ ...validPayload, trip_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects invalid evidence_id UUID', () => {
    expect(manualReviewSchema.safeParse({ ...validPayload, evidence_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects notes over 1000 characters', () => {
    const longNotes = 'a'.repeat(1001);
    expect(manualReviewSchema.safeParse({ ...validPayload, notes: longNotes }).success).toBe(false);
  });
});

// ─── validatePhotoAsset ───────────────────────────────────────────────────────

describe('validatePhotoAsset', () => {
  it('accepts valid JPEG under 10 MB', () => {
    const result = validatePhotoAsset({ mimeType: 'image/jpeg', fileSize: 5 * 1024 * 1024 });
    expect(result.valid).toBe(true);
  });

  it('accepts valid PNG under 10 MB', () => {
    const result = validatePhotoAsset({ mimeType: 'image/png', fileSize: 2 * 1024 * 1024 });
    expect(result.valid).toBe(true);
  });

  it('rejects file over 10 MB', () => {
    const result = validatePhotoAsset({ mimeType: 'image/jpeg', fileSize: 11 * 1024 * 1024 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/10/);
  });

  it('rejects unsupported MIME type', () => {
    const result = validatePhotoAsset({ mimeType: 'image/gif', fileSize: 1 * 1024 * 1024 });
    expect(result.valid).toBe(false);
  });

  it('rejects missing mimeType', () => {
    const result = validatePhotoAsset({ mimeType: null, fileSize: 1 * 1024 * 1024 });
    expect(result.valid).toBe(false);
  });

  it('rejects missing fileSize', () => {
    const result = validatePhotoAsset({ mimeType: 'image/jpeg', fileSize: null });
    expect(result.valid).toBe(false);
  });

  it('rejects zero fileSize', () => {
    const result = validatePhotoAsset({ mimeType: 'image/jpeg', fileSize: 0 });
    expect(result.valid).toBe(false);
  });
});
