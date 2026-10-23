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

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const validation = validateFile(f);
    if (!validation.valid) {
      setFileError(validation.error);
      return;
    }
    setFileError(null);
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
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    setError(null);

    // Auth guard
    if (!user) {
      void nav({ to: "/login" });
      return;
    }

    // Validate form fields
    const parsed = uploadSchema.safeParse({
      trip_code: tripCode,
      vehicle_number: vehicleNumber,
      stage,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Please fill in all required fields.");
      return;
    }

    if (!file) {
      setError("Please select a photograph before submitting.");
      return;
    }

    setSubmitting(true);

    try {
      // 1. Upsert trip record
      const { trip, error: tripError } = await upsertTrip({
        tripCode: parsed.data.trip_code,
        vehicleNumber: parsed.data.vehicle_number,
        stage: parsed.data.stage as TripStage,
        userId: user.id,
      });

      if (tripError || !trip) {
        setError(tripError ?? "Failed to create trip.");
        return;
      }

      // 2. Upload evidence photograph
      const { evidence, error: evidenceError } = await uploadEvidence({
        file,
        tripId: trip.id,
        stage: parsed.data.stage as TripStage,
        userId: user.id,
      });

      if (evidenceError || !evidence) {
        setError(evidenceError ?? "Failed to upload photograph.");
        return;
      }

      // 3. Create pending verification record
      const { error: verError } = await createPendingVerification({
        tripId: trip.id,
        evidenceId: evidence.id,
        expectedPlate: parsed.data.vehicle_number,
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
              {error}
            </div>
          )}
          <label className="block text-sm font-medium">
            Trip ID <span className="text-danger">*</span>
            <input
              className={`${input} mt-1`}
              placeholder="e.g. TRIP-1042"
              value={tripCode}
              onChange={(e) => setTripCode(e.target.value.toUpperCase())}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm font-medium">
            Vehicle No. <span className="text-danger">*</span>
            <input
              className={`${input} mt-1`}
              placeholder="e.g. GJ01AB1234"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm font-medium">
            Trip Stage <span className="text-danger">*</span>
            <select
              className={`${input} mt-1`}
              value={stage}
              onChange={(e) => setStage(e.target.value as TripStage | "")}
              disabled={submitting}
            >
              <option value="">Select Stage</option>
              <option value="first_mile">First Mile</option>
              {/* mid_mile: reserved in DB schema for future use; no PS000006 workflow defined */}
              <option value="last_mile">Last Mile</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Upload Photograph">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={submitting}
          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-info/40 bg-info-soft/50 py-8 text-sm disabled:opacity-60"
        >
          <ImageUp className="h-10 w-10 text-info" />
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
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit"}
        </button>
      </div>
    </AppShell>
  );
}
