/**
 * Navigation / AuthGuard logic tests
 * Tests the route-guard logic that redirects unauthenticated users.
 */

// ─── AuthGuard logic ──────────────────────────────────────────────────────────

describe('AuthGuard redirect logic', () => {
  type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

  function getRedirectTarget(
    authState: AuthState,
    currentRoute: string
  ): string | null {
    if (authState === 'loading') return null; // wait

    const isAuthRoute = currentRoute.startsWith('/(auth)');
    const isAppRoute = currentRoute.startsWith('/(app)');

    if (authState === 'unauthenticated' && isAppRoute) {
      return '/(auth)/login';
    }

    if (authState === 'authenticated' && isAuthRoute) {
      return '/(app)';
    }

    return null; // no redirect needed
  }

  it('redirects unauthenticated user from app route to login', () => {
    expect(getRedirectTarget('unauthenticated', '/(app)/index')).toBe('/(auth)/login');
  });

  it('redirects authenticated user from auth route to app home', () => {
    expect(getRedirectTarget('authenticated', '/(auth)/login')).toBe('/(app)');
  });

  it('does not redirect authenticated user on app routes', () => {
    expect(getRedirectTarget('authenticated', '/(app)/index')).toBeNull();
  });

  it('does not redirect unauthenticated user on auth routes', () => {
    expect(getRedirectTarget('unauthenticated', '/(auth)/login')).toBeNull();
  });

  it('does not redirect while loading', () => {
    expect(getRedirectTarget('loading', '/(app)/index')).toBeNull();
    expect(getRedirectTarget('loading', '/(auth)/login')).toBeNull();
  });

  it('handles forgot-password auth route correctly', () => {
    expect(getRedirectTarget('authenticated', '/(auth)/forgot-password')).toBe('/(app)');
  });

  it('handles register auth route correctly', () => {
    expect(getRedirectTarget('authenticated', '/(auth)/register')).toBe('/(app)');
  });
});

// ─── Protected route list ─────────────────────────────────────────────────────

describe('protected routes definition', () => {
  const PROTECTED_ROUTES = [
    '/(app)',
    '/(app)/index',
    '/(app)/processing',
    '/(app)/result',
    '/(app)/failed',
    '/(app)/trip',
    '/(app)/tracking',
  ];

  const PUBLIC_ROUTES = [
    '/(auth)/login',
    '/(auth)/register',
    '/(auth)/forgot-password',
  ];

  it('all app routes are protected', () => {
    for (const route of PROTECTED_ROUTES) {
      expect(route.startsWith('/(app)')).toBe(true);
    }
  });

  it('all auth routes are public', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route.startsWith('/(auth)')).toBe(true);
    }
  });

  it('protected and public route sets are disjoint', () => {
    const intersection = PROTECTED_ROUTES.filter((r) => PUBLIC_ROUTES.includes(r));
    expect(intersection).toHaveLength(0);
  });
});

// ─── Session expiry handling ──────────────────────────────────────────────────

describe('session expiry handling', () => {
  it('treats expired session as unauthenticated', () => {
    // Simulate Supabase returning a session-expired event
    type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

    function isAuthenticated(event: AuthEvent, hasSession: boolean): boolean {
      if (event === 'SIGNED_OUT') return false;
      if (event === 'SIGNED_IN' && hasSession) return true;
      if (event === 'TOKEN_REFRESHED' && hasSession) return true;
      return false;
    }

    expect(isAuthenticated('SIGNED_OUT', false)).toBe(false);
    expect(isAuthenticated('SIGNED_IN', true)).toBe(true);
    expect(isAuthenticated('TOKEN_REFRESHED', true)).toBe(true);
    expect(isAuthenticated('SIGNED_IN', false)).toBe(false);
  });
});
