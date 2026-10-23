import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { XCircle, RotateCcw, UserCheck, Lightbulb, Loader2, AlertCircle } from "lucide-react";
import { AppShell, Card, Row, btn } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getLatestVerification } from "@/lib/services/verification";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { submitManualReview } from "@/lib/services/reviews";
import { formatTimestamp } from "@/lib/services/audit";
import type { Trip, VerificationResult, TripEvidence } from "@/lib/supabase/types";

export const Route = createFileRoute("/failed")({
  validateSearch: (s: Record<string, unknown>) => ({
    tripId: typeof s["tripId"] === "string" ? s["tripId"] : null,
  }),
  head: () => ({
    meta: [
      { title: "Verification Failed | GrainShield AI" },
      {
        name: "description",
        content: "Trip photo could not be verified. Retake or send for manual review.",
      },
    ],
  }),
  component: Failed,
});

function stageName(s: string) {
  return s === "first_mile"
    ? "First Mile"
    : s === "mid_mile"
      ? "Mid Mile"
      : s === "last_mile"
        ? "Last Mile"
        : s;
}

function Failed() {
  const nav = useNavigate();
  const { tripId } = Route.useSearch();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notAuthorized, setNotAuthorized] = useState(false);

  useEffect(() => {
    if (!tripId || !user) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [t, v, evArr] = await Promise.all([
        getTripById(tripId),
        getLatestVerification(tripId),
        getEvidenceForTrip(tripId),
      ]);
      if (!t) {
        setNotAuthorized(true);
        setLoading(false);
        return;
      }
      setTrip(t);
      setVerification(v);
      const ev = evArr[0] ?? null;
      setEvidence(ev);
      if (ev?.storage_path) {
        const url = await getSignedUrl(ev.storage_path);
        setPhotoUrl(url);
      }
      setLoading(false);
    })();
  }, [tripId, user]);

  async function handleManualReview() {
    if (!trip || !evidence || !user) return;
    setReviewLoading(true);
    setReviewMessage(null);
    const { error } = await submitManualReview({
      tripId: trip.id,
      evidenceId: evidence.id,
      requestedBy: user.id,
      notes: "Requested via Failed Verification page",
    });
    setReviewLoading(false);
    if (error) {
      setReviewMessage({ ok: false, text: error });
    } else {
      setReviewMessage({
        ok: true,
        text: "Manual review request submitted. An officer will review your submission.",
      });
    }
  }

  if (!user) {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="rounded-2xl border border-info/30 bg-info-soft p-4 text-sm text-center">
          Please{" "}
          <Link to="/login" className="text-info underline">
            sign in
          </Link>{" "}
          to view this result.
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="flex justify-center py-8">
          <Loader2 className="h-10 w-10 animate-spin text-info" />
        </div>
      </AppShell>
    );
  }

  if (notAuthorized || !trip) {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          Trip not found or access denied.{" "}
          <Link to="/" className="underline">
            Go to Upload
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  // No failed result yet — still pending
  if (!verification || verification.status === "pending" || verification.status === "processing") {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="rounded-2xl border border-saffron/50 bg-warning-soft p-4 text-sm text-warning">
          Verification is still in progress.{" "}
          <Link to="/processing" search={{ tripId: tripId ?? "" }} className="underline">
            Check processing status
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const failureReasons: Array<{
    label: string;
    value: string;
    tone?: "success" | "danger" | "warning";
  }> = [];
  if (verification.image_quality && verification.image_quality !== "clear") {
    failureReasons.push({
      label: "Image Quality",
      value: verification.image_quality,
      tone: "danger",
    });
  }
  if (verification.vehicle_detected === false) {
    failureReasons.push({ label: "Vehicle Detection", value: "Not detected", tone: "danger" });
  }
  if (verification.plate_match === false) {
    failureReasons.push({
      label: "Number Plate",
      value: "Not readable / Mismatch",
      tone: "danger",
    });
  }
  if (verification.detected_plate) {
    failureReasons.push({
      label: "Detected Plate",
      value: verification.detected_plate,
    });
  }
  if (verification.expected_plate) {
    failureReasons.push({
      label: "Expected Plate",
      value: verification.expected_plate,
    });
  }

  if (failureReasons.length === 0) {
    failureReasons.push({
      label: "Reason",
      value: verification.explanation ?? "Verification could not be completed",
      tone: "danger",
    });
  }

  const attempt = 1; // In a full implementation, count previous attempts

  return (
    <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
      <div className="flex items-center gap-4 rounded-2xl border border-danger/40 bg-danger-soft p-4">
        <XCircle className="h-12 w-12 shrink-0 text-danger" />
        <div>
          <p className="text-3xl font-bold text-danger">
            {verification.status === "manual_review" ? "MANUAL REVIEW" : "FAILED"}
          </p>
          <p className="text-sm text-danger">
            {verification.status === "manual_review"
              ? "Sent for manual review"
              : "Photo could not be verified"}
          </p>
        </div>
      </div>

      {photoUrl && (
        <img
          src={photoUrl}
          alt="Rejected vehicle photo"
          width={1024}
          height={768}
          className="aspect-[4/3] w-full rounded-2xl object-cover"
        />
      )}

      <Card title="Failure Reasons">
        {failureReasons.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} {...(r.tone ? { tone: r.tone } : {})} />
        ))}
        <Row label="Trip Stage" value={stageName(evidence?.stage ?? trip.stage)} />
      </Card>

      <div className="rounded-2xl border border-saffron/50 bg-warning-soft p-4 text-sm">
        <p className="mb-2 flex items-center gap-2 font-semibold text-warning">
          <Lightbulb className="h-4 w-4" />
          How to fix
        </p>
        <ul className="list-disc space-y-1 pl-6 marker:text-saffron">
          <li>Take the photo in daylight</li>
          <li>Hold the phone steady, vehicle stationary</li>
          <li>Keep the number plate fully in frame</li>
        </ul>
      </div>

      <Card title="Summary">
        <Row label="Trip ID" value={trip.trip_code} />
        <Row
          label="Activity Time"
          value={
            verification.processing_completed_at
              ? formatTimestamp(verification.processing_completed_at)
              : formatTimestamp(verification.created_at)
          }
        />
        <Row label="Attempt" value={`${attempt} of 3`} />
        <Row label="Processed By" value={verification.processor_version ?? "AI System"} />
      </Card>

      {reviewMessage && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${reviewMessage.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger-soft text-danger"}`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {reviewMessage.text}
        </div>
      )}

      <div className="space-y-3">
        <button className={btn.saffron} onClick={() => void nav({ to: "/", search: {} })}>
          <RotateCcw className="h-5 w-5" />
          Retake Photo
        </button>
        <button
          className={btn.maroon}
          onClick={() => {
            void handleManualReview();
          }}
          disabled={reviewLoading || reviewMessage?.ok === true}
        >
          {reviewLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <UserCheck className="h-5 w-5" />
              Send for Manual Review
            </>
          )}
        </button>
        <Link to="/trip" search={{ tripId: tripId ?? "" }} className={btn.outline}>
          Back to Trip Report
        </Link>
      </div>
    </AppShell>
  );
}
