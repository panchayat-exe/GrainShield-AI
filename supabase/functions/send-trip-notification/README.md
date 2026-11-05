# send-trip-notification — Supabase Edge Function

Sends email (via Resend) + Expo push notification when a trip's status changes.

## Deploy

```bash
# From project root
npx supabase functions deploy send-trip-notification
```

## Required Secrets

Set in Supabase Dashboard → Edge Functions → Secrets:

| Secret | Value |
|--------|-------|
| `RESEND_API_KEY` | Get from https://resend.com |
| `EXPO_ACCESS_TOKEN` | Get from https://expo.dev (optional but recommended) |

## Trigger Setup (Supabase Dashboard)

1. Go to **Database → Webhooks → Create new**
2. Name: `trip-status-notification`
3. Table: `public.trips`
4. Events: **UPDATE** only
5. Type: **Supabase Edge Functions**
6. Edge Function: `send-trip-notification`
7. HTTP method: POST
8. Save

## Email Provider

This function uses [Resend](https://resend.com) which has a free tier (3,000 emails/month).

**Alternative:** Replace the Resend API call with SendGrid, AWS SES, or Supabase's built-in email.

## Domains

Update the `from` address `noreply@grainshield.gov.in` to a verified domain in Resend dashboard.

## push_token Column

Migration 024 or add manually:
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token text;
```
The mobile app saves the token automatically via `usePushNotifications()` hook.
