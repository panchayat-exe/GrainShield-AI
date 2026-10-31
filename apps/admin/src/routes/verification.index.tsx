import { createFileRoute, Link } from "@tanstack/react-router";
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
    const result = await getReviewQueue({ pageSize: 50 });
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

function Queue() {
  const { reviews, total, error } = Route.useLoaderData();

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Manual Review" }]}
        title="Manual Review Queue"
        right={
          <span className="rounded-md bg-secondary px-3 py-1.5 font-semibold text-secondary-foreground">
            {total} In Queue
          </span>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Select options={["All Stages", "First Mile", "Middle Mile", "Last Mile"]} />
        <Select options={["All Status", "Pending", "In Review", "Escalated"]} />
        <input
          type="date"
          className="h-11 rounded-md border border-input bg-card px-3 text-sm"
        />
      </div>
      <div className="mb-5 flex gap-3">
        <SearchBox placeholder="Search Trip ID / Vehicle No." />
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
      <DataTable
        head={["Trip ID", "Vehicle No.", "Stage", "Issue", "Priority", "Action"]}
        rows={reviews.map((r: any) => {
          const trip = r.trips;
          const priority = priorityFromNotes(r.user_notes);
          const stageLabel: Record<string, string> = {
            first_mile: "First Mile",
            mid_mile: "Middle Mile",
            last_mile: "Last Mile",
          };
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
      <Pagination last={Math.ceil(total / 50)} />
    </>
  );
}
