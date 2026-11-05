import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Wrench } from "lucide-react";
import { DataTable, PageHeader, btn } from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/failed-jobs")({
  head: () => ({
    meta: [
      { title: "Failed Jobs — GrainShield AI" },
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
  worker_id: string | null;
  job_stage: string | null;
  trip_code?: string | null;
}

function FailedJobs() {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  async function fetchJobs() {
    setLoading(true);
    setError(null);

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
      setError(err.message);
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

  async function markResolved(jobId: string) {
    setResolving(jobId);
    const { error: err } = await supabase
      .from("failed_jobs")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", jobId);

    if (err) {
      alert("Failed to mark as resolved: " + err.message);
    } else {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, resolved_at: new Date().toISOString() } : j)),
      );
    }
    setResolving(null);
  }

  const unresolved = jobs.filter((j) => !j.resolved_at).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Failed Jobs" }]}
        title="Failed Jobs — Dead-Letter Queue"
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

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
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
            <span className="whitespace-nowrap font-mono text-xs">
              {new Date(j.error_at).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>,
            j.trip_id ? (
              <Link
                to="/verification/$tripId"
                params={{ tripId: j.trip_id }}
                className="font-mono text-xs text-info hover:underline"
              >
                {j.trip_code ?? j.trip_id.slice(0, 8)}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {j.job_stage ?? "unknown"}
            </span>,
            <span
              className="block max-w-xs truncate text-xs text-destructive"
              title={j.error_message}
            >
              {j.error_message}
            </span>,
            <span className="text-xs">{j.retry_count}</span>,
            j.resolved_at ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3 w-3" />
                Resolved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Open
              </span>
            ),
            j.resolved_at ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <button
                onClick={() => markResolved(j.id)}
                disabled={resolving === j.id}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Wrench className="h-3 w-3" />
                {resolving === j.id ? "Saving…" : "Resolve"}
              </button>
            ),
          ])}
        />
      )}
    </>
  );
}
