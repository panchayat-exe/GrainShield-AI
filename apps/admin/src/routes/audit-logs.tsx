import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Download, FileSpreadsheet, Eye, X, Shield, History } from "lucide-react";
import {
  Badge,
  DataTable,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  btn,
} from "@/components/admin/AdminShell";
import { getAuditLogs } from "@/lib/admin-queries";
import type { AuditLog } from "@/lib/supabase";

export const Route = createFileRoute("/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Trail & Logs — GrainShield AI" },
      {
        name: "description",
        content: "Immutable history of all actions performed by officers and the AI system.",
      },
      { property: "og:title", content: "Audit Trail & Logs — GrainShield AI" },
      {
        property: "og:description",
        content: "Immutable history of all actions performed by officers and the AI system.",
      },
    ],
  }),
  loader: async () => {
    const result = await getAuditLogs({ pageSize: 50 });
    return result;
  },
  component: Logs,
});

const tone = (a: string) =>
  (a.includes("pass") || a.includes("Pass") || a.includes("resolved")
    ? "success"
    : a.includes("reject") || a.includes("Reject") || a.includes("fail")
      ? "danger"
      : a.includes("review") || a.includes("role")
        ? "warning"
        : "info") as "success";

const ACTION_OPTIONS = [
  "All Actions",
  "verification_completed",
  "manual_review_pass",
  "manual_review_retake",
  "manual_review_rejected",
  "user_role_changed",
  "trip_created",
  "trip_status_updated",
  "report_exported",
];

const PAGE_SIZE = 50;

function downloadAuditCSV(logs: AuditLog[]) {
  const header = "Timestamp,Log ID,Action,Entity Type,Entity ID,Trip ID,Actor ID,Metadata";
  const rows = logs.map((l) => {
    const meta = JSON.stringify(l.metadata ?? {}).replace(/"/g, '""');
    return `"${l.created_at}","${l.id}","${l.action}","${l.entity_type}","${l.entity_id ?? ""}","${l.trip_id ?? ""}","${l.actor_id ?? "SYSTEM"}","${meta}"`;
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grainshield-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // Selected Log for JSON Metadata Modal
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

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

  function handleAction(v: string) {
    setActionOpt(v);
    setPage(1);
  }
  function handleDateFrom(v: string) {
    setDateFrom(v);
    setPage(1);
  }
  function handleDateTo(v: string) {
    setDateTo(v);
    setPage(1);
  }
  function handleSearch(v: string) {
    setSearch(v);
  }

  const filtered = search
    ? logs.filter(
        (l) =>
          (l.trip_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (l.actor_id ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (l.action ?? "").toLowerCase().includes(search.toLowerCase()) ||
          JSON.stringify(l.metadata ?? "")
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
    : logs;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Audit Logs" }]}
        title="Immutable Audit Trail"
        subtitle="Cryptographically tracked log of all system decisions, administrative reviews, and role changes"
        right={
          <button
            onClick={() => downloadAuditCSV(filtered)}
            className={btn.primary}
            title="Download audit logs in CSV format"
          >
            <Download className="h-4 w-4" />
            Export Audit Trail (CSV)
          </button>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-lg border border-border bg-card p-4 shadow-card">
          <span className="mb-2 block text-xs font-medium text-muted-foreground">
            Date Range Filter
          </span>
          <div className="flex gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateFrom(e.target.value)}
              className="h-10 flex-1 rounded-md border border-input px-3 text-xs bg-background"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateTo(e.target.value)}
              className="h-10 flex-1 rounded-md border border-input px-3 text-xs bg-background"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setPage(1);
                }}
                className="px-2 text-xs text-info hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </label>
        <label className="rounded-lg border border-border bg-card p-4 shadow-card">
          <span className="mb-2 block text-xs font-medium text-muted-foreground">
            Event / Action Type
          </span>
          <Select options={ACTION_OPTIONS} value={actionOpt} onChange={handleAction} />
        </label>
      </div>

      {/* Date range filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setPage(1);
            }}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Clear Dates
          </button>
        )}
      </div>

      <div className="mb-5">
        <SearchBox
          placeholder="Search by Trip ID, Actor ID, action, or metadata…"
          value={search}
          onChange={handleSearch}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="mb-3 text-sm text-muted-foreground">Loading audit records…</div>}

      <DataTable
        head={[
          "Timestamp (IST)",
          "Action",
          "Trip Reference",
          "Performed By",
          "Metadata Details",
          "",
        ]}
        rows={filtered.map((l) => [
          <span className="font-mono text-xs">
            {new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
          </span>,
          <Badge tone={tone(l.action)}>{l.action}</Badge>,
          l.trip_id ? (
            <span className="font-mono text-xs font-semibold text-foreground">
              {l.trip_id.slice(0, 8)}…
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
          l.actor_id ? (
            <span className="font-mono text-xs text-info">{l.actor_id.slice(0, 8)}…</span>
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">AI System</span>
          ),
          <span className="font-mono text-xs text-muted-foreground">
            {l.metadata ? JSON.stringify(l.metadata).slice(0, 50) + "…" : "—"}
          </span>,
          <button
            onClick={() => setSelectedLog(l)}
            className="text-info hover:text-primary text-xs flex items-center gap-1 font-medium"
            title="View complete JSON metadata"
          >
            <Eye className="h-3.5 w-3.5" /> Details
          </button>,
        ])}
      />

      <Pagination
        page={page}
        last={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
      />

      {/* JSON Metadata Viewer Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-navy text-base">Audit Log Record Details</h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-md">
                <div>
                  <b>Action:</b> {selectedLog.action}
                </div>
                <div>
                  <b>Entity:</b> {selectedLog.entity_type} ({selectedLog.entity_id ?? "—"})
                </div>
                <div>
                  <b>Timestamp:</b> {new Date(selectedLog.created_at).toLocaleString("en-IN")}
                </div>
                <div>
                  <b>Actor:</b> {selectedLog.actor_id ?? "AI Worker System"}
                </div>
                {selectedLog.trip_id && (
                  <div className="col-span-2">
                    <b>Trip ID:</b> {selectedLog.trip_id}
                  </div>
                )}
              </div>

              <div>
                <span className="font-semibold text-muted-foreground block mb-1">
                  Payload Metadata:
                </span>
                <pre className="max-h-60 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs text-emerald-400">
                  {JSON.stringify(selectedLog.metadata, null, 2) || "{}"}
                </pre>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded-md bg-muted px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/80"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
