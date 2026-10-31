import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ClipboardCheck, FileBarChart, History, MapPin, Truck, ShieldCheck } from "lucide-react";
import truck from "@/assets/truck.jpg";
import { getDashboardStats } from "@/lib/admin-queries";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/")({
  loader: () => getDashboardStats(),
  head: () => ({
    meta: [
      { title: "Home — GrainShield AI Admin" },
      { name: "description", content: "Admin portal for AI-verified food grain transport across Gujarat." },
      { property: "og:title", content: "Home — GrainShield AI Admin" },
      { property: "og:description", content: "Admin portal for AI-verified food grain transport across Gujarat." },
    ],
  }),
  component: Home,
});

const tiles = [
  { to: "/trips", label: "Trips", desc: "All transport trips", icon: Truck },
  { to: "/verification", label: "Verification", desc: "Manual review queue", icon: ClipboardCheck },
  { to: "/live-tracking", label: "Live Tracking", desc: "Vehicles on the map", icon: MapPin },
  { to: "/reports", label: "Reports", desc: "District summaries", icon: FileBarChart },
  { to: "/audit-logs", label: "Audit Logs", desc: "Every action recorded", icon: History },
] as const;

function Home() {
  const initial = Route.useLoaderData();
  const [stats, setStats] = useState(initial);

  useEffect(() => {
    const refreshStats = async () => {
      const fresh = await getDashboardStats();
      setStats(fresh);
    };

    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, refreshStats)
      .on("postgres_changes", { event: "*", schema: "public", table: "verification_results" }, refreshStats)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="space-y-8">
      {/* Stats bar */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Trips", value: stats?.totalTrips ?? "—" },
          { label: "Pending Review", value: stats?.pendingReview ?? "—" },
          { label: "Passed", value: stats?.passed ?? "—" },
          { label: "Processing", value: stats?.processing ?? "—" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <div className="text-sm text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-3xl font-bold text-navy">{s.value}</div>
          </div>
        ))}
      </section>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card shadow-card md:grid-cols-2">
        <div className="flex flex-col justify-center gap-4 p-8">
          <span className="flex w-fit items-center gap-2 rounded-full bg-warning-soft px-3 py-1 text-sm font-medium text-warning">
            <ShieldCheck className="h-4 w-4" /> Admin Portal
          </span>
          <h1 className="font-display text-4xl font-bold text-navy">Welcome back, Admin Officer</h1>
          <p className="text-muted-foreground">
            Monitor every grain truck from FCI godown to fair price shop. AI checks each photo — you handle the exceptions.
          </p>
          <div className="flex gap-3">
            <Link to="/verification" className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Open review queue</Link>
            <Link to="/live-tracking" className="inline-flex items-center rounded-md border border-input px-5 py-2.5 text-sm font-medium text-info hover:bg-muted">Live tracking</Link>
          </div>
        </div>
        <img src={truck} alt="Grain transport truck" width={1024} height={768} className="h-full max-h-80 w-full object-cover" />
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="group rounded-lg border border-border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-accent">
            <t.icon className="mb-3 h-8 w-8 text-primary" />
            <div className="font-semibold text-navy">{t.label}</div>
            <div className="text-sm text-muted-foreground">{t.desc}</div>
          </Link>
        ))}
      </section>
    </div>
  );
}
