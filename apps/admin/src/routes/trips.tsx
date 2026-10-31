import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Plus } from "lucide-react";
import {
  Badge,
  DataTable,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  btn,
} from "@/components/admin/AdminShell";
import { getTrips } from "@/lib/admin-queries";
import type { TripStatus, TripStage } from "@/lib/supabase";

export const Route = createFileRoute("/trips")({
  head: () => ({
    meta: [
      { title: "Trips — GrainShield AI" },
      { name: "description", content: "All food grain transport trips with stage and status." },
      { property: "og:title", content: "Trips — GrainShield AI" },
      { property: "og:description", content: "All food grain transport trips with stage and status." },
    ],
  }),
  loader: async () => {
    const result = await getTrips({ pageSize: 20, page: 1 });
    return result;
  },
  component: Trips,
});

const tone = (s: TripStatus) =>
  (s === "pass" || s === "completed"
    ? "success"
    : s === "rejected"
      ? "danger"
      : s === "manual_review" || s === "retake"
        ? "warning"
        : "info") as "success";

const stageLabel: Record<string, string> = {
  first_mile: "First Mile",
  mid_mile: "Middle Mile",
  last_mile: "Last Mile",
};

const statusLabel: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  processing: "Processing",
  pass: "Pass",
  retake: "Retake",
  manual_review: "Review",
  rejected: "Rejected",
  completed: "Completed",
};

const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];
const STATUS_OPTIONS = ["All Status", "Submitted", "Processing", "Pass", "Retake", "Review", "Rejected", "Completed"];

const stageMap: Record<string, TripStage | ""> = {
  "All Stages": "",
  "First Mile": "first_mile",
  "Middle Mile": "mid_mile",
  "Last Mile": "last_mile",
};
const statusMap: Record<string, TripStatus | ""> = {
  "All Status": "",
  Submitted: "submitted",
  Processing: "processing",
  Pass: "pass",
  Retake: "retake",
  Review: "manual_review",
  Rejected: "rejected",
  Completed: "completed",
};

const PAGE_SIZE = 20;

function Trips() {
  const loaderData = Route.useLoaderData();

  const [trips, setTrips] = useState(loaderData.trips);
  const [total, setTotal] = useState(loaderData.total);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);

  const [stageOpt, setStageOpt] = useState("All Stages");
  const [statusOpt, setStatusOpt] = useState("All Status");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchTrips = useCallback(async (p: number, s: string, st: string, q: string) => {
    setLoading(true);
    const res = await getTrips({
      page: p,
      pageSize: PAGE_SIZE,
      stage: stageMap[s] ?? "",
      status: statusMap[st] ?? "",
      search: q,
    });
    setTrips(res.trips);
    setTotal(res.total);
    setError(res.error);
    setLoading(false);
  }, []);

  // Re-fetch whenever filter/search/page changes (debounce search by 300ms)
  useEffect(() => {
    const id = setTimeout(() => fetchTrips(page, stageOpt, statusOpt, search), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [page, stageOpt, statusOpt, search, fetchTrips]);

  function handleStage(v: string) { setStageOpt(v); setPage(1); }
  function handleStatus(v: string) { setStatusOpt(v); setPage(1); }
  function handleSearch(v: string) { setSearch(v); setPage(1); }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Trips" }]}
        title="All Trips"
        subtitle={`${total} grain movement${total !== 1 ? "s" : ""} across the district`}
        right={
          <button className={btn.primary}>
            <Plus className="h-4 w-4" />
            Create Trip
          </button>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Select options={STAGE_OPTIONS} value={stageOpt} onChange={handleStage} />
        <Select options={STATUS_OPTIONS} value={statusOpt} onChange={handleStatus} />
        <div className="md:col-span-2">
          <SearchBox placeholder="Search Trip ID / Vehicle No." value={search} onChange={handleSearch} />
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && (
        <div className="mb-3 text-sm text-muted-foreground">Loading…</div>
      )}
      <DataTable
        head={["Trip ID", "Vehicle No.", "Driver", "Stage", "Route", "Status", ""]}
        rows={trips.map((t) => [
          <b>{t.trip_code}</b>,
          t.vehicle_number,
          t.driver_name ?? "—",
          stageLabel[t.stage] ?? t.stage,
          `${t.origin ?? "?"} → ${t.destination ?? "?"}`,
          <Badge tone={tone(t.status as TripStatus)}>{statusLabel[t.status] ?? t.status}</Badge>,
          <Link
            to="/verification/$tripId"
            params={{ tripId: t.id }}
            className="text-info hover:underline"
          >
            View
          </Link>,
        ])}
      />
      <Pagination
        page={page}
        last={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
      />
    </>
  );
}
