import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { SlidersHorizontal, Calendar, UserCheck, RefreshCw } from "lucide-react";
import {
  DataTable,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  btn,
  Badge,
} from "@/components/admin/AdminShell";
import { getReviewQueue, assignReviewer } from "@/lib/admin-queries";
import type { TripStage } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/admin-auth";

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
    const [queueResult, session] = await Promise.all([
      getReviewQueue({ pageSize: 20, page: 1 }),
      getAdminSession(),
    ]);
    return { ...queueResult, adminUser: session };
  },
  component: Queue,
});

function priorityFromNotes(notes: string | null): "High" | "Medium" | "Low" {
  if (!notes) return "Medium";
  const lower = notes.toLowerCase();
  if (
    lower.includes("mismatch") ||
    lower.includes("not detected") ||
    lower.includes("fail") ||
    lower.includes("rejected")
  )
    return "High";
  if (lower.includes("blurry") || lower.includes("dark") || lower.includes("retake"))
    return "Medium";
  return "Low";
}

const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];
const REVIEW_STATUS_OPTIONS = [
  "Pending + In Review",
  "Pending",
  "In Review",
  "Resolved",
  "Escalated",
];

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

interface ReviewItem {
  id: string;
  status: string;
  user_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  reviewer_notes: string | null;
  assigned_reviewer: string | null;
  trips?: {
    id: string;
    trip_code: string;
    vehicle_number: string;
    stage: string;
    origin: string;
    destination: string | null;
    status: string;
  } | null;
  trip_evidence?: {
    id: string;
    original_filename: string;
    storage_path: string;
    uploaded_at: string;
  } | null;
}

const PAGE_SIZE = 20;

function Queue() {
  const loaderData = Route.useLoaderData();

  const [reviews, setReviews] = useState<ReviewItem[]>(
    (loaderData.reviews ?? []) as unknown as ReviewItem[],
  );
  const [total, setTotal] = useState(loaderData.total);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);
  const [newBadge, setNewBadge] = useState(false);
  const adminUser = loaderData.adminUser;

  const [stageOpt, setStageOpt] = useState("All Stages");
  const [reviewStatusOpt, setReviewStatusOpt] = useState("Pending + In Review");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchQueue = useCallback(async (p: number, s: string, rs: string, d: string) => {
    setLoading(true);
    const res = await getReviewQueue({
      page: p,
      pageSize: PAGE_SIZE,
      stage: stageMap[s] ?? "",
      reviewStatus: reviewStatusMap[rs] ?? "",
      dateFrom: d || undefined,
      dateTo: d || undefined,
    });
    setReviews((res.reviews ?? []) as unknown as ReviewItem[]);
    setTotal(res.total);
    setError(res.error);
    setLoading(false);
    setNewBadge(false);
  }, []);

  useEffect(() => {
    fetchQueue(page, stageOpt, reviewStatusOpt, dateFilter);
  }, [page, stageOpt, reviewStatusOpt, dateFilter, fetchQueue]);

  // Supabase Realtime: auto-refresh when new manual_review_request arrives
  useEffect(() => {
    const channel = supabase
      .channel("admin-review-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_review_requests" },
        () => {
          setNewBadge(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleAssignToMe(reviewId: string) {
    if (!adminUser?.id) return;
    await assignReviewer(reviewId, adminUser.id);
    await fetchQueue(page, stageOpt, reviewStatusOpt, dateFilter);
  }

  // Filter reviews client-side by search (trip_code / vehicle_number)
  const filtered = search
    ? reviews.filter((r: ReviewItem) => {
        const trip = r.trips;
        return (
          trip?.trip_code?.toLowerCase().includes(search.toLowerCase()) ||
          trip?.vehicle_number?.toLowerCase().includes(search.toLowerCase()) ||
          r.user_notes?.toLowerCase().includes(search.toLowerCase())
        );
      })
    : reviews;

  function handleStage(v: string) {
    setStageOpt(v);
    setPage(1);
  }
  function handleReviewStatus(v: string) {
    setReviewStatusOpt(v);
    setPage(1);
  }
  function handleSearch(v: string) {
    setSearch(v);
  }

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
        subtitle="Exceptions flagged by AI requiring authorized officer inspection"
        right={
          <div className="flex items-center gap-3">
            {newBadge && (
              <button
                onClick={() => fetchQueue(page, stageOpt, reviewStatusOpt, dateFilter)}
                className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-1.5 text-xs font-semibold text-white animate-pulse"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New Updates — Refresh
              </button>
            )}
            <span className="rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">
              {total} In Queue
            </span>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Select options={STAGE_OPTIONS} value={stageOpt} onChange={handleStage} />
        <Select
          options={REVIEW_STATUS_OPTIONS}
          value={reviewStatusOpt}
          onChange={handleReviewStatus}
        />
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(1);
            }}
            className="h-11 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          />
          {dateFilter && (
            <button
              onClick={() => {
                setDateFilter("");
                setPage(1);
              }}
              className="text-xs text-info hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 flex gap-3">
        <SearchBox
          placeholder="Search Trip ID, Vehicle No, or Reason…"
          value={search}
          onChange={handleSearch}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="mb-3 text-sm text-muted-foreground">Loading queue…</div>}

      <DataTable
        head={["Trip ID", "Vehicle No.", "Stage", "Issue / Flag", "Priority", "Reviewer", "Action"]}
        rows={filtered.map((r: ReviewItem) => {
          const trip = r.trips;
          const priority = priorityFromNotes(r.user_notes);
          const isAssignedToMe = r.assigned_reviewer === adminUser?.id;

          return [
            <b>{trip?.trip_code ?? r.id.slice(0, 8)}</b>,
            trip?.vehicle_number ?? "—",
            stageLabel[trip?.stage ?? ""] ?? trip?.stage ?? "—",
            <span
              className={
                priority === "High" ? "text-destructive font-medium" : "text-muted-foreground"
              }
            >
              {r.user_notes ?? "Manual review requested"}
            </span>,
            <span
              className={`font-semibold ${priority === "High" ? "text-destructive" : "text-warning"}`}
            >
              {priority}
            </span>,
            <span className="text-xs text-muted-foreground">
              {r.assigned_reviewer ? (
                isAssignedToMe ? (
                  <Badge tone="success">Assigned to You</Badge>
                ) : (
                  <Badge tone="info">Assigned</Badge>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => handleAssignToMe(r.id)}
                  className="text-xs text-info hover:underline flex items-center gap-1"
                >
                  <UserCheck className="h-3 w-3" /> Claim
                </button>
              )}
            </span>,
            <Link
              to="/verification/$tripId"
              params={{ tripId: trip?.id ?? r.id }}
              className={btn.review}
            >
              Inspect
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
