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
} from "lucide-react";
import { useEffect, useState } from "react";
import { Card, PageHeader, btn } from "@/components/admin/AdminShell";
import truckPlaceholder from "@/assets/truck.jpg";
import {
  getTripDetail,
  getEvidenceSignedUrl,
  resolveReview,
  updateTripStatus,
} from "@/lib/admin-queries";

export const Route = createFileRoute("/verification/$tripId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.tripId} Verification — GrainShield AI` },
      { name: "description", content: `AI photo verification results for ${params.tripId}.` },
      { property: "og:title", content: `${params.tripId} Verification — GrainShield AI` },
      { property: "og:description", content: `AI photo verification results for ${params.tripId}.` },
    ],
  }),
  loader: async ({ params }) => {
    const detail = await getTripDetail(params.tripId);
    return detail;
  },
  component: Detail,
});

const stageLabels: Record<string, string> = {
  first_mile: "First Mile",
  mid_mile: "Middle Mile",
  last_mile: "Last Mile",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  processing: "Processing",
  pass: "Pass",
  retake: "Retake",
  manual_review: "In Progress",
  rejected: "Rejected",
  completed: "Completed",
};

function Detail() {
  const { tripId } = Route.useParams();
  const loaderData = Route.useLoaderData() as Awaited<ReturnType<typeof import("@/lib/admin-queries").getTripDetail>>;
  const { trip, evidence, verifications, reviews, error } = loaderData ?? { trip: null, evidence: [], verifications: [], reviews: [], error: null };
  const router = useRouter();

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const latestVerification = verifications?.[0] ?? null;
  const latestEvidence = evidence?.[0] ?? null;
  const activeReview = reviews?.find((r: { status: string }) => r.status !== "resolved") ?? reviews?.[0] ?? null;

  // Load signed URL for evidence photo if available
  useEffect(() => {
    let cancelled = false;
    async function loadSignedUrl() {
      if (latestEvidence?.storage_path) {
        const res = await getEvidenceSignedUrl(latestEvidence.storage_path);
        if (!cancelled && res.url) {
          setImageUrl(res.url);
        }
      }
    }
    loadSignedUrl();
    return () => {
      cancelled = true;
    };
  }, [latestEvidence?.storage_path]);

  const handleAction = async (decision: "pass" | "retake" | "rejected") => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      if (activeReview) {
        await resolveReview(activeReview.id, "resolved", `Officer decision: ${decision}`);
      }
      if (trip) {
        await updateTripStatus(trip.id, decision);
      }
      setActionMessage(`Decision recorded: ${decision.toUpperCase()}`);
      await router.invalidate();
    } catch (err: any) {
      setActionMessage(`Error: ${err.message || String(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const tripDisplayCode = trip?.trip_code ?? tripId;
  const vehicleNumber = trip?.vehicle_number ?? "GJ01AB1234";
  const stageName = trip ? stageLabels[trip.stage] ?? trip.stage : "First Mile";
  const statusName = trip ? statusLabels[trip.status] ?? trip.status : "In Progress";
  const originName = trip?.origin ?? "Ahmedabad";
  const formattedDate = trip?.created_at
    ? new Date(trip.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "20 Oct 2025, 10:15 AM";

  const summary = [
    ["Trip ID", tripDisplayCode, ScanLine],
    ["Vehicle No.", vehicleNumber, Car],
    ["Stage", stageName, Truck],
    ["Date & Time", formattedDate, Calendar],
    ["District / Origin", originName, MapPin],
  ] as const;

  const checks = [
    ["Image Quality", latestVerification?.image_quality ? latestVerification.image_quality.toUpperCase() : "Clear"],
    ["Vehicle Detection", latestVerification?.vehicle_detected ? "Detected" : latestVerification ? "Not Detected" : "Detected"],
    [
      "Number Plate OCR",
      latestVerification?.detected_plate
        ? `${latestVerification.detected_plate} (${latestVerification.plate_match ? "Match" : "Mismatch"})`
        : latestVerification
          ? "No plate detected"
          : "GJ01AB1234 (Match)",
    ],
    ["Vehicle Type", "Transport Vehicle"],
    ["Required Evidence", "Vehicle + Plate Visible"],
  ];

  const decisionStatus = latestVerification?.decision?.toUpperCase() ?? (trip?.status === "pass" ? "PASS" : "IN REVIEW");
  const isPass = decisionStatus === "PASS";
  const isRejected = decisionStatus === "REJECTED" || decisionStatus === "RETAKE";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Trip Verification", to: "/verification" }, { label: tripDisplayCode }]}
        title="Trip Verification Details"
        right={
          <div className="text-right text-sm">
            <span
              className={`mb-2 inline-block rounded-md px-3 py-1 font-semibold ${
                isPass
                  ? "bg-success-soft text-success"
                  : isRejected
                    ? "bg-danger-soft text-destructive"
                    : "bg-warning-soft text-warning"
              }`}
            >
              {statusName}
            </span>
            <div>Last updated: {formattedDate}</div>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          Database note: {error}
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info">
          {actionMessage}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5 shadow-card md:grid-cols-5">
        {summary.map(([l, v, I]) => (
          <div key={l} className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-info-soft text-navy">
              <I className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{l}</div>
              <div className="font-medium">{v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Uploaded Photo & AI Results" className="lg:col-span-2">
          <div className="grid gap-5 md:grid-cols-[260px_1fr]">
            <div className="space-y-3">
              <img
                src={imageUrl || truckPlaceholder}
                alt="Uploaded transport evidence"
                width={1024}
                height={768}
                className="aspect-[4/5] w-full rounded-md object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  if (imageUrl) window.open(imageUrl, "_blank");
                }}
                className={`${btn.outline} w-full justify-center`}
              >
                <Maximize2 className="h-4 w-4" />
                View Full Image
              </button>
              <button type="button" className="flex items-center gap-1 text-sm text-info">
                <MapPin className="h-4 w-4" />
                View Location on Map
              </button>
            </div>
            <div>
              <ul className="divide-y divide-border">
                {checks.map(([k, v]) => (
                  <li key={k} className="flex items-center gap-3 py-3">
                    <CheckCircle2
                      className={`h-6 w-6 ${
                        typeof v === "string" && (v.includes("Mismatch") || v.includes("Not Detected"))
                          ? "text-destructive"
                          : "text-success"
                      }`}
                    />
                    <span className="w-40">{k}</span>
                    <span
                      className={`flex-1 font-medium ${
                        typeof v === "string" && (v.includes("Mismatch") || v.includes("Not Detected"))
                          ? "text-destructive"
                          : "text-success"
                      }`}
                    >
                      {v}
                    </span>
                    <Check className="h-4 w-4 text-success" />
                  </li>
                ))}
              </ul>

              <div
                className={`mt-4 flex items-center gap-4 rounded-md border-l-4 p-4 ${
                  isPass
                    ? "border-success bg-success-soft"
                    : isRejected
                      ? "border-destructive bg-danger-soft"
                      : "border-warning bg-warning-soft"
                }`}
              >
                {isPass ? (
                  <CheckCircle2 className="h-9 w-9 text-success" />
                ) : (
                  <XCircle className="h-9 w-9 text-warning" />
                )}
                <div>
                  <div
                    className={`text-xl font-bold ${
                      isPass ? "text-success" : isRejected ? "text-destructive" : "text-warning"
                    }`}
                  >
                    {decisionStatus}
                  </div>
                  <div className="text-sm">
                    {latestVerification?.explanation ??
                      "All checks evaluated. Verified against trip registration."}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleAction("pass")}
                  className={btn.primary}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleAction("retake")}
                  className={btn.outline}
                >
                  <RotateCcw className="h-4 w-4" />
                  Request Retake
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleAction("rejected")}
                  className="inline-flex items-center gap-2 rounded-md bg-danger-soft px-4 py-2 text-sm font-medium text-destructive"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Trip Information">
          <ul className="divide-y divide-border">
            {[
              ["Assigned Vehicle", vehicleNumber],
              ["Vehicle Type", "Commercial Truck"],
              ["Trip Stage", stageName],
              ["Expected Evidence", "Vehicle + Plate Visible"],
              ["Origin", trip?.origin ?? "FCI Godown"],
              ["Destination", trip?.destination ?? "Fair Price Shop"],
              ["Driver Name", trip?.driver_name ?? "—"],
              ["Driver Phone", trip?.driver_phone ?? "—"],
            ].map(([k, v]) => (
              <li key={k} className="py-3">
                <div className="text-sm text-muted-foreground">{k}</div>
                <div className="font-medium">{v}</div>
              </li>
            ))}
          </ul>
          <Link to="/live-tracking" className={`${btn.outline} mt-4 w-full justify-center`}>
            View Trip Route <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>
    </>
  );
}
