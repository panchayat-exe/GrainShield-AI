# GrainShield AI — Mobile Profile Report

**Date:** 2026-11-05  
**File:** `mobile/app/(app)/profile.tsx`  
**Tab:** Profile (👤 — 7th tab in bottom navigation)

---

## Implemented Features

| Feature | Status | Notes |
|---------|--------|-------|
| Display user full name | ✅ | Loaded from `profiles` table |
| Display email address | ✅ | From `supabase.auth.getUser()` |
| Display role badge | ✅ | Colour-coded (`user`, `officer`, `admin`) |
| Display district | ✅ | Editable |
| Display phone number | ✅ | Editable |
| Display account status | ✅ | Active/Inactive indicator |
| Edit full name | ✅ | Inline text input + Save button |
| Edit phone number | ✅ | Inline text input + Save button |
| Edit district | ✅ | Inline text input + Save button |
| Save profile changes | ✅ | `supabase.from('profiles').update(...)` |
| Change password | ✅ | Current password verification via re-auth, then `supabase.auth.updateUser({password})` |
| Sign out | ✅ | `supabase.auth.signOut()` → redirects to login; now has `try/catch` |
| Contact information section | ✅ | Phone + district |
| Role display | ✅ | Chip/badge with role label |

---

## Authorization Rules

The profile screen follows the same authorization rules as the web citizen portal:

- Displays only the **current user's** profile data (queried via `auth.uid()`)
- RLS on `profiles` table ensures users can only `UPDATE` their own row
- `role` and `id` fields cannot be changed via the profile screen
- Password change uses Supabase Auth which validates the session token

---

## Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| Preferred language selection | 🟢 LOW | No `preferred_language` column in `profiles` schema |
| Profile photo / avatar | 🟢 LOW | Not in schema; would need Storage bucket |
| Notification preferences | 🟡 MEDIUM | No push notification token management UI |
| Security settings (2FA) | 🟡 MEDIUM | Supabase doesn't expose 2FA config to client SDK |
| Account deletion | 🟢 LOW | Cannot be done safely from client |

---

## Sign Out Fix

**Before:** `signOut` had no error handling — if the Supabase call failed for any reason, navigation would not occur and the user would be stuck.

**After (this session):**
```typescript
onPress={async () => {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[Profile] signOut error:", err);
  }
  router.replace("/(auth)/login");  // Always navigate regardless
}}
```

Navigation now always occurs even if the network call fails, preventing the UI from getting stuck.

---

## Profile Changes Synchronization

Profile changes (name/phone/district) are written to the `profiles` table in Supabase. The change is immediately reflected on:
- **Mobile:** State update via `setSavedProfile` after successful `update()` 
- **Citizen web portal:** Loaded fresh from DB on each page visit
- **Admin user list:** Updated on next admin load (no realtime push to admin)

There is no optimistic update race condition — the state is only updated after the Supabase call succeeds.

---

## GPS Profile Integration

The GPS tracking hook (`use-gps-tracking.ts`) receives `userId` from the authenticated session, not from the profile screen. Profile changes do not affect GPS tracking. The `tripId` passed to the GPS hook comes from trip search in the tracking screen.
