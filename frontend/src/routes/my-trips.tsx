import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Truck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ClipboardList,
} from "lucide-react";
import { AppShell, Card } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/my-trips")({
  head: () => ({
    meta: [
      { title: "My Trips | GrainShield AI" },
      {
        name: "description",
        content: "View all your grain transport trips and verification status.",
      },
    ],
  }),
  component: MyTrips,
});

const PAGE_SIZE = 20;

interface TripRow {
  id: string;
  trip_code: string;
  vehicle_number: string;
  stage: string;
  status: string;
  created_at: string;
  origin: string | null;
  destination: string | null;
}

function stageName(s: string) {
  const m: Record<string, string> = {
    first_mile: "First Mile",
    mid_mile: "Mid Mile",
    last_mile: "Last Mile",
  };
  return m[s] ?? s;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    processing: "bg-blue-100 text-blue-800 border-blue-200",
    pass: "bg-green-100 text-green-800 border-green-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    retake: "bg-orange-100 text-orange-800 border-orange-200",
    manual_review: "bg-purple-100 text-purple-800 border-purple-200",
    rejected: "bg-red-100 text-red-800 border-red-200",
    error: "bg-red-100 text-red-800 border-red-200",
    submitted: "bg-gray-100 text-gray-700 border-gray-200",
    draft: "bg-gray-100 text-gray-700 border-gray-200",
  };
  const Icon =
    status === "pass" || status === "completed"
      ? CheckCircle2
      : status === "rejected" || status === "error"
        ? XCircle
        : status === "manual_review"
          ? AlertCircle
          : status === "processing"
            ? RefreshCw
            : Clock;
  const label: Record<string, string> = {
    pending: "Pending",
    processing: "Processing",
    pass: "Pass",
    completed: "Completed",
    retake: "Retake Required",
    manual_review: "Manual Review",
    rejected: "Rejected",
    error: "Error",
    submitted: "Submitted",
    draft: "Draft",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
    >
      <Icon className="h-3 w-3" />
      {label[status] ?? status}
    </span>
  );
}

function MyTrips() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/login" });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    supabase
      .from("trips")
      .select("id,trip_code,vehicle_number,stage,status,created_at,origin,destination", {
        count: "exact",
      })
      .or(`created_by.eq.${user.id},assigned_to.eq.${user.id},driver_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .range(from, to)
      .then(({ data, error: err, count }) => {
        if (err) {
          setError(err.message);
        } else {
          setTrips((data as TripRow[]) ?? []);
          setTotal(count ?? 0);
        }
        setLoading(false);
      });
  }, [user, page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (authLoading) {
    return (
      <AppShell crumbs={["My Trips"]} title="My Trips">
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell crumbs={["My Trips"]} title="My Trips">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">My Trips</h1>
            <p className="text-sm text-muted-foreground">
              {total} trip{total !== 1 ? "s" : ""} total
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Truck className="h-4 w-4" />
            New Upload
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex h-48 items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* Empty */}
        {!loading && trips.length === 0 && !error && (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <ClipboardList className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No trips found</p>
              <p className="text-xs text-muted-foreground">
                Your submitted trips will appear here.
              </p>
              <Link
                to="/"
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Submit your first trip
              </Link>
            </div>
          </Card>
        )}

        {/* Trips list */}
        {!loading && trips.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <table className="w-full text-sm" aria-label="Your grain transport trips">
              <caption className="sr-only">
                List of your submitted grain transport trips with status and details
              </caption>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Trip Code
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-3 text-left font-medium text-muted-foreground sm:table-cell"
                  >
                    Vehicle
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell"
                  >
                    Stage
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-3 text-left font-medium text-muted-foreground sm:table-cell"
                  >
                    Date
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-medium text-muted-foreground"
                  >
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {trips.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {t.trip_code}
                      </span>
                      {(t.origin || t.destination) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[t.origin, t.destination].filter(Boolean).join(" → ")}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-foreground sm:table-cell">
                      {t.vehicle_number}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                      {stageName(t.stage)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground sm:table-cell">
                      {new Date(t.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/trip"
                        search={{ tripId: t.id }}
                        aria-label={`View details for trip ${t.trip_code}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        View
                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} · {total} trips
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    aria-label="Go to previous page"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    aria-label="Go to next page"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    Next
                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
