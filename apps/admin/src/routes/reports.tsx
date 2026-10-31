import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { DataTable, PageHeader, Select, btn } from "@/components/admin/AdminShell";
import { getReportStats } from "@/lib/admin-queries";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — GrainShield AI" },
      { name: "description", content: "District-wise trip and verification reports." },
      { property: "og:title", content: "Reports — GrainShield AI" },
      { property: "og:description", content: "District-wise trip and verification reports." },
    ],
  }),
  loader: async () => {
    const result = await getReportStats();
    return result;
  },
  component: Reports,
});

const PERIOD_OPTIONS = ["All Time", "Last 7 days", "Last 30 days", "This quarter"];
const DISTRICT_OPTIONS = ["All Districts", "Ahmedabad", "Gandhinagar", "Vadodara", "Surat", "Rajkot", "Bhavnagar", "Jamnagar"];
const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];

/** Download data as CSV file */
function downloadCSV(districts: { name: string; total: number; pass: number; review: number; rejected: number }[]) {
  const header = "District/Origin,Total Trips,Passed,In Review,Rejected,Pass Rate %";
  const rows = districts.map((d) => {
    const rate = d.total > 0 ? ((d.pass / d.total) * 100).toFixed(1) : "0.0";
    return `"${d.name}",${d.total},${d.pass},${d.review},${d.rejected},${rate}%`;
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grainshield-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Reports() {
  const loaderData = Route.useLoaderData();

  const [allDistricts, setAllDistricts] = useState(loaderData.districts);
  const [error, setError] = useState(loaderData.error);

  const [periodOpt, setPeriodOpt] = useState("All Time");
  const [districtOpt, setDistrictOpt] = useState("All Districts");
  const [stageOpt, setStageOpt] = useState("All Stages");

  // Apply client-side district filter (server returns all; we filter client-side for district)
  const filtered = allDistricts.filter((d) => {
    if (districtOpt !== "All Districts" && d.name !== districtOpt) return false;
    return true;
  });

  function handleExportCSV() {
    downloadCSV(filtered.length > 0 ? filtered : allDistricts);
  }

  // Summarise
  const summary = filtered.reduce(
    (acc, d) => ({ total: acc.total + d.total, pass: acc.pass + d.pass, review: acc.review + d.review, rejected: acc.rejected + d.rejected }),
    { total: 0, pass: 0, review: 0, rejected: 0 }
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reports" }]}
        title="Reports"
        subtitle="Verification summary by district"
        right={
          <div className="flex gap-2">
            <button className={btn.outline} onClick={handleExportCSV} title="Export as CSV (opens in Excel)">
              <FileText className="h-4 w-4" />
              CSV / Excel
            </button>
            <button
              className={btn.primary}
              onClick={handleExportCSV}
              title="Download spreadsheet"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export
            </button>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Trips", value: summary.total, cls: "text-navy" },
          { label: "Passed", value: summary.pass, cls: "text-success" },
          { label: "In Review", value: summary.review, cls: "text-warning" },
          { label: "Rejected", value: summary.rejected, cls: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <div className="text-sm text-muted-foreground">{s.label}</div>
            <div className={`text-3xl font-bold ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Select options={PERIOD_OPTIONS} value={periodOpt} onChange={setPeriodOpt} />
        <Select options={DISTRICT_OPTIONS} value={districtOpt} onChange={setDistrictOpt} />
        <Select options={STAGE_OPTIONS} value={stageOpt} onChange={setStageOpt} />
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {filtered.length === 0 && !error && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No trip data available yet.
        </div>
      )}
      {filtered.length > 0 && (
        <DataTable
          head={["District / Origin", "Total Trips", "Passed", "In Review", "Rejected", "Pass Rate", ""]}
          rows={filtered.map(({ name, total, pass, review, rejected }) => {
            const rate = total > 0 ? ((pass / total) * 100).toFixed(1) + "%" : "—";
            return [
              <b>{name}</b>,
              total,
              <span className="text-success font-medium">{pass}</span>,
              <span className="text-warning font-medium">{review}</span>,
              <span className="text-destructive font-medium">{rejected}</span>,
              <span className="font-mono text-sm">{rate}</span>,
              <button
                aria-label={`Download ${name} report`}
                onClick={() => downloadCSV([{ name, total, pass, review, rejected }])}
                className="text-info hover:text-primary"
                title="Download this district"
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
