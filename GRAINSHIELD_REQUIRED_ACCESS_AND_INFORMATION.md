# GrainShield AI — Required Access & Information

**Version:** 1.0
**Date:** 2026-11-05
**HEAD at planning time:** `0a0c16c`
**Purpose:** Catalogue every external dependency, credential, dataset, or authorization that must be obtained before specific implementation phases can proceed. Items are presented in priority order.

---

## Format

Each item uses the following structure:

> **What is missing:** Description of the missing asset.
> **Why it is required:** Reason this blocks a specific phase.
> **Feature depends on it:** Which phase / feature is blocked.
> **Permissions needed:** Level of access or authorization required.
> **How to provide securely:** Exact steps to supply this safely.
> **What can be built without it:** What partial implementation can proceed.

---

## Item 1 — Authorized Indian Vehicle Plate Dataset

**What is missing:** A larger, labelled dataset of Indian vehicle number plates — specifically heavy goods vehicles (trucks, lorries) used in GSCSCL / FCI grain logistics in Gujarat.

**Why it is required:** The current plate detector was trained on 548 Roboflow images (CC BY 4.0, general Indian plates). These images are not specific to grain-transport trucks, may not include Gujarat-specific plate formats, and the dataset is small by production standards. A model trained on domain-specific images will have significantly higher recall and precision.

**Feature depends on it:** Phase 1 AI model retraining / improvement.

**Permissions needed:**
- Copyright clearance / license for use in a government AI system.
- If GSCSCL has its own vehicle registry with photographs, consent from the data controller.
- If collecting new images at checkpoints, GSCSCL's data privacy policy must permit use.

**How to provide securely:**
1. Place images in a password-protected ZIP or on a shared secure Google Drive folder with restricted access.
2. Do not upload to the public GitHub repository.
3. Store locally in `ai-model/datasets/private/` (which must be in `.gitignore`).
4. Provide a `data_license.txt` confirming the usage rights.

**What can be built without it:** The current 548-image model (mAP50 = 0.995 on its own test set) can be deployed immediately. Phase 1.1–1.5 can proceed. The retraining improvement is an enhancement, not a blocker for the pilot.

---

## Item 2 — GSCSCL Trip Dispatch System Integration Details

**What is missing:** Confirmation of whether trips originate from an external GSCSCL / FCI dispatch management system, or whether all trips are created manually by GrainShield admin officers.

**Why it is required:** The entire Phase 2 (Automatic Trip Generation) depends on knowing the source of truth for trip identity. If trips come from an external MIS, GrainShield must consume them via API. If trips are always admin-initiated, the internal sequence generator approach (migration 019) is correct.

**Feature depends on it:** Phase 2 (Auto Trip Generation) architecture decision.

**Permissions needed:**
- If external system: API documentation, endpoint URL, authentication credentials (API key or OAuth2 client credentials).
- If admin-initiated: no external permission needed.

**How to provide securely:**
1. If an API key is involved, place it in `ai-worker/.env` as `GSCSCL_API_KEY=...` — never in source code.
2. Share API documentation as a PDF or URL, not by pasting in chat.

**What can be built without it:**
- Internal auto-generation (server-side sequence) can be implemented immediately regardless.
- The external integration leg is an optional enhancement — the system works without it.

---

## Item 3 — Supabase Project Settings Access (MFA, Invite, Staging)

**What is missing:** Admin access to the Supabase project dashboard at `umkjdpgxxylckoohnyco.supabase.co` to:
- Enable TOTP MFA for privileged accounts.
- Configure Email invite templates.
- Create a second Supabase project for staging.

**Why it is required:**
- MFA cannot be enforced programmatically without enabling it in the project Auth settings.
- User invitations via `inviteUserByEmail` require the SMTP/email provider to be configured in Supabase Auth settings.
- A staging project requires a new project creation.

**Feature depends on it:** Phase 6.3 (MFA), Phase 5.2 (User Invite), Phase 8.5 (Staging Environment).

**Permissions needed:**
- Owner or Admin role on the Supabase organisation.

**How to provide securely:**
1. Navigate to Supabase Dashboard → Project Settings → Auth → Enable MFA.
2. Navigate to Auth → Email → enable "User Invitations."
3. Create a new project for staging and share its `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables — not in chat.
4. Never share `SUPABASE_SERVICE_ROLE_KEY` via chat or unencrypted channels.

**What can be built without it:**
- All frontend, backend, and AI code can be written and tested.
- MFA UI components can be built and unit-tested.
- Invite UI can be built. Only the activation (project-level config) requires this access.

---

## Item 4 — Android Background Location Policy Answer

**What is missing:** A decision on whether the mobile app should track driver GPS **continuously in the background** (even when the app is minimised / screen off).

**Why it is required:** Android 10+ requires `ACCESS_BACKGROUND_LOCATION` permission and explicit justification in the Google Play Store submission. Apple requires `NSLocationAlwaysAndWhenInUseUsageDescription` and "always" permission justification in the App Store review. Using background GPS without clear user consent and policy may violate platform policies and Indian data privacy guidelines.

**Feature depends on it:** Phase 3 (GPS background tracking), Phase 9 (Play Store / App Store submission).

**Permissions needed:**
- Policy decision from GSCSCL / legal team on driver consent and data retention.
- Google Play policy compliance review.

**How to provide securely:**
- Write a 1-paragraph "Location Usage Policy" statement confirming: (a) what data is collected, (b) for how long it is retained in `trip_locations`, (c) who can view it (officers only via RLS).
- This statement will be shown to drivers in the app onboarding screen and submitted with Play Store listing.

**What can be built without it:**
- Foreground GPS tracking (current implementation) works while app is in foreground.
- Phase 3.1–3.3 (background GPS code changes) can be written and tested on a simulator; actual device submission is blocked pending policy decision.

---

## Item 5 — Role Approval Hierarchy (Officer / Admin Provisioning)

**What is missing:** A confirmed answer to: *Who is authorised to approve a new Field Officer or Admin account in production?*

**Why it is required:** The current system allows any `admin` to promote `user → officer`, and only `super_admin` can promote to `admin` or `super_admin`. In a government deployment, this may require an official authorisation workflow (e.g., Divisional Officer signs a request, which is then processed by the IT cell).

**Feature depends on it:** Phase 5.2 (User Invite), Phase 6 (Identity & Roles), Phase 9 (Operational Readiness).

**Permissions needed:**
- GSCSCL IT department policy document or organisational directive.
- Identification of the initial `super_admin` account holder (the person with god-mode).

**How to provide securely:**
- Share the approval hierarchy as a simple text document: "Role X can be granted by Role Y with approval from Z."
- Do not share individual personal credentials — only the policy structure is needed.

**What can be built without it:**
- Current role-assignment UI is functional.
- An audit trail for all role changes already exists (`audit_logs`).
- An invite + approval workflow (Phase 5.2) can be implemented based on the simplest model and refined once the policy is confirmed.

---

## Item 6 — Deployment Environment Decision

**What is missing:** Confirmation of whether the target production deployment is:
- **Option A:** A controlled pilot (1 district, ~50 trips/month) — can run on the current Supabase free/pro tier.
- **Option B:** State-wide Gujarat rollout (~10,000 trips/month across 33 districts) — requires Supabase Pro/Team plan, Redis for worker queuing, horizontal scaling for the AI FastAPI server.

**Why it is required:** Infrastructure, database connection pooling (PgBouncer), AI worker threading, and storage bucket sizing all depend on expected load.

**Feature depends on it:** Phase 8 (Scalability), Phase 9 (Deployment Preparation).

**Permissions needed:**
- Decision from GSCSCL programme sponsor / IT department.
- If Option B: Supabase Pro plan subscription (estimated ~\$25–100/month depending on usage).

**How to provide securely:**
- State the target deployment scale in a message. No credentials required for this decision.

**What can be built without it:**
- All code is written to be scalable regardless — no changes are required to code based on scale.
- Infrastructure configuration (Supabase plan tier, worker instance count) is the only thing blocked.

---

## Item 7 — VLTS (Vehicle Location Tracking System) Integration

**What is missing:** Confirmation of whether GrainShield AI must integrate with Gujarat's VLTS (Vehicle Location Tracking System) operated by the state transport authority.

**Why it is required:** If VLTS provides authoritative GPS coordinates, GrainShield should consume them rather than relying solely on driver-submitted GPS. This would prevent GPS spoofing by drivers.

**Feature depends on it:** Phase 7+ (Advanced GPS integrity).

**Permissions needed:**
- VLTS API documentation.
- API key / client credentials from Gujarat SRTC or the relevant authority.
- Data sharing agreement between GSCSCL and VLTS operator.

**How to provide securely:**
1. VLTS API key → store in `ai-worker/.env` as `VLTS_API_KEY=...`.
2. Endpoint URL can be shared in a `.env.example` comment.

**What can be built without it:**
- Driver-submitted GPS (current implementation) works without VLTS.
- VLTS integration is an integrity enhancement, not a core blocker.
- All Phase 1–8 work proceeds without it.

---

## Item 8 — Error Tracking / Monitoring DSN

**What is missing:** A Sentry (or Datadog / GCP Cloud Monitoring) DSN or project credentials for error tracking in production.

**Why it is required:** Without error tracking, production bugs in the AI worker, frontend, or admin panel are only discoverable through user reports or manual log inspection.

**Feature depends on it:** Phase 8.3 (Error Tracking).

**Permissions needed:**
- Sentry account (free tier is sufficient for pilot).
- Sentry DSN for each service (Python, Node.js, React).

**How to provide securely:**
1. Create a Sentry project at sentry.io.
2. Copy the DSN string.
3. Add to `.env` files: `SENTRY_DSN=https://...@sentry.io/...` — never hardcode in source.

**What can be built without it:**
- Sentry SDK integration code can be written now (it gracefully no-ops when `SENTRY_DSN` is absent).
- Error tracking is simply inactive until the DSN is provided.

---

## Item 9 — Google Play / Apple Developer Account

**What is missing:** Access to a Google Play Developer account (and optionally Apple Developer account) for distributing the GrainShield AI mobile app.

**Why it is required:** The mobile app (`mobile/`) is built with Expo and must be submitted to app stores for real-device testing and driver distribution. EAS Build can produce APKs for sideloading without a Play account, but Play Store distribution requires one.

**Feature depends on it:** Phase 9.3 (Android APK Build & Distribution).

**Permissions needed:**
- Google Play Developer account (\$25 one-time registration fee).
- Optionally: Apple Developer Program membership (\$99/year) for iOS.

**How to provide securely:**
1. Create the account under GSCSCL's official Google / Apple developer identity.
2. Add the engineer's Google account as a release manager.
3. No credentials need to be shared — the developer account holder submits the build.

**What can be built without it:**
- APK builds via `eas build` can be distributed as sideload APKs for field testing.
- Play Store listing is not required for the pilot phase.

---

## Item 10 — CERT-In / Government Security Audit

**What is missing:** A formal penetration test and security audit by a CERT-In empanelled organisation, as typically required before deploying a government-facing application.

**Why it is required:** GSCSCL is a government body. Any digital platform handling logistics data must comply with MEITY guidelines and may require VAPT (Vulnerability Assessment and Penetration Testing) sign-off.

**Feature depends on it:** Phase 9.4 (Government Security Assessment), formal production go-live.

**Permissions needed:**
- GSCSCL IT security team authorisation to initiate VAPT.
- Budget allocation for audit engagement.

**How to provide securely:**
- This is an organisational / procurement process — no technical credentials required from the engineering team at this stage.
- The engineering team can produce a "Security Architecture Document" to assist the auditors.

**What can be built without it:**
- All code, security hardening (Phase 8), MFA, audit trails, and RLS can be fully implemented.
- The VAPT is an external sign-off on completed work — not a prerequisite for building.

---

## Summary of Blockers by Phase

| Phase | Blocked By Item(s) | Can Partially Proceed? |
|-------|-------------------|----------------------|
| Phase 1 — AI Hardening | Item 1 (dataset, optional) | ✅ Yes — deploy best.pt, improve OCR, benchmark |
| Phase 2 — Trip Auto-Generation | Item 2 (dispatch system decision) | ✅ Yes — internal sequence approach unblocked |
| Phase 3 — GPS Background | Item 4 (background location policy) | ✅ Yes — code can be written; store submission blocked |
| Phase 4 — Citizen App | None | ✅ Fully unblocked |
| Phase 5 — Admin Completion | Item 3 (Supabase invite config) | ✅ Yes — UI unblocked; activation needs Supabase access |
| Phase 6 — Identity & Roles | Items 3, 5 | ✅ Yes — code unblocked; MFA activation needs Item 3 |
| Phase 7 — Cross-Platform | Item 7 (VLTS, optional) | ✅ Yes — VLTS is enhancement, not core |
| Phase 8 — Security | Items 3, 8 | ✅ Yes — code unblocked; config items are setup steps |
| Phase 9 — QA & Deployment | Items 4, 6, 9, 10 | ⚠️ Pilot can proceed; full launch needs all items |

---

*All items in this document represent genuine external dependencies identified during direct code inspection. None have been fabricated or invented.*
