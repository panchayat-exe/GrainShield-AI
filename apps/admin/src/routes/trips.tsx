import { createFileRoute, Link } from "@tanstack/react-router";
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
import type { TripStatus } from "@/lib/supabase";

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
    const result = await getTrips({ pageSize: 50 });
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

function Trips() {
  const { trips, total, error } = Route.useLoaderData();

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
        <Select options={["All Stages", "First Mile", "Middle Mile", "Last Mile"]} />
        <Select options={["All Status", "Submitted", "Processing", "Pass", "Retake", "Review", "Rejected", "Completed"]} />
        <div className="md:col-span-2">
          <SearchBox placeholder="Search Trip ID / Vehicle No." />
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
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
      <Pagination last={Math.ceil(total / 50)} />
    </>
  );
}
