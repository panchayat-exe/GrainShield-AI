/**
 * Auth service unit tests
 * Mocks @supabase/supabase-js so no network calls are made.
 *
 * Auth functions return { error: string | null }
 * getAuthUser returns AuthUser | null (i.e., { id, email } | null)
 */

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      onAuthStateChange: jest.fn(),
      getUser: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import { supabase } from '@/lib/supabase/client';
import {
  signIn,
  signUp,
  signOut,
  resetPassword,
  updatePassword,
  getAuthUser,
} from '../lib/auth';

const authMock = supabase.auth as unknown as {
  signInWithPassword: jest.Mock;
  signUp: jest.Mock;
  signOut: jest.Mock;
  resetPasswordForEmail: jest.Mock;
  updateUser: jest.Mock;
  onAuthStateChange: jest.Mock;
  getUser: jest.Mock;
};

// ─── signIn ───────────────────────────────────────────────────────────────────

describe('signIn', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null error on success', async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com' } },
      error: null,
    });

    const result = await signIn('a@b.com', 'pass12345');
    expect(result.error).toBeNull();
    expect(authMock.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass12345',
    });
  });

  it('returns error string on invalid credentials', async () => {
    authMock.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await signIn('bad@example.com', 'wrongpass');
    expect(typeof result.error).toBe('string');
    expect(result.error).toBeTruthy();
  });
});

// ─── signUp ───────────────────────────────────────────────────────────────────

describe('signUp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null error on successful registration', async () => {
    authMock.signUp.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null });

    const result = await signUp('new@example.com', 'StrongPass1', 'Ravi Sharma');
    expect(result.error).toBeNull();
  });

  it('returns error string when email already in use', async () => {
    authMock.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered' },
    });

    const result = await signUp('existing@example.com', 'pass12345', 'Name');
    expect(typeof result.error).toBe('string');
    expect(result.error).toBeTruthy();
  });
});

// ─── signOut ──────────────────────────────────────────────────────────────────

describe('signOut', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls supabase signOut without crashing', async () => {
    authMock.signOut.mockResolvedValue({ error: null });

    await expect(signOut()).resolves.not.toThrow();
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
  });
});

// ─── resetPassword ────────────────────────────────────────────────────────────

describe('resetPassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends reset email successfully and returns null error', async () => {
    authMock.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    const result = await resetPassword('user@example.com');
    expect(result.error).toBeNull();
    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('grainshield://') })
    );
  });

  it('returns error string if request fails', async () => {
    authMock.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: 'Email not found' },
    });

    const result = await resetPassword('ghost@example.com');
    expect(typeof result.error).toBe('string');
    expect(result.error).toBeTruthy();
  });
});

// ─── updatePassword ───────────────────────────────────────────────────────────

describe('updatePassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates password and returns null error', async () => {
    authMock.updateUser.mockResolvedValue({ data: { user: {} }, error: null });

    const result = await updatePassword('NewPass123');
    expect(result.error).toBeNull();
    expect(authMock.updateUser).toHaveBeenCalledWith({ password: 'NewPass123' });
  });

  it('returns error string on failure', async () => {
    authMock.updateUser.mockResolvedValue({
      data: null,
      error: { message: 'Weak password' },
    });

    const result = await updatePassword('abc');
    expect(typeof result.error).toBe('string');
  });
});

// ─── getAuthUser ──────────────────────────────────────────────────────────────

describe('getAuthUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns AuthUser object when authenticated', async () => {
    const fakeUser = { id: 'user-3', email: 'verified@example.com' };
    authMock.getUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

    const result = await getAuthUser();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-3');
    expect(result?.email).toBe('verified@example.com');
  });

  it('returns null when not authenticated', async () => {
    authMock.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    });

    const result = await getAuthUser();
    expect(result).toBeNull();
  });
});
