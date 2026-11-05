import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ImageUp, TriangleAlert, Loader2, AlertCircle, CheckCircle2, Ticket } from "lucide-react";
import { AppShell, Card, btn } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { createCitizenTrip } from "@/lib/services/trips";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import { tripSubmitSchema, validateFile } from "@/lib/validation";
import type { TripStage } from "@/lib/supabase/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Submit Trip | GrainShield AI" },
      {
        name: "description",
        content:
          "Submit a food grain transport trip for AI-powered verification. Your Trip ID is generated automatically.",
      },
      { property: "og:title", content: "Submit Trip | GrainShield AI" },
      {
        property: "og:description",
        content: "Submit a trip for AI verification.",
      },
    ],
  }),
  component: Upload,
} as Parameters<typeof createFileRoute>[0] extends (arg: infer A) => unknown ? A : never);

const input =
  "h-12 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-info";

function Upload() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const { user, loading: authLoading } = useAuth();

  // Form state
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [stage, setStage] = useState<TripStage | "">("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [commodity, setCommodity] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    vehicle_number?: string;
    stage?: string;
    file?: string;
  }>({});

  // Confirmation state — shown after successful submission
  const [confirmedTripCode, setConfirmedTripCode] = useState<string | null>(null);
  const [confirmedTripId, setConfirmedTripId] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const validation = validateFile(f);
    if (!validation.valid) {
      setFileError(validation.error);
      return;
    }
    setFileError(null);
    setFieldErrors((prev) => {
      const n = { ...prev };
      delete n.file;
      return n;
    });
    if (error) setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleReset() {
    setVehicleNumber("");
    setStage("");
    setOrigin("");
    setDestination("");
    setCommodity("");
    setFile(null);
    setPreview(null);
    setError(null);
    setFileError(null);
    setFieldErrors({});
    setConfirmedTripCode(null);
    setConfirmedTripId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    setError(null);
    setFieldErrors({});

    // Auth guard
    if (!user) {
      void nav({ to: "/login" });
      return;
    }

    const newFieldErrors: {
      vehicle_number?: string;
      stage?: string;
      file?: string;
    } = {};

    // Validate form fields using the new schema (no trip_code)
    const parsed = tripSubmitSchema.safeParse({
      vehicle_number: vehicleNumber,
      stage,
      origin: origin || undefined,
      destination: destination || undefined,
      commodity: commodity || undefined,
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0] as "vehicle_number" | "stage";
        if (fieldName && !newFieldErrors[fieldName]) {
          newFieldErrors[fieldName] = issue.message;
        }
      }
    }

    if (!file) {
      newFieldErrors.file = "Please select or capture a photograph before submitting.";
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      const firstMessage =
        newFieldErrors.vehicle_number ||
        newFieldErrors.stage ||
        newFieldErrors.file ||
        "Please fill in all required fields.";
      setError(firstMessage);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }

    setSubmitting(true);

    try {
      // 1. Create trip via backend RPC — backend generates Trip ID automatically
      const citizenParams: Parameters<typeof createCitizenTrip>[0] = {
        vehicleNumber: parsed.data!.vehicle_number,
        stage: parsed.data!.stage as TripStage,
      };
      if (parsed.data!.origin) citizenParams.origin = parsed.data!.origin;
      if (parsed.data!.destination) citizenParams.destination = parsed.data!.destination;
      if (parsed.data!.commodity) citizenParams.commodity = parsed.data!.commodity;
      const { tripId, tripCode, error: tripError } = await createCitizenTrip(citizenParams);

      if (tripError || !tripId || !tripCode) {
        setError(tripError ?? "Failed to create trip. Please try again.");
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      // 2. Upload evidence photograph
      const { evidence, error: evidenceError } = await uploadEvidence({
        file: file!,
        tripId,
        stage: parsed.data!.stage as TripStage,
        userId: user.id,
      });

      if (evidenceError || !evidence) {
        setError(evidenceError ?? "Failed to upload photograph. Please try again.");
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      // 3. Create pending verification record
      const { error: verError } = await createPendingVerification({
        tripId,
        evidenceId: evidence.id,
        expectedPlate: parsed.data!.vehicle_number,
      });

      if (verError) {
        // Non-fatal: log and continue — AI worker will pick up via polling
        console.warn("[upload] verification queue error:", verError);
      }

      // 4. Show confirmation with auto-generated Trip ID, then navigate
      setConfirmedTripCode(tripCode);
      setConfirmedTripId(tripId);

      // Auto-navigate to processing after 2.5 seconds
      setTimeout(() => {
        void nav({ to: "/processing", search: { tripId } });
      }, 2500);
    } catch (err) {
      console.error("[upload] Submit failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Submission failed: ${msg}`);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Auth prompt ───────────────────────────────────────────────────────────
  if (!authLoading && !user) {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Submit Trip"]} title="Submit a Trip">
        <div className="rounded-2xl border border-info/30 bg-info-soft p-6 text-center">
          <p className="mb-4 text-sm text-foreground">You must be signed in to submit a trip.</p>
          <button onClick={() => void nav({ to: "/login" })} className={btn.saffron}>
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  // ── Confirmation banner (shown briefly after successful submission) ────────
  if (confirmedTripCode && confirmedTripId) {
    return (
      <AppShell crumbs={["Home", "Trip Verification", "Submitted"]} title="Trip Submitted">
        <Card>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-success" />
            <div>
              <p className="mb-1 text-sm text-muted-foreground">Your Trip ID</p>
              <p className="text-2xl font-bold tracking-widest text-primary">{confirmedTripCode}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Save this ID for your records. You can track your trip status in{" "}
              <strong>My Trips</strong>.
            </p>
            <p className="text-xs text-muted-foreground">Redirecting to verification status…</p>
            <button
              className={btn.saffron}
              onClick={() => void nav({ to: "/processing", search: { tripId: confirmedTripId } })}
            >
              Go to Verification Status
            </button>
          </div>
        </Card>
      </AppShell>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <AppShell crumbs={["Home", "Trip Verification", "Submit Trip"]} title="Submit a Trip">
      {/* Info banner — trip ID is auto-generated */}
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft p-3 text-sm text-foreground">
        <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Your <strong>Trip ID</strong> is generated automatically by the system. You do not need to
          enter one.
        </span>
      </div>

      <Card>
        <div className="space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Vehicle Number */}
          <label className="block text-sm font-medium">
            Vehicle No. <span className="text-danger">*</span>
            <input
              className={`${input} mt-1 ${fieldErrors.vehicle_number ? "border-danger ring-1 ring-danger" : ""}`}
              placeholder="e.g. GJ01AB1234"
              value={vehicleNumber}
              onChange={(e) => {
                setVehicleNumber(e.target.value.toUpperCase());
                if (fieldErrors.vehicle_number) {
                  setFieldErrors((prev) => {
                    const n = { ...prev };
                    delete n.vehicle_number;
                    return n;
                  });
                }
                if (error) setError(null);
              }}
              disabled={submitting}
            />
            {fieldErrors.vehicle_number && (
              <p className="mt-1 text-xs text-danger">{fieldErrors.vehicle_number}</p>
            )}
          </label>

          {/* Trip Stage */}
          <label className="block text-sm font-medium">
            Trip Stage <span className="text-danger">*</span>
            <select
              className={`${input} mt-1 ${fieldErrors.stage ? "border-danger ring-1 ring-danger" : ""}`}
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as TripStage | "");
                if (fieldErrors.stage) {
                  setFieldErrors((prev) => {
                    const n = { ...prev };
                    delete n.stage;
                    return n;
                  });
                }
                if (error) setError(null);
              }}
              disabled={submitting}
            >
              <option value="">Select Stage</option>
              <option value="first_mile">First Mile — FCI Mandi to Godown (CP1 &amp; CP2)</option>
              {/* mid_mile: reserved in DB schema for future use */}
              <option value="last_mile">
                Last Mile — Godown to Fair Price Shop (CP3 &amp; CP4)
              </option>
            </select>
            {fieldErrors.stage && <p className="mt-1 text-xs text-danger">{fieldErrors.stage}</p>}
          </label>

          {/* Origin (optional) */}
          <label className="block text-sm font-medium">
            Origin
            <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            <input
              className={`${input} mt-1`}
              placeholder="e.g. Ahmedabad FCI Godown"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              disabled={submitting}
            />
          </label>

          {/* Destination (optional) */}
          <label className="block text-sm font-medium">
            Destination
            <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            <input
              className={`${input} mt-1`}
              placeholder="e.g. Gandhinagar FPS-01"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={submitting}
            />
          </label>

          {/* Commodity (optional) */}
          <label className="block text-sm font-medium">
            Commodity
            <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
            <input
              className={`${input} mt-1`}
              placeholder="e.g. Wheat, Rice, Sorghum"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
              disabled={submitting}
            />
          </label>
        </div>
      </Card>

      {/* Checkpoint guidance — shown when stage is selected */}
      {stage && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          {stage === "first_mile" ? (
            <div className="space-y-1">
              <p className="font-semibold text-primary">First Mile — 2 Checkpoints</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP1 — Departure:</span> Photograph the
                vehicle at the FCI Mandi / warehouse before it departs.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP2 — Arrival:</span> Photograph the
                vehicle at the godown / storage depot upon arrival.
              </p>
            </div>
          ) : stage === "last_mile" ? (
            <div className="space-y-1">
              <p className="font-semibold text-primary">Last Mile — 2 Checkpoints</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP3 — Departure:</span> Photograph the
                vehicle at the godown before it leaves for the Fair Price Shop.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP4 — Delivery:</span> Photograph the
                vehicle at the Fair Price Shop upon final delivery.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <Card title="Upload Photograph">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={submitting}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 text-sm disabled:opacity-60 ${
            fieldErrors.file
              ? "border-danger bg-danger-soft/30 text-danger"
              : "border-info/40 bg-info-soft/50 text-foreground"
          }`}
        >
          <ImageUp className={`h-10 w-10 ${fieldErrors.file ? "text-danger" : "text-info"}`} />
          <span className="font-medium">Tap to take or choose photo</span>
          <span className="text-xs text-muted-foreground">JPG, PNG, WebP (Max 10MB)</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          onChange={onFileChange}
        />

        {fileError && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {fileError}
          </div>
        )}

        {fieldErrors.file && !fileError && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {fieldErrors.file}
          </div>
        )}

        {preview && (
          <>
            <p className="mt-4 mb-2 text-sm font-medium">Preview</p>
            <img
              src={preview}
              alt="Selected vehicle"
              width={1024}
              height={768}
              className="aspect-[4/3] w-full rounded-xl object-cover"
            />
          </>
        )}

        <div className="mt-4 rounded-xl border border-saffron/50 bg-warning-soft p-3 text-sm">
          <p className="mb-1.5 flex items-center gap-2 font-medium text-warning">
            <TriangleAlert className="h-4 w-4" />
            Image Requirements
          </p>
          <ul className="list-disc space-y-1 pl-6 marker:text-saffron">
            <li>Image must be clear and in focus</li>
            <li>Vehicle number plate must be visible</li>
            <li>Photograph must be taken in daylight</li>
            <li>File size should not exceed 10MB</li>
          </ul>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger shadow-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button className={btn.maroon} onClick={handleReset} disabled={submitting}>
          Reset
        </button>
        <button
          className={btn.saffron}
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting || authLoading}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Submitting…
            </span>
          ) : (
            "Submit Trip"
          )}
        </button>
      </div>
    </AppShell>
  );
}
