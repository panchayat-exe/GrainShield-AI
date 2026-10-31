import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  DataTable,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  btn,
} from "@/components/admin/AdminShell";
import { getReviewQueue } from "@/lib/admin-queries";
import type { TripStage } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/verification/")({
  head: () => ({
    meta: [
      { title: "Manual Review Queue — GrainShield AI" },
      { name: "description", content: "Trips flagged by AI that need officer review." },
      { property: "og:title", content: "Manual Review Queue — GrainShield AI" },
      { property: "og:description", content: "Trips flagged by AI that need officer review." },
    ],
  }),
  loader: async () => {
    const result = await getReviewQueue({ pageSize: 20, page: 1 });
    return result;
  },
  component: Queue,
});

function priorityFromNotes(notes: string | null): "High" | "Medium" | "Low" {
  if (!notes) return "Medium";
  const lower = notes.toLowerCase();
  if (lower.includes("mismatch") || lower.includes("not detected")) return "High";
  if (lower.includes("blurry") || lower.includes("dark")) return "Medium";
  return "Low";
}

const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];
const REVIEW_STATUS_OPTIONS = ["Pending + In Review", "Pending", "In Review", "Resolved", "Escalated"];

const stageMap: Record<string, TripStage | ""> = {
  "All Stages": "",
  "First Mile": "first_mile",
  "Middle Mile": "mid_mile",
  "Last Mile": "last_mile",
};
const reviewStatusMap: Record<string, string> = {
  "Pending + In Review": "",
  Pending: "pending",
  "In Review": "in_review",
  Resolved: "resolved",
  Escalated: "escalated",
};

const PAGE_SIZE = 20;

function Queue() {
  const loaderData = Route.useLoaderData();

  const [reviews, setReviews] = useState<any[]>(loaderData.reviews);
  const [total, setTotal] = useState(loaderData.total);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);
  const [newBadge, setNewBadge] = useState(false);

  const [stageOpt, setStageOpt] = useState("All Stages");
  const [reviewStatusOpt, setReviewStatusOpt] = useState("Pending + In Review");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchQueue = useCallback(async (p: number, s: string, rs: string) => {
    setLoading(true);
    const res = await getReviewQueue({
      page: p,
      pageSize: PAGE_SIZE,
      stage: stageMap[s] ?? "",
      reviewStatus: reviewStatusMap[rs] ?? "",
    });
    setReviews(res.reviews);
    setTotal(res.total);
    setError(res.error);
    setLoading(false);
    setNewBadge(false);
  }, []);

  useEffect(() => {
    fetchQueue(page, stageOpt, reviewStatusOpt);
  }, [page, stageOpt, reviewStatusOpt, fetchQueue]);

  // Supabase Realtime: auto-refresh when new manual_review_request arrives
  useEffect(() => {
    const channel = supabase
      .channel("admin-review-queue")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "manual_review_requests" },
        () => {
          setNewBadge(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "manual_review_requests" },
        () => {
          setNewBadge(true);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Filter reviews client-side by search (trip_code / vehicle_number)
  const filtered = search
    ? reviews.filter((r: any) => {
        const trip = r.trips;
        return (
          trip?.trip_code?.toLowerCase().includes(search.toLowerCase()) ||
          trip?.vehicle_number?.toLowerCase().includes(search.toLowerCase())
        );
      })
    : reviews;

  function handleStage(v: string) { setStageOpt(v); setPage(1); }
  function handleReviewStatus(v: string) { setReviewStatusOpt(v); setPage(1); }
  function handleSearch(v: string) { setSearch(v); }

  const stageLabel: Record<string, string> = {
    first_mile: "First Mile",
    mid_mile: "Middle Mile",
    last_mile: "Last Mile",
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Manual Review" }]}
        title="Manual Review Queue"
        right={
          <div className="flex items-center gap-3">
            {newBadge && (
              <button
                onClick={() => fetchQueue(page, stageOpt, reviewStatusOpt)}
                className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-1.5 text-sm font-semibold text-white animate-pulse"
              >
                ● New Review — Refresh
              </button>
            )}
            <span className="rounded-md bg-secondary px-3 py-1.5 font-semibold text-secondary-foreground">
              {total} In Queue
            </span>
          </div>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Select options={STAGE_OPTIONS} value={stageOpt} onChange={handleStage} />
        <Select options={REVIEW_STATUS_OPTIONS} value={reviewStatusOpt} onChange={handleReviewStatus} />
        <input
          type="date"
          className="h-11 rounded-md border border-input bg-card px-3 text-sm"
        />
      </div>
      <div className="mb-5 flex gap-3">
        <SearchBox placeholder="Search Trip ID / Vehicle No." value={search} onChange={handleSearch} />
        <button className={btn.outline}>
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="mb-3 text-sm text-muted-foreground">Loading…</div>}
      <DataTable
        head={["Trip ID", "Vehicle No.", "Stage", "Issue", "Priority", "Action"]}
        rows={filtered.map((r: any) => {
          const trip = r.trips;
          const priority = priorityFromNotes(r.user_notes);
          return [
            trip?.trip_code ?? r.id.slice(0, 8),
            trip?.vehicle_number ?? "—",
            stageLabel[trip?.stage ?? ""] ?? trip?.stage ?? "—",
            <span className={priority === "High" ? "text-destructive" : "text-muted-foreground"}>
              {r.user_notes ?? "Manual review requested"}
            </span>,
            <span
              className={`font-semibold ${priority === "High" ? "text-destructive" : "text-warning"}`}
            >
              {priority}
            </span>,
            <Link
              to="/verification/$tripId"
              params={{ tripId: trip?.id ?? r.trip_id }}
              className={btn.review}
            >
              Review
            </Link>,
          ];
        })}
      />
      <Pagination
        page={page}
        last={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
      />
    </>
  );
}
