import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
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

  if (!verification || verification.status !== "pass") {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Result"]} title="Verification Result">
        <div className="rounded-2xl border border-saffron/50 bg-warning-soft p-4 text-sm text-warning">
          This trip does not have a passing verification result.{" "}
          <Link to="/processing" search={{ tripId: tripId ?? "" }} className="underline">
            Check processing status
          </Link>
          .
        </div>
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
          tone={verification.vehicle_detected ? "success" : undefined}
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
