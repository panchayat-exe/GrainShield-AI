import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  XCircle,
  Clock,
  RefreshCcw,
  AlertTriangle,
  Bell,
} from "lucide-react";
import { AppShell, Card, Row } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { getTripById } from "@/lib/services/trips";
import { getEvidenceForTrip, getSignedUrl } from "@/lib/services/evidence";
import { getVerificationsForTrip } from "@/lib/services/verification";
import { getAuditLogsForTrip, auditActionLabel, formatTimestamp } from "@/lib/services/audit";
import type { Trip, TripEvidence, VerificationResult, AuditLog } from "@/lib/supabase/types";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/trip")({
  validateSearch: (s: Record<string, unknown>) => ({
    tripId: typeof s["tripId"] === "string" ? s["tripId"] : null,
  }),
  head: () => ({
    meta: [
      { title: "Trip Photo Verification | GrainShield AI" },
      { name: "description", content: "Trip details, evidence checklist and audit log." },
    ],
  }),
  component: Trip,
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

function statusLabel(s: string) {
  const m: Record<string, string> = {
    pending: "Pending",
    processing: "Processing",
    pass: "Pass",
    retake: "Retake",
    manual_review: "Manual Review",
    error: "Error",
    submitted: "Submitted",
    draft: "Draft",
    rejected: "Rejected",
    completed: "Completed",
  };
  return m[s] ?? s;
}

function Trip() {
  const { tripId } = Route.useSearch();
  const { user } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence[]>([]);
  const [verifications, setVerifications] = useState<VerificationResult[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [prevStatus, setPrevStatus] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    msg: string;
    type: "retake" | "rejected" | "pass" | "info";
  } | null>(null);

  useEffect(() => {
    if (!tripId || !user) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [t, evArr, verArr, logs] = await Promise.all([
        getTripById(tripId),
        getEvidenceForTrip(tripId),
        getVerificationsForTrip(tripId),
        getAuditLogsForTrip(tripId),
      ]);
      if (!t) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setTrip(t);
      setEvidence(evArr);
      setVerifications(verArr);
      setAuditLogs(logs);

      // Fetch signed URLs for all evidence photos
      const urls: Record<string, string> = {};
      await Promise.all(
        evArr.map(async (ev) => {
          if (ev.storage_path) {
            const url = await getSignedUrl(ev.storage_path);
            if (url) urls[ev.id] = url;
          }
        }),
      );
      setPhotoUrls(urls);
      setLoading(false);
    })();
  }, [tripId, user]);

  // Realtime + polling: refresh trip status when trip is in an active/processing state
  useEffect(() => {
    const activeStatuses = ["submitted", "processing", "manual_review"];
    if (!tripId || !user || !trip) return;
    if (!activeStatuses.includes(trip.status)) return;

    const pollId = setInterval(async () => {
      const [updated, verArr, logs] = await Promise.all([
        getTripById(tripId),
        getVerificationsForTrip(tripId),
        getAuditLogsForTrip(tripId),
      ]);
      if (updated) setTrip(updated);
      setVerifications(verArr);
      setAuditLogs(logs);
    }, 30_000);

    const channel = supabase
      .channel(`trip-status-${tripId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips", filter: `id=eq.${tripId}` },
        async (payload) => {
          const updated = payload.new as Trip;
          if (updated) setTrip(updated);
          const [verArr, logs] = await Promise.all([
            getVerificationsForTrip(tripId),
            getAuditLogsForTrip(tripId),
          ]);
          setVerifications(verArr);
          setAuditLogs(logs);
        },
      )
      .subscribe();

    return () => {
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [tripId, user, trip?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show status-change notification banner when trip status changes
  useEffect(() => {
    if (!trip) return;
    if (prevStatus && prevStatus !== trip.status) {
      const banners: Record<
        string,
        { msg: string; type: "retake" | "rejected" | "pass" | "info" }
      > = {
        retake: { msg: "Retake Required — please re-upload a clearer photo.", type: "retake" },
        rejected: {
          msg: "Trip has been rejected by an officer. Contact your supervisor.",
          type: "rejected",
        },
        pass: { msg: "Verification passed! Your trip evidence has been approved.", type: "pass" },
        completed: { msg: "Trip completed successfully.", type: "pass" },
        manual_review: { msg: "Your submission is under officer review.", type: "info" },
      };
      const banner = banners[trip.status];
      if (banner) setStatusBanner(banner);
    }
    setPrevStatus(trip.status);
  }, [trip?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <AppShell crumbs={["Home", "Trip Verification"]} title="Trip Photo Verification">
        {statusBanner && (
          <div
            className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${
              statusBanner.type === "retake"
                ? "border-saffron/60 bg-warning-soft text-warning"
                : statusBanner.type === "rejected"
                  ? "border-danger/60 bg-danger-soft text-danger"
                  : statusBanner.type === "pass"
                    ? "border-success/60 bg-success-soft text-success"
                    : "border-info/40 bg-info-soft text-info"
            }`}
          >
            <Bell className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="flex-1">{statusBanner.msg}</span>
            <button
              onClick={() => setStatusBanner(null)}
              className="shrink-0 text-xs underline opacity-70"
            >
              Dismiss
            </button>
          </div>
        )}
        {trip?.status === "retake" && (
          <div className="flex items-start gap-3 rounded-2xl border border-saffron/60 bg-warning-soft p-4">
            <RefreshCcw className="mt-0.5 h-6 w-6 shrink-0 text-warning" />
            <div>
              <p className="font-semibold text-warning">Retake Required</p>
              <p className="mt-1 text-sm text-muted-foreground">
                An officer needs you to re-submit a clearer photo. Go to the upload screen to try
                again.
              </p>
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-info/30 bg-info-soft p-4 text-sm text-center">
          Please{" "}
          <Link to="/login" className="text-info underline">
            sign in
          </Link>{" "}
          to view trip details.
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell crumbs={["Home", "Trip Verification"]} title="Trip Photo Verification">
        <div className="flex justify-center py-8">
          <Loader2 className="h-10 w-10 animate-spin text-info" />
        </div>
      </AppShell>
    );
  }

  if (notFound || !trip) {
    return (
      <AppShell crumbs={["Home", "Trip Verification"]} title="Trip Photo Verification">
        <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          Trip not found or access denied.{" "}
          <Link to="/" className="underline">
            Upload a new photo
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const latestVerification = verifications[0] ?? null;

  return (
    <AppShell
      crumbs={["Home", "Trip Verification", trip.trip_code]}
      title="Trip Photo Verification"
    >
      {/* Latest evidence photo */}
      {evidence[0] && photoUrls[evidence[0].id] && (
        <img
          src={photoUrls[evidence[0].id]}
          alt="Trip vehicle"
          width={1024}
          height={768}
          className="aspect-[4/3] w-full rounded-2xl object-cover"
        />
      )}

      <Card title="Trip Details">
        <Row label="Trip ID" value={trip.trip_code} />
        <Row label="Assigned Vehicle No." value={trip.vehicle_number} />
        <Row label="Trip Stage" value={stageName(trip.stage)} />
        <Row label="Status" value={statusLabel(trip.status)} />
        <Row label="Created" value={formatTimestamp(trip.created_at)} />
      </Card>

      {/* Evidence Checklist from verification */}
      <Card title="Evidence Checklist">
        {latestVerification ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border py-2.5 text-sm last:border-0">
              <span>Image Quality</span>
              <span
                className={`flex items-center gap-1.5 text-right font-medium ${latestVerification.image_quality === "clear" ? "text-success" : "text-danger"}`}
              >
                {latestVerification.image_quality === "clear" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {latestVerification.image_quality ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border py-2.5 text-sm last:border-0">
              <span>Vehicle Detection</span>
              <span
                className={`flex items-center gap-1.5 text-right font-medium ${latestVerification.vehicle_detected ? "text-success" : "text-danger"}`}
              >
                {latestVerification.vehicle_detected ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {latestVerification.vehicle_detected ? "Detected" : "Not Detected"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border py-2.5 text-sm last:border-0">
              <span>Number Plate OCR</span>
              <span
                className={`flex items-center gap-1.5 text-right font-medium ${latestVerification.plate_match ? "text-success" : "text-danger"}`}
              >
                {latestVerification.plate_match ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {latestVerification.detected_plate ?? "—"}{" "}
                {latestVerification.plate_match ? "(Match)" : "(Mismatch)"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border py-2.5 text-sm last:border-0">
              <span>Vehicle Type</span>
              <span className="flex items-center gap-1.5 text-right font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                {latestVerification.vehicle_type ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <span>Required Evidence</span>
              <span
                className={`flex items-center gap-1.5 text-right font-medium ${latestVerification.plate_match ? "text-success" : "text-warning"}`}
              >
                {latestVerification.plate_match ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {latestVerification.plate_match ? "Vehicle + Plate Visible" : "Incomplete"}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            No verification result yet.{" "}
            {latestVerification === null && tripId && (
              <Link to="/processing" search={{ tripId }} className="text-info underline">
                Check processing
              </Link>
            )}
          </p>
        )}
      </Card>

      {/* Previous verification attempts */}
      {verifications.length > 0 && (
        <>
          <h2 className="pt-2 text-base font-semibold">Verification Attempts</h2>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {verifications.map((v) => {
              const isPass = v.status === "pass";
              const isManual = v.status === "manual_review";
              const evId = v.evidence_id;
              return (
                <div
                  key={v.id}
                  className={`w-64 shrink-0 snap-start overflow-hidden rounded-2xl border ${
                    isPass
                      ? "border-success/40 bg-success-soft"
                      : isManual
                        ? "border-danger/40 bg-danger-soft"
                        : "border-saffron/50 bg-warning-soft"
                  }`}
                >
                  <p
                    className={`px-3 py-2 text-sm font-bold ${
                      isPass
                        ? "bg-success text-maroon-foreground"
                        : isManual
                          ? "bg-warning text-white"
                          : "bg-saffron text-saffron-foreground"
                    }`}
                  >
                    {v.status.toUpperCase().replace("_", " ")}
                  </p>
                  {photoUrls[evId] && (
                    <img
                      src={photoUrls[evId]}
                      alt="Evidence"
                      loading="lazy"
                      width={1024}
                      height={768}
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="p-3 text-sm">
                    <p className="font-semibold">{v.detected_plate ?? "Plate: —"}</p>
                    <p className="text-muted-foreground">
                      {v.explanation ?? (isPass ? "All checks passed." : "See failure reasons.")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTimestamp(v.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Audit Log */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Audit Log
          </span>
        }
      >
        {auditLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events yet.</p>
        ) : (
          auditLogs.map((log) => (
            <Row
              key={log.id}
              label={auditActionLabel(log.action)}
              value={formatTimestamp(log.created_at)}
            />
          ))
        )}
      </Card>
    </AppShell>
  );
}
