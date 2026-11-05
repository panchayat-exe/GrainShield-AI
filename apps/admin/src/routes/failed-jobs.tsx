import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Wrench } from "lucide-react";
import { DataTable, PageHeader, btn } from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/failed-jobs")({
  head: () => ({
    meta: [
      { title: "Failed Jobs \u2014 GrainShield AI" },
      {
        name: "description",
        content: "Dead-letter queue for AI worker failures.",
      },
    ],
  }),
  component: FailedJobs,
});

interface FailedJob {
  id: string;
  verification_id: string | null;
  trip_id: string | null;
  error_message: string;
  error_at: string;
  retry_count: number;
  resolved_at: string | null;
  resolution_note: string | null;
  worker_id: string | null;
  job_stage: string | null;
  trip_code?: string | null;
}

// ---------------------------------------------------------------------------
// Resolution modal — collects an optional note before calling the RPC
// ---------------------------------------------------------------------------
function ResolveModal({
  job,
  onClose,
  onResolved,
}: {
  job: FailedJob;
  onClose: () => void;
  onResolved: (jobId: string) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSaving(true);
    setError(null);

    const { data, error: rpcErr } = await supabase.rpc("resolve_failed_job", {
      p_job_id: job.id,
      p_resolution_note: note.trim() || null,
    });

    if (rpcErr) {
      setError(rpcErr.message);
      setSaving(false);
      return;
    }

    // The RPC returns { success, error? }
    const result = data as { success: boolean; error?: string } | null;
    if (!result?.success) {
      setError(result?.error ?? "Resolution failed. Please try again.");
      setSaving(false);
      return;
    }

    setSaving(false);
    onResolved(job.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <h2 className="text-base font-bold text-navy">Resolve Failed Job</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Trip:{" "}
              <span className="font-mono font-semibold text-foreground">
                {job.trip_code ?? job.trip_id?.slice(0, 8) ?? "\u2014"}
              </span>
            </p>
          </div>
        </div>

        {/* Error detail */}
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <p className="font-semibold mb-0.5">Error</p>
          <p className="break-words">{job.error_message}</p>
        </div>

        {/* Resolution note */}
        <label className="block text-xs font-semibold text-navy mb-1">
          Resolution Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring h-24 resize-none"
          placeholder="Describe how this was resolved or why it is safe to dismiss&#8230;"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
        />

        {error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className={btn.outline}>
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={saving} className={btn.primary}>
            <Wrench className="h-4 w-4" />
            {saving ? "Resolving\u2026" : "Mark Resolved"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
function FailedJobs() {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  // Modal state
  const [resolveTarget, setResolveTarget] = useState<FailedJob | null>(null);

  async function fetchJobs() {
    setLoading(true);
    setFetchError(null);

    let query = supabase
      .from("failed_jobs")
      .select("*, trips(trip_code)")
      .order("error_at", { ascending: false })
      .limit(100);

    if (!showResolved) {
      query = query.is("resolved_at", null);
    }

    const { data, error: err } = await query;

    if (err) {
      setFetchError(err.message);
    } else {
      const rows = (
        (data ?? []) as unknown as Array<FailedJob & { trips: { trip_code: string } | null }>
      ).map((r) => ({
        ...r,
        trip_code: r.trips?.trip_code ?? r.trip_id?.slice(0, 8) ?? null,
      }));
      setJobs(rows);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  // Called by the modal after a successful RPC call
  function handleResolved(jobId: string) {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, resolved_at: new Date().toISOString() } : j)),
    );
  }

  const unresolved = jobs.filter((j) => !j.resolved_at).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Failed Jobs" }]}
        title="Failed Jobs \u2014 Dead-Letter Queue"
        subtitle="AI worker failures requiring operator attention"
        right={
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="rounded"
              />
              Show resolved
            </label>
            <button
              onClick={fetchJobs}
              disabled={loading}
              className={btn.outline + " flex items-center gap-1"}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-xs text-muted-foreground">Unresolved</p>
            <p className="text-2xl font-bold text-destructive">{unresolved}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Total (shown)</p>
            <p className="text-2xl font-bold text-foreground">{jobs.length}</p>
          </div>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {fetchError}
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
          <p className="font-medium text-foreground">No failed jobs</p>
          <p className="mt-1 text-sm text-muted-foreground">
            All AI worker jobs completed successfully.
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <DataTable
          head={["Error At", "Trip", "Stage", "Error Message", "Retries", "Status", "Action"]}
          rows={jobs.map((j) => [
            <span key="ts" className="whitespace-nowrap font-mono text-xs">
              {new Date(j.error_at).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>,
            j.trip_id ? (
              <Link
                key="trip"
                to="/verification/$tripId"
                params={{ tripId: j.trip_id }}
                className="font-mono text-xs text-info hover:underline"
              >
                {j.trip_code ?? j.trip_id.slice(0, 8)}
              </Link>
            ) : (
              <span key="trip" className="text-xs text-muted-foreground">
                \u2014
              </span>
            ),
            <span
              key="stage"
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {j.job_stage ?? "unknown"}
            </span>,
            <span
              key="err"
              className="block max-w-xs truncate text-xs text-destructive"
              title={j.error_message}
            >
              {j.error_message}
            </span>,
            <span key="retry" className="text-xs">
              {j.retry_count}
            </span>,
            j.resolved_at ? (
              <span
                key="status"
                className="inline-flex items-center gap-1 text-xs text-success"
                title={j.resolution_note ?? undefined}
              >
                <CheckCircle2 className="h-3 w-3" />
                Resolved
              </span>
            ) : (
              <span
                key="status"
                className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
              >
                <AlertTriangle className="h-3 w-3" />
                Open
              </span>
            ),
            j.resolved_at ? (
              <span key="action" className="text-xs text-muted-foreground">
                \u2014
              </span>
            ) : (
              <button
                key="action"
                onClick={() => setResolveTarget(j)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Wrench className="h-3 w-3" />
                Resolve
              </button>
            ),
          ])}
        />
      )}

      {/* Resolution modal */}
      {resolveTarget && (
        <ResolveModal
          job={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={handleResolved}
        />
      )}
    </>
  );
}
