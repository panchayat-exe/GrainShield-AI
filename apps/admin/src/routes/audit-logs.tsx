import { createFileRoute } from "@tanstack/react-router";
import { Badge, DataTable, PageHeader, Pagination, SearchBox, Select } from "@/components/admin/AdminShell";
import { getAuditLogs } from "@/lib/admin-queries";

export const Route = createFileRoute("/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs — GrainShield AI" },
      { name: "description", content: "History of all actions performed by users and the AI system." },
      { property: "og:title", content: "Audit Logs — GrainShield AI" },
      { property: "og:description", content: "History of all actions performed by users and the AI system." },
    ],
  }),
  loader: async () => {
    const result = await getAuditLogs({ pageSize: 50 });
    return result;
  },
  component: Logs,
});

const tone = (a: string) =>
  (a.includes("pass") || a.includes("Pass")
    ? "success"
    : a.includes("reject") || a.includes("Reject") || a.includes("fail")
      ? "danger"
      : "warning") as "success";

function Logs() {
  const { logs, total, error } = Route.useLoaderData();

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Audit Logs" }]}
        title="Audit Logs"
        subtitle="History of all actions performed by users and system"
      />
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-lg border border-border bg-card p-4 shadow-card">
          <span className="mb-2 block text-sm font-medium">Date Range</span>
          <div className="flex gap-2">
            <input
              type="date"
              className="h-11 flex-1 rounded-md border border-input px-3 text-sm"
            />
            <input
              type="date"
              className="h-11 flex-1 rounded-md border border-input px-3 text-sm"
            />
          </div>
        </label>
        <label className="rounded-lg border border-border bg-card p-4 shadow-card">
          <span className="mb-2 block text-sm font-medium">Action Type</span>
          <Select options={["All Actions", "verification.pass", "verification.manual_review", "review.resolved"]} />
        </label>
      </div>
      <div className="mb-5">
        <SearchBox placeholder="Search by Trip ID, Vehicle No." />
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <DataTable
        head={["Date & Time", "Trip ID", "Action", "Performed By", "Details"]}
        rows={logs.map((l) => [
          new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          l.trip_id ? l.trip_id.slice(0, 8) + "…" : "—",
          <Badge tone={tone(l.action)}>{l.action}</Badge>,
          l.actor_id ? l.actor_id.slice(0, 8) + "…" : "AI System",
          l.metadata ? JSON.stringify(l.metadata).slice(0, 60) : "—",
        ])}
      />
      <Pagination last={Math.ceil(total / 50)} />
    </>
  );
}
