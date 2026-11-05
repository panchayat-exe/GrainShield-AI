import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, AlertTriangle, XCircle, RefreshCcw } from "lucide-react";
import { AppShell, Card, Row, btn } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getLatestVerification } from "@/lib/services/verification";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { formatTimestamp } from "@/lib/services/audit";
import type { Trip, VerificationResult, TripEvidence } from "@/lib/supabase/types";

export const Route = createFileRoute("/result")({
  validateSearch: (s: Record<string, unknown>) => ({
    tripId: typeof s["tripId"] === "string" ? s["tripId"] : null,
  }),
  head: () => ({
    meta: [
      { title: "Verification Passed | GrainShield AI" },
      { name: "description", content: "Trip photo verified successfully by GrainShield AI." },
    ],
  }),
  component: Result,
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

function Result() {
  const { tripId } = Route.useSearch();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notAuthorized, setNotAuthorized] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);

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

  // Poll when trip is in retake/manual_review state so the page auto-refreshes
  useEffect(() => {
    if (!tripId || !user || !trip) return;
    const activeStatuses = ["retake", "manual_review", "submitted", "processing"];
    if (!activeStatuses.includes(trip.status)) {
      setPollingActive(false);
      return;
    }
    setPollingActive(true);
    const id = setInterval(async () => {
      const t = await getTripById(tripId);
      if (t) setTrip(t);
    }, 20_000);
    return () => clearInterval(id);
  }, [tripId, user, trip?.status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- RETAKE REQUIRED SCREEN ---
  if (trip.status === "retake") {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="flex items-start gap-4 rounded-2xl border border-saffron/60 bg-warning-soft p-5">
          <RefreshCcw className="mt-0.5 h-8 w-8 shrink-0 text-warning" />
          <div>
            <p className="text-xl font-bold text-warning">Retake Required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The officer has reviewed your submission and determined it needs to be retaken. Please
              re-upload a clearer photo showing the vehicle number plate and vehicle type.
            </p>
          </div>
        </div>
        <Link
          to="/"
          search={{ tripId: tripId ?? "" }}
          className={btn.maroon + " flex items-center justify-center gap-2"}
        >
          <RefreshCcw className="h-4 w-4" />
          Upload New Photo
        </Link>
        <Link to="/trip" search={{ tripId: tripId ?? "" }} className={btn.outline}>
          Back to Trip Report
        </Link>
        {pollingActive && (
          <p className="text-center text-xs text-muted-foreground">
            Auto-refreshing status&hellip;
          </p>
        )}
      </AppShell>
    );
  }

  // --- REJECTED SCREEN ---
  if (trip.status === "rejected") {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="flex items-start gap-4 rounded-2xl border border-danger/60 bg-danger-soft p-5">
          <XCircle className="mt-0.5 h-8 w-8 shrink-0 text-danger" />
          <div>
            <p className="text-xl font-bold text-danger">Trip Rejected</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This trip has been rejected after officer review. Contact your district supervisor for
              further instructions.
            </p>
          </div>
        </div>
        <Link to="/my-trips" className={btn.outline}>
          View All My Trips
        </Link>
      </AppShell>
    );
  }

  // --- MANUAL REVIEW / PROCESSING SCREEN ---
  if (!verification || verification.status !== "pass") {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="flex items-start gap-4 rounded-2xl border border-info/40 bg-info-soft p-5">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-info" />
          <div>
            <p className="font-semibold">Verification In Progress</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your submission is being reviewed. This page will update automatically.
            </p>
          </div>
        </div>
        <Link to="/processing" search={{ tripId: tripId ?? "" }} className={btn.outline}>
          Check processing status
        </Link>
        {pollingActive && (
          <p className="text-center text-xs text-muted-foreground">
            Auto-refreshing status&hellip;
          </p>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
      <div className="flex items-center gap-4 rounded-2xl border border-success/40 bg-success-soft p-4">
        <CheckCircle2 className="h-12 w-12 shrink-0 text-success" />
        <div>
          <p className="text-3xl font-bold text-success">PASS</p>
          <p className="text-sm text-success">Photo verified successfully</p>
        </div>
      </div>

      {photoUrl && (
        <img
          src={photoUrl}
          alt="Verified vehicle"
          width={1024}
          height={768}
          className="aspect-[4/3] w-full rounded-2xl object-cover"
        />
      )}

      <Card title="Extracted Details">
        <Row
          label="Vehicle Number"
          value={`${verification.detected_plate ?? "—"} ${verification.plate_match ? "(Match)" : ""}`}
          tone={verification.plate_match ? "success" : "warning"}
        />
        <Row
          label="Vehicle Type"
          value={verification.vehicle_type ?? "—"}
          {...(verification.vehicle_detected ? { tone: "success" as const } : {})}
        />
        <Row label="Image Quality" value={verification.image_quality ?? "—"} tone="success" />
        <Row label="Trip Stage" value={stageName(evidence?.stage ?? trip.stage)} tone="success" />
        <Row
          label="Evidence"
          value={verification.plate_match ? "Vehicle + Plate Visible" : "Plate not verified"}
          tone={verification.plate_match ? "success" : "warning"}
        />
      </Card>

      <Card title="Summary">
        <Row label="Trip ID" value={trip.trip_code} />
        <Row
          label="Activity Time"
          value={
            verification.processing_completed_at
              ? formatTimestamp(verification.processing_completed_at)
              : "—"
          }
        />
        <Row label="Processed By" value={verification.processor_version ?? "AI System"} />
        {verification.confidence !== null && (
          <Row label="Confidence" value={`${Math.round((verification.confidence ?? 0) * 100)}%`} />
        )}
      </Card>

      <Link to="/trip" search={{ tripId: tripId ?? "" }} className={btn.outline}>
        Back to Trip Report
      </Link>
    </AppShell>
  );
}
