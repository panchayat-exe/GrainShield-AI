// Supabase Edge Function: send-trip-notification
// Triggered by: Database Webhook on public.trips UPDATE
// Purpose: Send email + Expo push when trip.status changes
//
// Setup in Supabase Dashboard:
//   1. Database → Webhooks → Create new webhook
//   2. Table: public.trips, Events: UPDATE
//   3. HTTP Request → Edge Function URL
//   4. Set secrets: RESEND_API_KEY (or SENDGRID_API_KEY)
//
// Environment variables required:
//   SUPABASE_URL          - your project URL
//   SUPABASE_SERVICE_ROLE_KEY - service role key (bypass RLS)
//   RESEND_API_KEY        - Resend.com API key for email
//   EXPO_ACCESS_TOKEN     - Expo push API token (optional)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

const STATUS_MESSAGES: Record<string, { subject: string; body: string; emoji: string }> = {
  pass: {
    emoji: "✅",
    subject: "Your GrainShield AI Trip Has Passed Verification",
    body: "Great news! Your trip has been verified and passed all checkpoints. The grain transport has been officially cleared.",
  },
  rejected: {
    emoji: "❌",
    subject: "Your GrainShield AI Trip Has Been Rejected",
    body: "Your trip evidence was reviewed and rejected by an officer. Please contact your district officer for details.",
  },
  retake: {
    emoji: "🔄",
    subject: "GrainShield AI: Retake Required for Your Trip",
    body: "Your trip evidence was unclear. Please retake and resubmit a clearer photograph of the vehicle and grain load.",
  },
  manual_review: {
    emoji: "🔍",
    subject: "GrainShield AI: Your Trip is Under Manual Review",
    body: "Your trip evidence has been flagged for manual review by an officer. You will be notified of the result shortly.",
  },
  completed: {
    emoji: "🏁",
    subject: "GrainShield AI: Trip Completed",
    body: "Your trip has been marked as completed. Thank you for using GrainShield AI.",
  },
};

serve(async (req: Request) => {
  try {
    const payload = await req.json();

    // Supabase webhook sends { type, table, record, old_record, schema }
    const { type, record, old_record } = payload;

    if (type !== "UPDATE" || !record || !old_record) {
      return new Response(JSON.stringify({ skipped: "not an UPDATE" }), { status: 200 });
    }

    // Only act when status actually changed
    if (record.status === old_record.status) {
      return new Response(JSON.stringify({ skipped: "status unchanged" }), { status: 200 });
    }

    const newStatus: string = record.status;
    const msgConfig = STATUS_MESSAGES[newStatus];
    if (!msgConfig) {
      return new Response(JSON.stringify({ skipped: `no template for status: ${newStatus}` }), { status: 200 });
    }

    // Fetch user profile (email + push_token)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const userId = record.created_by ?? record.driver_id ?? record.assigned_to;
    if (!userId) {
      return new Response(JSON.stringify({ skipped: "no user to notify" }), { status: 200 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, push_token")
      .eq("id", userId)
      .maybeSingle();

    // Fetch email from auth.users via service role
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const email = authUser?.user?.email;
    const pushToken = profile?.push_token;
    const name = profile?.full_name ?? "Driver";
    const tripCode = record.trip_code ?? record.id;

    const results: Record<string, unknown> = {};

    // ── Send Email via Resend ──────────────────────────────────
    if (email && RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "GrainShield AI <noreply@grainshield.gov.in>",
          to: [email],
          subject: `${msgConfig.emoji} [${tripCode}] ${msgConfig.subject}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
              <div style="background:#7C0A02;padding:16px;border-radius:8px 8px 0 0">
                <h1 style="color:#C8972B;margin:0;font-size:20px">GrainShield AI</h1>
              </div>
              <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e5e5">
                <p style="font-size:16px;color:#1B2A4A">Dear ${name},</p>
                <p style="font-size:15px;color:#333">${msgConfig.body}</p>
                <div style="background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:12px;margin:16px 0">
                  <p style="margin:0;font-size:13px;color:#666">Trip Code</p>
                  <p style="margin:4px 0 0;font-size:18px;font-weight:700;font-family:monospace;color:#1B2A4A">${tripCode}</p>
                </div>
                <p style="font-size:13px;color:#999">This is an automated notification from the GrainShield AI platform.</p>
              </div>
            </div>
          `,
        }),
      });
      results.email = { status: emailRes.status, ok: emailRes.ok };
    } else {
      results.email = { skipped: !RESEND_API_KEY ? "no RESEND_API_KEY" : "no email" };
    }

    // ── Send Expo Push Notification ───────────────────────────
    if (pushToken && pushToken.startsWith("ExponentPushToken[")) {
      const pushHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      };
      if (EXPO_ACCESS_TOKEN) {
        pushHeaders["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
      }

      const pushRes = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: pushHeaders,
        body: JSON.stringify({
          to: pushToken,
          sound: "default",
          title: `${msgConfig.emoji} Trip ${tripCode}`,
          body: msgConfig.body,
          data: { tripId: record.id, tripCode, status: newStatus },
          channelId: "grainshield",
        }),
      });
      results.push = { status: pushRes.status, ok: pushRes.ok };
    } else {
      results.push = { skipped: pushToken ? "invalid token format" : "no push token" };
    }

    return new Response(JSON.stringify({ success: true, tripCode, newStatus, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-trip-notification] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
