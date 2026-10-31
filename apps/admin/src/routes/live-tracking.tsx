import { createFileRoute } from "@tanstack/react-router";
import { LocateFixed, MapPin, Minus, Plus, Search, Truck } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/admin/AdminShell";
import map from "@/assets/map.jpg";
import { getActiveTripLocations, type ActiveTripLocation } from "@/lib/admin-queries";

export const Route = createFileRoute("/live-tracking")({
  loader: () => getActiveTripLocations(),
  head: () => ({
    meta: [
      { title: "Live Tracking — GrainShield AI" },
      { name: "description", content: "Follow grain trucks on the map in real time." },
      { property: "og:title", content: "Live Tracking — GrainShield AI" },
      { property: "og:description", content: "Follow grain trucks on the map in real time." },
    ],
  }),
  component: Live,
});

const stageTone = {
  first_mile: "info",
  mid_mile: "warning",
  last_mile: "success",
} as const;

const stageLabel = {
  first_mile: "First Mile",
  mid_mile: "Mid Mile",
  last_mile: "Last Mile",
} as const;

function formatRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function TripCard({ loc }: { loc: ActiveTripLocation }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-navy">{loc.tripCode}</div>
          <div className="text-xs text-muted-foreground">{loc.vehicleNumber}</div>
        </div>
        <Badge tone={stageTone[loc.stage]}>{stageLabel[loc.stage]}</Badge>
      </div>
      {loc.driverName && (
        <div className="mb-2 text-sm text-foreground">
          Driver: <span className="font-medium">{loc.driverName}</span>
        </div>
      )}
      <div className="mb-2 text-xs text-muted-foreground">
        {loc.origin} → {loc.destination ?? "—"}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-muted-foreground">
          {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
        </span>
        <span className="text-muted-foreground">{formatRelative(loc.recordedAt)}</span>
      </div>
      {loc.accuracyMeters != null && (
        <div className="mt-1 text-xs text-muted-foreground">±{Math.round(loc.accuracyMeters)} m accuracy</div>
      )}
    </div>
  );
}

function Live() {
  const { locations, error } = Route.useLoaderData();

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Live Tracking" }]}
        title="Trip Live Tracking"
        right={
          <div className="flex gap-2">
            <input
              placeholder="Search Trip ID, Vehicle No…"
              className="h-11 w-56 rounded-md border border-input bg-card px-3 text-sm"
            />
            <button aria-label="Search" className="grid h-11 w-11 place-items-center rounded-md bg-info text-primary-foreground">
              <Search className="h-5 w-5" />
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-sm text-destructive">
          Could not load tracking data: {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Map panel */}
        <div>
          <div className="relative overflow-hidden rounded-lg border border-border shadow-card">
            <img src={map} alt="Route map" width={1024} height={1280} className="h-[560px] w-full object-cover" />

            {/* Overlay dots for each real location */}
            {locations.slice(0, 8).map((loc, i) => {
              // Distribute markers across the map image as rough visual indicators
              const left = 25 + (i % 4) * 14;
              const top = 25 + Math.floor(i / 4) * 30;
              return (
                <div
                  key={loc.tripId}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <MapPin className="h-8 w-8 fill-info text-card drop-shadow-md" />
                  <span className="rounded bg-navy/80 px-1 py-0.5 text-[10px] text-white">{loc.vehicleNumber}</span>
                </div>
              );
            })}

            {/* Zoom controls */}
            <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-md border border-border bg-card">
              <button aria-label="Zoom in" className="p-2"><Plus className="h-4 w-4" /></button>
              <button aria-label="Zoom out" className="border-t border-border p-2"><Minus className="h-4 w-4" /></button>
              <button aria-label="Locate" className="border-t border-border p-2"><LocateFixed className="h-4 w-4" /></button>
            </div>

            {/* Active count badge */}
            <div className="absolute left-3 top-3 rounded-md bg-navy/90 px-3 py-1.5 text-sm font-medium text-white">
              {locations.length} active vehicle{locations.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-around gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-card">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-info" />First Mile</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-warning" />Mid Mile</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-success" />Last Mile</span>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card title={`Active Vehicles (${locations.length})`}>
            {locations.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
                <Truck className="h-10 w-10 opacity-30" />
                <p className="text-sm">No active trips with GPS data right now.</p>
                <p className="text-xs">Locations are uploaded by the mobile app during transport.</p>
              </div>
            ) : (
              <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                {locations.map((loc) => (
                  <TripCard key={loc.tripId} loc={loc} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
