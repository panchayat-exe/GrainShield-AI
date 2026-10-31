import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
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

const ACTION_OPTIONS = [
  "All Actions",
  "verification.pass",
  "verification.fail",
  "verification.manual_review",
  "verification.retake",
  "review.resolved",
  "review.escalated",
  "trip.created",
  "trip.updated",
];

const PAGE_SIZE = 50;

function Logs() {
  const loaderData = Route.useLoaderData();

  const [logs, setLogs] = useState(loaderData.logs);
  const [total, setTotal] = useState(loaderData.total);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);

  const [actionOpt, setActionOpt] = useState("All Actions");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async (p: number, action: string, from: string, to: string) => {
    setLoading(true);
    const res = await getAuditLogs({
      page: p,
      pageSize: PAGE_SIZE,
      action: action === "All Actions" ? "" : action,
      dateFrom: from,
      dateTo: to,
    });
    setLogs(res.logs);
    setTotal(res.total);
    setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs(page, actionOpt, dateFrom, dateTo);
  }, [page, actionOpt, dateFrom, dateTo, fetchLogs]);

  function handleAction(v: string) { setActionOpt(v); setPage(1); }
  function handleDateFrom(v: string) { setDateFrom(v); setPage(1); }
  function handleDateTo(v: string) { setDateTo(v); setPage(1); }
  function handleSearch(v: string) { setSearch(v); }

  // Client-side search on trip_id / actor_id
  const filtered = search
    ? logs.filter((l) =>
        (l.trip_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (l.actor_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (l.action ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : logs;

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
              value={dateFrom}
              onChange={(e) => handleDateFrom(e.target.value)}
              className="h-11 flex-1 rounded-md border border-input px-3 text-sm"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateTo(e.target.value)}
              className="h-11 flex-1 rounded-md border border-input px-3 text-sm"
            />
          </div>
        </label>
        <label className="rounded-lg border border-border bg-card p-4 shadow-card">
          <span className="mb-2 block text-sm font-medium">Action Type</span>
          <Select options={ACTION_OPTIONS} value={actionOpt} onChange={handleAction} />
        </label>
      </div>
      <div className="mb-5">
        <SearchBox placeholder="Search by Trip ID, Actor ID, or Action" value={search} onChange={handleSearch} />
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="mb-3 text-sm text-muted-foreground">Loading…</div>}
      <DataTable
        head={["Date & Time", "Trip ID", "Action", "Performed By", "Details"]}
        rows={filtered.map((l) => [
          new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          l.trip_id ? l.trip_id.slice(0, 8) + "…" : "—",
          <Badge tone={tone(l.action)}>{l.action}</Badge>,
          l.actor_id ? l.actor_id.slice(0, 8) + "…" : "AI System",
          l.metadata ? JSON.stringify(l.metadata).slice(0, 60) : "—",
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
