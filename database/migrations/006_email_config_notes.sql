-- =============================================================
-- Migration 006: Email Template Configuration Notes
--
-- Supabase email templates are configured through the Dashboard,
-- not via SQL. However, we document the redirect URLs and
-- settings that must be configured.
--
-- REQUIRED Dashboard Steps (Authentication → Email Templates):
-- =============================================================

-- 1. Confirm Signup Template
--    Subject: Confirm your GrainShield AI account
--    Redirect To: {{ .SiteURL }}/
--    (Supabase sends built-in HTML; customise the body in the Dashboard)

-- 2. Reset Password Template
--    Subject: Reset your GrainShield AI password
--    Redirect To: {{ .SiteURL }}/auth/reset-password

-- 3. Magic Link Template (if used in future)
--    Subject: Your GrainShield AI sign-in link
--    Redirect To: {{ .SiteURL }}/

-- 4. Change Email Address Template
--    Subject: Confirm your new GrainShield AI email

-- =============================================================
-- REQUIRED Dashboard Steps (Authentication → URL Configuration):
-- =============================================================

-- Site URL:
--   https://your-deployed-domain.com   (or http://localhost:8080 for dev)

-- Redirect URLs (allowlist):
--   http://localhost:8080/**
--   http://localhost:4173/**
--   https://your-deployed-domain.com/**

-- =============================================================
-- SQL: Configure auth settings (run in SQL Editor)
-- =============================================================

-- Set the app name shown in emails (appears in email subjects):
-- update auth.config set mailer_autoconfirm = false; -- require email confirm

-- To allow users to sign up without email confirmation during development:
-- update auth.config set mailer_autoconfirm = true;

-- =============================================================
-- SMTP Setup (for branded email from your domain):
-- Dashboard → Settings → Auth → SMTP Settings
-- Fill in your SMTP provider (SendGrid, Resend, Mailgun, etc.)
-- =============================================================
select 'Email template configuration is done via the Supabase Dashboard, not SQL.' as note;
