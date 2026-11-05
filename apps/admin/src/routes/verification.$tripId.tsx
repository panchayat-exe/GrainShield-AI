import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ArrowRight,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  MapPin,
  Maximize2,
  ScanLine,
  Truck,
  XCircle,
  RotateCcw,
  ShieldAlert,
  AlertTriangle,
  User,
  Info,
  Clock,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Card, PageHeader, btn, Badge } from "@/components/admin/AdminShell";
import truckPlaceholder from "@/assets/truck.jpg";
import { getTripDetail, getEvidenceSignedUrl, resolveManualReview } from "@/lib/admin-queries";
import { getAdminSession, type AdminUser } from "@/lib/admin-auth";
import type {
  Trip,
  TripEvidence,
  VerificationResult,
  ManualReviewRequest,
  TripLocation,
} from "@/lib/supabase";

export interface VerificationDetailData {
  trip: Trip | null;
  evidence: TripEvidence[];
  verifications: (VerificationResult & { vehicle_type?: string; vehicle_detected?: boolean })[];
  reviews: ManualReviewRequest[];
  locations: TripLocation[];
  error: string | null;
  adminUser: AdminUser | null;
}

export const Route = createFileRoute("/verification/$tripId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.tripId} Verification — GrainShield AI` },
      {
        name: "description",
        content: `AI photo verification results and manual review for ${params.tripId}.`,
      },
      { property: "og:title", content: `${params.tripId} Verification — GrainShield AI` },
      {
        property: "og:description",
        content: `AI photo verification results and manual review for ${params.tripId}.`,
      },
    ],
  }),
  loader: async ({ params }) => {
    const [detail, session] = await Promise.all([getTripDetail(params.tripId), getAdminSession()]);
    return { ...detail, adminUser: session };
  },
  component: Detail,
});

const stageLabels: Record<string, string> = {
  first_mile: "First Mile (Mandi → Godown)",
  mid_mile: "Middle Mile (Buffer Transfer)",
  last_mile: "Last Mile (Godown → FPS)",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  processing: "Processing",
  pass: "Pass",
  retake: "Retake Required",
  manual_review: "Under Review",
  rejected: "Rejected",
  completed: "Completed",
};

function Detail() {
  const { tripId } = Route.useParams();
  const loaderData = (Route.useLoaderData() ?? {}) as unknown as VerificationDetailData;
  const { trip, evidence, verifications, reviews, locations, error, adminUser } = loaderData;
  const router = useRouter();

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Review Form State
  const [selectedDecision, setSelectedDecision] = useState<"pass" | "retake" | "rejected" | null>(
    null,
  );
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const latestVerification = verifications?.[0] ?? null;
  const latestEvidence = evidence?.[0] ?? null;
  const activeReview =
    reviews?.find((r: { status: string }) => r.status !== "resolved") ?? reviews?.[0] ?? null;

  // Load signed URLs for ALL evidence photos
  useEffect(() => {
    let cancelled = false;
    async function loadAllSignedUrls() {
      if (!evidence?.length) return;
      const entries = await Promise.all(
        evidence.map(async (ev) => {
          if (!ev.storage_path) return [ev.id, null] as const;
          const res = await getEvidenceSignedUrl(ev.storage_path, 600);
          return [ev.id, res.url ?? null] as const;
        }),
      );
      if (!cancelled) {
        const urlMap: Record<string, string> = {};
        for (const [id, url] of entries) {
          if (id && url) urlMap[id] = url;
        }
        setImageUrls(urlMap);
      }
    }
    void loadAllSignedUrls();
    return () => {
      cancelled = true;
    };
  }, [evidence]);

  const handleConfirmReview = async () => {
    if (!selectedDecision) return;
    if (!reviewerNotes || reviewerNotes.trim().length < 5) {
      setValidationError("Justification notes are mandatory (minimum 5 characters).");
      return;
    }
    if (!adminUser?.id) {
      setValidationError("Session expired. Please sign in again.");
      return;
    }

    setValidationError(null);
    setActionLoading(true);
    setActionMessage(null);

    // Guard: a manual_review_requests row must exist — the RPC looks up by review UUID.
    // If no review row exists (trip is in manual_review but no request was created),
    // show a clear error rather than passing the trip ID as the review ID.
    if (!activeReview?.id) {
      setActionMessage({
        type: "error",
        text: "No pending review request found for this trip. The AI worker may not have created one yet. Please wait and refresh, or contact a system administrator.",
      });
      setActionLoading(false);
      return;
    }

    const res = await resolveManualReview({
      reviewId: activeReview.id,
      tripId: trip?.id ?? tripId,
      decision: selectedDecision,
      notes: reviewerNotes.trim(),
      reviewerId: adminUser.id,
      reviewerEmail: adminUser.email,
    });

    if (res.error) {
      setActionMessage({ type: "error", text: `Review failed: ${res.error}` });
      setActionLoading(false);
    } else {
      setActionMessage({
        type: "success",
        text: `Manual review recorded successfully: ${selectedDecision.toUpperCase()}. Audit log persisted.`,
      });
      setSelectedDecision(null);
      setReviewerNotes("");
      setActionLoading(false);
      await router.invalidate();
    }
  };

  const tripDisplayCode = trip?.trip_code ?? tripId;
  const vehicleNumber = trip?.vehicle_number ?? latestVerification?.expected_plate ?? "—";
  const stageName = trip ? (stageLabels[trip.stage] ?? trip.stage) : "First Mile";
  const statusName = trip ? (statusLabels[trip.status] ?? trip.status) : "Under Review";
  const originName = trip?.origin ?? "Gujarat FCI Godown";
  const destName = trip?.destination ?? "Fair Price Shop";
  const formattedDate = trip?.created_at
    ? new Date(trip.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "—";

  const summary = [
    ["Trip ID", tripDisplayCode, ScanLine],
    ["Vehicle No. (RC)", vehicleNumber, Car],
    ["Logistics Stage", stageName, Truck],
    ["Registered Date", formattedDate, Calendar],
    ["Route", `${originName} → ${destName}`, MapPin],
  ] as const;

  // AI Verification Checks Extraction
  const evidenceChecks = (latestVerification?.evidence_checks ?? {}) as Record<string, unknown>;
  const fpsBanner = (evidenceChecks["fps_banner"] ?? {}) as Record<string, unknown>;
  const confidenceScore =
    latestVerification?.confidence != null
      ? `${(latestVerification.confidence * 100).toFixed(1)}%`
      : "N/A";

  const durationMs =
    latestVerification?.processing_started_at && latestVerification?.processing_completed_at
      ? Math.max(
          0,
          new Date(latestVerification.processing_completed_at).getTime() -
            new Date(latestVerification.processing_started_at).getTime(),
        )
      : null;

  const checks = [
    {
      label: "Vehicle Detection",
      val: latestVerification?.vehicle_detected
        ? "Vehicle Detected"
        : latestVerification
          ? "Not Detected"
          : "Detected (Fallback)",
      pass: latestVerification?.vehicle_detected !== false,
    },
    {
      label: "Vehicle Classification",
      val: latestVerification?.vehicle_type
        ? latestVerification.vehicle_type.toUpperCase()
        : "Transport Vehicle (Truck)",
      pass: true,
    },
    {
      label: "Number Plate Match",
      val: latestVerification?.detected_plate
        ? `${latestVerification.detected_plate} (${latestVerification.plate_match ? "Matched ✓" : "Mismatch ✗"})`
        : latestVerification
          ? "Unreadable / No plate crop"
          : `${vehicleNumber} (Expected)`,
      pass: latestVerification?.plate_match === true,
    },
    {
      label: "Model Confidence",
      val: confidenceScore,
      pass: latestVerification?.confidence != null ? latestVerification.confidence >= 0.75 : true,
    },
    {
      label: "Image Quality Assessment",
      val: latestVerification?.image_quality
        ? latestVerification.image_quality.toUpperCase()
        : "CLEAR",
      pass:
        latestVerification?.image_quality === "good" ||
        latestVerification?.image_quality === "clear" ||
        !latestVerification?.image_quality,
    },
    {
      label: "FPS Person Detection",
      val: evidenceChecks["fps_person_detected"] ? "Person Detected" : "Not Required / Not Found",
      pass: true,
    },
    {
      label: "FPS Board / Banner",
      val: fpsBanner["banner_detected"]
        ? `Verified (${(fpsBanner["keywords_found"] as string[] | undefined)?.join(", ") || "Shop Identified"})`
        : "Standard Verification",
      pass: true,
    },
  ];

  const decisionStatus = (
    latestVerification?.decision ??
    trip?.status ??
    "manual_review"
  ).toUpperCase();
  const isPass = decisionStatus === "PASS";
  const isRejected = decisionStatus === "REJECTED" || decisionStatus === "FAIL";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Trip Verification", to: "/verification" }, { label: tripDisplayCode }]}
        title={`Verification Details: ${tripDisplayCode}`}
        right={
          <div className="text-right text-sm">
            <span
              className={`mb-1 inline-block rounded-md px-3 py-1 font-semibold ${
                isPass
                  ? "bg-success-soft text-success"
                  : isRejected
                    ? "bg-danger-soft text-destructive"
                    : "bg-warning-soft text-warning"
              }`}
            >
              {statusName}
            </span>
            <div className="text-xs text-muted-foreground">
              Officer: {adminUser?.full_name || adminUser?.email}
            </div>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Database note: {error}
        </div>
      )}

      {actionMessage && (
        <div
          className={`mb-4 rounded-md p-3 text-sm ${
            actionMessage.type === "success"
              ? "border border-success/30 bg-success-soft text-success"
              : "border border-destructive/30 bg-danger-soft text-destructive"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Summary Header Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5 shadow-card md:grid-cols-5">
        {summary.map(([l, v, I]) => (
          <div key={l} className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-info-soft text-navy">
              <I className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{l}</div>
              <div className="text-sm font-medium">{v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Uploaded Image & AI Findings */}
        <Card title="Transport Evidence & Computer Vision Findings" className="lg:col-span-2">
          <div className="grid gap-5 md:grid-cols-[280px_1fr]">
            <div className="space-y-4">
              {(evidence ?? []).length === 0 ? (
                <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  No evidence photos uploaded for this trip.
                </div>
              ) : (
                (evidence ?? []).map((ev, idx) => {
                  const evUrl = imageUrls[ev.id] ?? null;
                  const evVer =
                    verifications?.find((v) => v.evidence_id === ev.id) ??
                    (idx === 0 ? latestVerification : null);
                  return (
                    <div
                      key={ev.id}
                      className="rounded-lg border border-border bg-card shadow-sm overflow-hidden"
                    >
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border text-xs text-muted-foreground">
                        <span className="font-medium">
                          Photo {idx + 1} of {(evidence ?? []).length}
                        </span>
                        {evVer && (
                          <span
                            className={`rounded px-2 py-0.5 font-semibold ${
                              evVer.decision === "pass"
                                ? "bg-success-soft text-success"
                                : evVer.decision === "fail"
                                  ? "bg-danger-soft text-destructive"
                                  : "bg-warning-soft text-warning"
                            }`}
                          >
                            AI: {(evVer.decision ?? "pending").toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="relative overflow-hidden bg-black/5">
                        <img
                          src={evUrl ?? truckPlaceholder}
                          alt={`Evidence photo ${idx + 1}`}
                          width={1024}
                          height={768}
                          className="aspect-[4/3] w-full object-cover transition-transform hover:scale-105"
                        />
                      </div>
                      <div className="p-2.5 space-y-1 text-xs text-muted-foreground">
                        {ev.original_filename && (
                          <div>
                            <b>File:</b> {ev.original_filename}
                          </div>
                        )}
                        {ev.file_size && (
                          <div>
                            <b>Size:</b> {(ev.file_size / 1024).toFixed(1)} KB
                          </div>
                        )}
                        <div>
                          <b>Uploaded:</b> {new Date(ev.uploaded_at).toLocaleTimeString("en-IN")}
                        </div>
                        {evUrl && (
                          <button
                            type="button"
                            onClick={() => window.open(evUrl, "_blank")}
                            className={`${btn.outline} mt-1 w-full justify-center text-xs`}
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                            View Full Resolution
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-4">
              {/* AI Checks List */}
              <ul className="divide-y divide-border">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`h-4 w-4 ${c.pass ? "text-success" : "text-destructive"}`}
                      />
                      <span className="text-muted-foreground">{c.label}</span>
                    </div>
                    <span
                      className={`font-medium ${c.pass ? "text-foreground" : "text-destructive font-semibold"}`}
                    >
                      {c.val}
                    </span>
                  </li>
                ))}
              </ul>

              {/* AI Decision Box */}
              <div
                className={`rounded-lg border-l-4 p-4 ${
                  isPass
                    ? "border-success bg-success-soft text-success"
                    : isRejected
                      ? "border-destructive bg-danger-soft text-destructive"
                      : "border-warning bg-warning-soft text-warning"
                }`}
              >
                <div className="flex items-start gap-3">
                  {isPass ? (
                    <CheckCircle2 className="h-7 w-7 shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className="h-7 w-7 shrink-0 text-warning" />
                  )}
                  <div>
                    <div className="font-bold text-lg leading-tight">
                      AI DECISION: {decisionStatus}
                    </div>
                    <div className="mt-1 text-xs text-foreground/90">
                      {latestVerification?.explanation ?? "Automatic visual inspection completed."}
                    </div>
                    {latestVerification?.processor_version && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span>Engine: v{latestVerification.processor_version}</span>
                        {durationMs != null && (
                          <>
                            <span>•</span>
                            <Clock className="h-3 w-3" />
                            <span>{(durationMs / 1000).toFixed(2)}s</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Manual Review Lifecycle Section */}
              <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="h-4 w-4 text-warning" />
                  <h3 className="font-semibold text-sm text-navy">
                    Official Administrative Determination
                  </h3>
                </div>

                {activeReview?.status === "resolved" ? (
                  <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1.5">
                    <div className="font-medium text-foreground">Review already resolved:</div>
                    <div className="text-muted-foreground">
                      <b>Notes:</b> {activeReview.reviewer_notes}
                    </div>
                    <div className="text-muted-foreground">
                      <b>Resolved At:</b>{" "}
                      {activeReview.resolved_at
                        ? new Date(activeReview.resolved_at).toLocaleString("en-IN")
                        : "—"}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      As an authorized officer, record your physical or documented determination.
                      Your explanation is permanently written to the government audit log.
                    </p>

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Officer Justification Notes (Mandatory)
                      </label>
                      <textarea
                        rows={2}
                        value={reviewerNotes}
                        onChange={(e) => {
                          setReviewerNotes(e.target.value);
                          setValidationError(null);
                        }}
                        placeholder="e.g. Visual confirmation of number plate matches mandi gate register. Approved for offloading."
                        className="w-full rounded-md border border-input bg-background p-2.5 text-xs focus:ring-2 focus:ring-primary outline-none"
                      />
                      {validationError && (
                        <div className="mt-1 text-xs text-destructive">{validationError}</div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          setSelectedDecision("pass");
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                          selectedDecision === "pass"
                            ? "bg-success text-white ring-2 ring-success/50"
                            : "bg-success-soft text-success hover:bg-success hover:text-white"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve (PASS)
                      </button>

                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          setSelectedDecision("retake");
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                          selectedDecision === "retake"
                            ? "bg-warning text-white ring-2 ring-warning/50"
                            : "bg-warning-soft text-warning hover:bg-warning hover:text-white"
                        }`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Request Retake
                      </button>

                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => {
                          setSelectedDecision("rejected");
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                          selectedDecision === "rejected"
                            ? "bg-destructive text-white ring-2 ring-destructive/50"
                            : "bg-danger-soft text-destructive hover:bg-destructive hover:text-white"
                        }`}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject (FAIL)
                      </button>

                      {selectedDecision && (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={handleConfirmReview}
                          className="ml-auto rounded-md bg-navy px-4 py-2 text-xs font-bold text-white hover:bg-navy/90 animate-pulse"
                        >
                          {actionLoading
                            ? "Submitting…"
                            : `Confirm ${selectedDecision.toUpperCase()}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Right Column: Trip Info & Location History */}
        <div className="space-y-6">
          <Card title="Transport Movement Record">
            <ul className="divide-y divide-border text-sm">
              {[
                ["Trip Code", tripDisplayCode],
                ["Vehicle RC", vehicleNumber],
                ["Driver Name", trip?.driver_name ?? "—"],
                ["Driver Phone", trip?.driver_phone ?? "—"],
                ["Origin Mandi/Godown", originName],
                ["Destination FPS", destName],
                ["Movement Stage", stageName],
                ["Current Status", statusName],
              ].map(([k, v]) => (
                <li key={k} className="py-2.5">
                  <div className="text-xs text-muted-foreground">{k}</div>
                  <div className="font-medium text-foreground">{v}</div>
                </li>
              ))}
            </ul>
          </Card>

          {/* GPS Tracking Telemetry */}
          <Card title={`GPS Tracking Trail (${locations?.length ?? 0} pings)`}>
            {locations && locations.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Latest coordinates:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {locations[locations.length - 1]?.latitude.toFixed(5)},{" "}
                    {locations[locations.length - 1]?.longitude.toFixed(5)}
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 text-xs">
                  {locations
                    .slice(-5)
                    .reverse()
                    .map((loc: TripLocation, idx: number) => (
                      <div key={idx} className="flex justify-between rounded bg-muted/30 px-2 py-1">
                        <span className="font-mono">
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(loc.recorded_at).toLocaleTimeString("en-IN")}
                        </span>
                      </div>
                    ))}
                </div>
                <Link
                  to="/live-tracking"
                  className={`${btn.outline} mt-2 w-full justify-center text-xs`}
                >
                  Follow on Live Map <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <MapPin className="mx-auto h-6 w-6 text-muted-foreground/40 mb-1" />
                No GPS breadcrumbs recorded for this trip yet.
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
