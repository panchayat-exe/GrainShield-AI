import { createFileRoute } from "@tanstack/react-router";
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

function Reports() {
  const { districts, error } = Route.useLoaderData();

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reports" }]}
        title="Reports"
        subtitle="Verification summary by district"
        right={
          <div className="flex gap-2">
            <button className={btn.outline}>
              <FileText className="h-4 w-4" />
              PDF
            </button>
            <button className={btn.primary}>
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </button>
          </div>
        }
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Select options={["Last 7 days", "Last 30 days", "This quarter"]} />
        <Select options={["All Districts", "Ahmedabad", "Gandhinagar", "Vadodara", "Surat", "Rajkot"]} />
        <Select options={["All Stages", "First Mile", "Middle Mile", "Last Mile"]} />
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {districts.length === 0 && !error && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No trip data available yet.
        </div>
      )}
      {districts.length > 0 && (
        <DataTable
          head={["District / Origin", "Total Trips", "Passed", "In Review", "Rejected", ""]}
          rows={districts.map(({ name, total, pass, review, rejected }) => [
            <b>{name}</b>,
            total,
            <span className="text-success">{pass}</span>,
            <span className="text-warning">{review}</span>,
            <span className="text-destructive">{rejected}</span>,
            <button aria-label="Download" className="text-info">
              <Download className="h-4 w-4" />
            </button>,
          ])}
        />
      )}
    </>
  );
}
