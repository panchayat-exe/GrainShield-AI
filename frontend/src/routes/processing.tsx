import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Circle, AlertTriangle } from "lucide-react";
import { AppShell, Card, btn } from "@/components/AppShell";
import { getLatestVerification, subscribeToTripVerifications } from "@/lib/services/verification";
import { getTripById } from "@/lib/services/trips";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationResult } from "@/lib/supabase/types";

export const Route = createFileRoute("/processing")({
  validateSearch: (s: Record<string, unknown>) => ({
    tripId: typeof s["tripId"] === "string" ? s["tripId"] : null,
  }),
  head: () => ({
    meta: [
      { title: "AI Verification in Progress | GrainShield AI" },
      { name: "description", content: "Live AI analysis of the uploaded trip photo." },
    ],
  }),
  component: Processing,
});

const STEPS = [
  "Image Quality",
  "Vehicle Detection",
  "Plate OCR",
  "Evidence Checks",
  "Final Decision",
];

const STATUS_STEP: Record<string, number> = {
  pending: 0,
  processing: 2,
  pass: 5,
  retake: 5,
  manual_review: 5,
  error: 5,
};

function Processing() {
  const nav = useNavigate();
  const { tripId } = Route.useSearch();
  const { user } = useAuth();

  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [tripCode, setTripCode] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [waitingSeconds, setWaitingSeconds] = useState(0);

  // Load initial state
  useEffect(() => {
    if (!tripId) {
      setLoadingInitial(false);
      setNotFound(true);
      return;
    }
    void (async () => {
      const [trip, result] = await Promise.all([
        getTripById(tripId),
        getLatestVerification(tripId),
      ]);
      if (!trip) {
        setNotFound(true);
      } else {
        setTripCode(trip.trip_code);
      }
      setVerification(result);
      setLoadingInitial(false);
    })();
  }, [tripId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!tripId) return;
    const unsub = subscribeToTripVerifications(tripId, (updated) => {
      setVerification(updated);
    });
    return unsub;
  }, [tripId]);

  // Fallback polling: polls every 3s in case Realtime WebSocket is delayed or disconnected
  useEffect(() => {
    if (!tripId) return;
    const isDone =
      verification?.status === "pass" ||
      verification?.status === "retake" ||
      verification?.status === "manual_review" ||
      verification?.status === "error";

    if (isDone) return;

    const intervalId = setInterval(async () => {
      const latest = await getLatestVerification(tripId);
      if (latest) {
        setVerification((prev) => {
          if (
            !prev ||
            prev.status !== latest.status ||
            prev.id !== latest.id ||
            prev.updated_at !== latest.updated_at
          ) {
            return latest;
          }
          return prev;
        });
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [tripId, verification?.status, verification?.id, verification?.updated_at]);

  // Track elapsed waiting time for stuck/delayed job visibility
  useEffect(() => {
    const isDone =
      verification?.status === "pass" ||
      verification?.status === "retake" ||
      verification?.status === "manual_review" ||
      verification?.status === "error";

    if (isDone) return;

    const timer = setInterval(() => {
      setWaitingSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [verification?.status]);

  // Navigate when completed
  useEffect(() => {
    if (!verification) return;
    if (verification.status === "pass") {
      setTimeout(() => void nav({ to: "/result", search: { tripId: tripId ?? "" } }), 1200);
    } else if (
      verification.status === "retake" ||
      verification.status === "manual_review" ||
      verification.status === "error"
    ) {
      setTimeout(() => void nav({ to: "/failed", search: { tripId: tripId ?? "" } }), 1200);
    }
  }, [verification, tripId, nav]);

  if (!user) {
    return (
      <AppShell
        crumbs={["Home", "Verification", "Live Processing"]}
        title="AI Verification in Progress"
      >
        <div className="rounded-2xl border border-info/30 bg-info-soft p-6 text-center text-sm">
          Please{" "}
          <Link to="/login" className="text-info underline">
            sign in
          </Link>{" "}
          to view verification status.
        </div>
      </AppShell>
    );
  }

  if (loadingInitial) {
    return (
      <AppShell
        crumbs={["Home", "Verification", "Live Processing"]}
        title="AI Verification in Progress"
        subtitle="Loading verification status…"
      >
        <div className="flex justify-center py-8">
          <Loader2 className="h-10 w-10 animate-spin text-info" />
        </div>
      </AppShell>
    );
  }

  if (notFound || !tripId) {
    return (
      <AppShell crumbs={["Home", "Verification"]} title="Verification">
        <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          Trip not found or you don&apos;t have access to this trip.{" "}
          <Link to="/" className="underline">
            Upload a new photo
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const status = verification?.status ?? "pending";
  const activeStep = STATUS_STEP[status] ?? 0;
  const isDone =
    status === "pass" || status === "retake" || status === "manual_review" || status === "error";

  const progressPct = isDone ? 100 : Math.min(90, activeStep * 20 + 5);

  return (
    <AppShell
      crumbs={["Home", "Verification", "Live Processing"]}
      title="AI Verification in Progress"
      subtitle="Analyzing your image. Please do not close this page."
    >
      {/* Trip reference */}
      {tripCode && (
        <p className="text-sm text-muted-foreground">
          Trip: <span className="font-semibold text-foreground">{tripCode}</span>
        </p>
      )}

      <Card>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const stepStatus =
              isDone || i < activeStep ? "done" : i === activeStep ? "run" : "wait";
            return (
              <li
                key={s}
                className={`flex items-center gap-3 rounded-lg px-2 py-2.5 ${stepStatus === "run" ? "bg-info-soft" : ""}`}
              >
                {stepStatus === "done" ? (
                  <CheckCircle2 className="h-6 w-6 text-success" />
                ) : stepStatus === "run" ? (
                  <Loader2 className="h-6 w-6 animate-spin text-info" />
                ) : (
                  <Circle className="h-6 w-6 text-muted-foreground" />
                )}
                <span className="flex-1 text-sm font-medium">{s}</span>
                <span
                  className={`text-xs font-medium ${
                    stepStatus === "done"
                      ? "text-success"
                      : stepStatus === "run"
                        ? "text-info"
                        : "text-warning"
                  }`}
                >
                  {stepStatus === "done"
                    ? "Completed"
                    : stepStatus === "run"
                      ? "Processing…"
                      : "Pending"}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="border-info/30 bg-info-soft">
        <p className="text-sm font-semibold text-info">
          Current Step:{" "}
          {isDone
            ? status === "pass"
              ? "Verification Passed"
              : "Verification Complete"
            : (STEPS[activeStep] ?? "Queued")}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-info/20">
            <div
              className="h-full rounded-full bg-info transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs font-medium">{progressPct}%</span>
        </div>
      </Card>

      {/* Status-specific messages */}
      {!isDone && status === "pending" && (
        <div className="flex items-center gap-2 rounded-xl border border-saffron/50 bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Verification is queued. If no AI provider is configured, results will remain pending until
          a provider is set up or a manual review is triggered.
        </div>
      )}

      {isDone ? (
        <div className="grid grid-cols-2 gap-3">
          {status === "pass" ? (
            <Link to="/result" search={{ tripId: tripId }} className={btn.success}>
              View Result
            </Link>
          ) : (
            <Link to="/failed" search={{ tripId: tripId }} className={btn.danger}>
              View Result
            </Link>
          )}
          <Link to="/trip" search={{ tripId: tripId }} className={btn.outline}>
            Trip Details
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            Waiting for AI processor. This page will update automatically.
            {waitingSeconds > 0 && <span className="text-xs">({waitingSeconds}s elapsed)</span>}
          </p>
          {waitingSeconds >= 25 && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning">
              <span>
                Verification is taking longer than expected. You can check trip details or manual
                review options if needed.
              </span>
              <div className="flex gap-2 shrink-0">
                <Link to="/trip" search={{ tripId: tripId }} className="font-semibold underline">
                  Trip Details
                </Link>
                <span>•</span>
                <Link to="/failed" search={{ tripId: tripId }} className="font-semibold underline">
                  Manual Review
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
