import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ImageUp, TriangleAlert, Loader2, AlertCircle } from "lucide-react";
import { AppShell, Card, btn } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { upsertTrip } from "@/lib/services/trips";
import { uploadEvidence } from "@/lib/services/evidence";
import { createPendingVerification } from "@/lib/services/verification";
import { uploadSchema, validateFile } from "@/lib/validation";
import type { TripStage } from "@/lib/supabase/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Upload Photo | GrainShield AI" },
      {
        name: "description",
        content: "Upload a trip vehicle photo for AI verification of food grain transport.",
      },
      { property: "og:title", content: "Upload Photo | GrainShield AI" },
      { property: "og:description", content: "Upload a trip vehicle photo for AI verification." },
    ],
  }),
  component: Upload,
});

const input =
  "h-12 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-info";

function Upload() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const { user, loading: authLoading } = useAuth();
  const [tripCode, setTripCode] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [stage, setStage] = useState<TripStage | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    trip_code?: string | undefined;
    vehicle_number?: string | undefined;
    stage?: string | undefined;
    file?: string | undefined;
  }>({});

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const validation = validateFile(f);
    if (!validation.valid) {
      setFileError(validation.error);
      return;
    }
    setFileError(null);
    setFieldErrors((prev) => ({ ...prev, file: undefined }));
    if (error) setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleReset() {
    setTripCode("");
    setVehicleNumber("");
    setStage("");
    setFile(null);
    setPreview(null);
    setError(null);
    setFileError(null);
    setFieldErrors({});
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
      trip_code?: string;
      vehicle_number?: string;
      stage?: string;
      file?: string;
    } = {};

    // Validate form fields
    const parsed = uploadSchema.safeParse({
      trip_code: tripCode,
      vehicle_number: vehicleNumber,
      stage,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldName = issue.path[0] as "trip_code" | "vehicle_number" | "stage";
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
        newFieldErrors.trip_code ||
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
      // 1. Upsert trip record
      const { trip, error: tripError } = await upsertTrip({
        tripCode: parsed.data!.trip_code,
        vehicleNumber: parsed.data!.vehicle_number,
        stage: parsed.data!.stage as TripStage,
        userId: user.id,
      });

      if (tripError || !trip) {
        setError(tripError ?? "Failed to create trip.");
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      // 2. Upload evidence photograph
      const { evidence, error: evidenceError } = await uploadEvidence({
        file: file!,
        tripId: trip.id,
        stage: parsed.data!.stage as TripStage,
        userId: user.id,
      });

      if (evidenceError || !evidence) {
        setError(evidenceError ?? "Failed to upload photograph.");
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }

      // 3. Create pending verification record
      const { error: verError } = await createPendingVerification({
        tripId: trip.id,
        evidenceId: evidence.id,
        expectedPlate: parsed.data!.vehicle_number,
      });

      if (verError) {
        // Non-fatal: navigate to processing anyway
        console.warn("[upload] verification queue error:", verError);
      }

      // 4. Navigate to processing with trip context
      void nav({
        to: "/processing",
        search: { tripId: trip.id },
      });
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

  // Show auth prompt if not signed in and not loading
  if (!authLoading && !user) {
    return (
      <AppShell
        crumbs={["Home", "Trip Verification", "Upload Photo"]}
        title="Upload Photo for Verification"
      >
        <div className="rounded-2xl border border-info/30 bg-info-soft p-6 text-center">
          <p className="mb-4 text-sm text-foreground">
            You must be signed in to submit trip evidence.
          </p>
          <button onClick={() => void nav({ to: "/login" })} className={btn.saffron}>
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumbs={["Home", "Trip Verification", "Upload Photo"]}
      title="Upload Photo for Verification"
    >
      <Card>
        <div className="space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <label className="block text-sm font-medium">
            Trip ID <span className="text-danger">*</span>
            <input
              className={`${input} mt-1 ${fieldErrors.trip_code ? "border-danger ring-1 ring-danger" : ""}`}
              placeholder="e.g. TRIP-1042"
              value={tripCode}
              onChange={(e) => {
                setTripCode(e.target.value.toUpperCase());
                if (fieldErrors.trip_code) {
                  setFieldErrors((prev) => ({ ...prev, trip_code: undefined }));
                }
                if (error) setError(null);
              }}
              disabled={submitting}
            />
            {fieldErrors.trip_code && (
              <p className="mt-1 text-xs text-danger">{fieldErrors.trip_code}</p>
            )}
          </label>
          <label className="block text-sm font-medium">
            Vehicle No. <span className="text-danger">*</span>
            <input
              className={`${input} mt-1 ${fieldErrors.vehicle_number ? "border-danger ring-1 ring-danger" : ""}`}
              placeholder="e.g. GJ01AB1234"
              value={vehicleNumber}
              onChange={(e) => {
                setVehicleNumber(e.target.value.toUpperCase());
                if (fieldErrors.vehicle_number) {
                  setFieldErrors((prev) => ({ ...prev, vehicle_number: undefined }));
                }
                if (error) setError(null);
              }}
              disabled={submitting}
            />
            {fieldErrors.vehicle_number && (
              <p className="mt-1 text-xs text-danger">{fieldErrors.vehicle_number}</p>
            )}
          </label>
          <label className="block text-sm font-medium">
            Trip Stage <span className="text-danger">*</span>
            <select
              className={`${input} mt-1 ${fieldErrors.stage ? "border-danger ring-1 ring-danger" : ""}`}
              value={stage}
              onChange={(e) => {
                setStage(e.target.value as TripStage | "");
                if (fieldErrors.stage) {
                  setFieldErrors((prev) => ({ ...prev, stage: undefined }));
                }
                if (error) setError(null);
              }}
              disabled={submitting}
            >
              <option value="">Select Stage</option>
              <option value="first_mile">First Mile — FCI Mandi to Godown (CP1 &amp; CP2)</option>
              {/* mid_mile: reserved in DB schema for future use */}
              <option value="last_mile">Last Mile — Godown to Fair Price Shop (CP3 &amp; CP4)</option>
            </select>
            {fieldErrors.stage && <p className="mt-1 text-xs text-danger">{fieldErrors.stage}</p>}
          </label>
        </div>
      </Card>

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
            "Submit"
          )}
        </button>
      </div>
    </AppShell>
  );
}
