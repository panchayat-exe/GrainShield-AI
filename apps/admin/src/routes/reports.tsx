import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Download, FileSpreadsheet, FileText, Calendar, Filter, RefreshCw } from "lucide-react";
import { DataTable, PageHeader, Select, btn } from "@/components/admin/AdminShell";
import { getReportStats, logReportExport } from "@/lib/admin-queries";
import { getAdminSession, type AdminUser } from "@/lib/admin-auth";
import type { TripStage } from "@/lib/supabase";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Analytics — GrainShield AI" },
      {
        name: "description",
        content: "District-wise transport, verification, and compliance reports.",
      },
      { property: "og:title", content: "Reports & Analytics — GrainShield AI" },
      {
        property: "og:description",
        content: "District-wise transport, verification, and compliance reports.",
      },
    ],
  }),
  loader: async () => {
    const [result, session] = await Promise.all([getReportStats(), getAdminSession()]);
    return { ...result, adminUser: session };
  },
  component: Reports,
});

const PERIOD_OPTIONS = ["All Time", "Last 7 days", "Last 30 days", "This quarter (90 days)"];
const DISTRICT_OPTIONS = [
  "All Districts",
  "Ahmedabad",
  "Gandhinagar",
  "Vadodara",
  "Surat",
  "Rajkot",
  "Bhavnagar",
  "Jamnagar",
  "Mehsana",
  "Patan",
];
const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];

const periodDaysMap: Record<string, number> = {
  "All Time": 0,
  "Last 7 days": 7,
  "Last 30 days": 30,
  "This quarter (90 days)": 90,
};

const stageMap: Record<string, TripStage | ""> = {
  "All Stages": "",
  "First Mile": "first_mile",
  "Middle Mile": "mid_mile",
  "Last Mile": "last_mile",
};

/** Download data as formatted government compliance CSV file */
function downloadCSV(
  districts: {
    name: string;
    total: number;
    pass: number;
    review: number;
    rejected: number;
    firstMile?: number;
    lastMile?: number;
  }[],
  periodLabel: string,
  stageLabel: string,
  actorId?: string,
) {
  const exportDate = new Date().toISOString();
  const header =
    "District/Godown,Total Movements,First Mile,Last Mile,Verified Pass,In Review,Rejected,Pass Rate %,Report Generated";
  const rows = districts.map((d) => {
    const rate = d.total > 0 ? ((d.pass / d.total) * 100).toFixed(1) : "0.0";
    return `"${d.name}",${d.total},${d.firstMile ?? 0},${d.lastMile ?? 0},${d.pass},${d.review},${d.rejected},${rate}%,${exportDate}`;
  });

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grainshield-logistics-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  // Log report export in audit trail
  if (actorId) {
    logReportExport(actorId, {
      period: periodLabel,
      stage: stageLabel,
      total_districts: districts.length,
      timestamp: exportDate,
    }).catch(console.error);
  }
}

function Reports() {
  const loaderData = Route.useLoaderData();
  const adminUser = loaderData.adminUser;

  const [districts, setDistricts] = useState(loaderData.districts);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);

  const [periodOpt, setPeriodOpt] = useState("All Time");
  const [districtOpt, setDistrictOpt] = useState("All Districts");
  const [stageOpt, setStageOpt] = useState("All Stages");

  const fetchReports = useCallback(async (pOpt: string, sOpt: string, dOpt: string) => {
    setLoading(true);
    const result = await getReportStats({
      periodDays: periodDaysMap[pOpt] ?? 0,
      stage: stageMap[sOpt] ?? "",
      district: dOpt !== "All Districts" ? dOpt : "",
    });
    setDistricts(result.districts);
    setError(result.error);
    setLoading(false);
  }, []);

  // Re-fetch whenever filters change
  useEffect(() => {
    fetchReports(periodOpt, stageOpt, districtOpt);
  }, [periodOpt, stageOpt, districtOpt, fetchReports]);

  function handleExportCSV() {
    downloadCSV(districts, periodOpt, stageOpt, adminUser?.id);
  }

  // Calculate live summary aggregates
  const summary = districts.reduce(
    (acc, d) => ({
      total: acc.total + d.total,
      pass: acc.pass + d.pass,
      review: acc.review + d.review,
      rejected: acc.rejected + d.rejected,
      firstMile: acc.firstMile + (d.firstMile ?? 0),
      lastMile: acc.lastMile + (d.lastMile ?? 0),
    }),
    { total: 0, pass: 0, review: 0, rejected: 0, firstMile: 0, lastMile: 0 },
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reports" }]}
        title="Logistics & Verification Reports"
        subtitle="District-wise performance, stage distribution, and compliance audit summaries"
        right={
          <div className="flex gap-2">
            <button
              className={btn.outline}
              onClick={handleExportCSV}
              title="Export as CSV for Excel / MIS audit"
            >
              <FileText className="h-4 w-4" />
              CSV Report
            </button>
            <button
              className={btn.primary}
              onClick={handleExportCSV}
              title="Download official report"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Dataset
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Movements", value: summary.total, cls: "text-navy" },
          { label: "Passed & Cleared", value: summary.pass, cls: "text-success" },
          { label: "Under Manual Review", value: summary.review, cls: "text-warning" },
          { label: "Rejected / Non-Compliant", value: summary.rejected, cls: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`mt-1 text-3xl font-bold ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter Controls */}
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="text-xs text-muted-foreground mb-1 block">Time Period:</span>
          <Select options={PERIOD_OPTIONS} value={periodOpt} onChange={setPeriodOpt} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground mb-1 block">District / Division:</span>
          <Select options={DISTRICT_OPTIONS} value={districtOpt} onChange={setDistrictOpt} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground mb-1 block">Logistics Stage:</span>
          <Select options={STAGE_OPTIONS} value={stageOpt} onChange={setStageOpt} />
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Aggregating verified transport data…
        </div>
      )}

      {districts.length === 0 && !error && !loading && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No transport movements recorded matching the selected filter criteria.
        </div>
      )}

      {districts.length > 0 && (
        <DataTable
          head={[
            "District / Origin",
            "Total Trips",
            "First Mile",
            "Last Mile",
            "Passed",
            "In Review",
            "Rejected",
            "Pass Rate",
            "Action",
          ]}
          rows={districts.map((d) => {
            const rate = d.total > 0 ? ((d.pass / d.total) * 100).toFixed(1) + "%" : "—";
            return [
              <b>{d.name}</b>,
              d.total,
              <span className="text-xs text-muted-foreground">{d.firstMile ?? 0}</span>,
              <span className="text-xs text-muted-foreground">{d.lastMile ?? 0}</span>,
              <span className="text-success font-semibold">{d.pass}</span>,
              <span className="text-warning font-semibold">{d.review}</span>,
              <span className="text-destructive font-semibold">{d.rejected}</span>,
              <span className="font-mono text-sm font-semibold">{rate}</span>,
              <button
                aria-label={`Download ${d.name} report`}
                onClick={() => downloadCSV([d], periodOpt, stageOpt, adminUser?.id)}
                className="text-info hover:text-primary"
                title="Download single district breakdown"
              >
                <Download className="h-4 w-4" />
              </button>,
            ];
          })}
        />
      )}
    </>
  );
}
