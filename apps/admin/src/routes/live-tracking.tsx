import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LocateFixed, Minus, Plus, Search, Truck } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/admin/AdminShell";
import { getActiveTripLocations, type ActiveTripLocation } from "@/lib/admin-queries";
import "leaflet/dist/leaflet.css";

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

const stageColor: Record<string, string> = {
  first_mile: "#3b82f6",  // blue
  mid_mile:   "#f59e0b",  // amber
  last_mile:  "#22c55e",  // green
};

function formatRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function TripCard({ loc, selected, onSelect }: { loc: ActiveTripLocation; selected: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border p-4 shadow-sm transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
      }`}
    >
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

/**
 * LeafletMap — renders real OpenStreetMap tiles with vehicle markers.
 * Uses lazy import to avoid SSR issues.
 */
function LeafletMap({ locations, selectedId, onSelect }: {
  locations: ActiveTripLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});

  // Gujarat center as default view
  const GUJARAT_CENTER: [number, number] = [22.309, 72.136];

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current || mapRef.current?.dataset["leafletId"]) return; // already init

    // Dynamically import Leaflet to avoid SSR
    import("leaflet").then((L) => {
      // Fix default icon paths (Webpack/Vite strips them)
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, {
        center: GUJARAT_CENTER,
        zoom: locations.length > 0 ? 8 : 7,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = { map, L };
      if (mapRef.current) mapRef.current.dataset["leafletId"] = "initialized";

      // Add markers for initial locations
      addMarkers(L, map, locations, onSelect);

      // Fit bounds if we have locations
      if (locations.length > 0) {
        const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    });

    return () => {
      if (mapInstanceRef.current?.map) {
        mapInstanceRef.current.map.remove();
        mapInstanceRef.current = null;
        markersRef.current = {};
      }
      if (mapRef.current) {
        delete mapRef.current.dataset["leafletId"];
      }
    };
  }, []); // init once

  function addMarkers(L: any, map: any, locs: ActiveTripLocation[], onSelect: (id: string) => void) {
    // Remove old markers
    Object.values(markersRef.current).forEach((m: any) => m.remove());
    markersRef.current = {};

    locs.forEach((loc) => {
      const color = stageColor[loc.stage] ?? "#6b7280";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 0C6.27 0 0 6.27 0 14c0 9.33 14 22 14 22S28 23.33 28 14C28 6.27 21.73 0 14 0z" fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
      </svg>`;
      const icon = L.divIcon({
        html: svg,
        iconSize: [28, 36],
        iconAnchor: [14, 36],
        popupAnchor: [0, -36],
        className: "",
      });
      const marker = L.marker([loc.latitude, loc.longitude], { icon })
        .addTo(map)
        .bindPopup(
          `<div style="min-width:160px">
            <b>${loc.tripCode}</b><br/>
            ${loc.vehicleNumber}<br/>
            ${loc.driverName ?? ""}<br/>
            <span style="font-size:11px;color:#888">${loc.origin} → ${loc.destination ?? "—"}</span>
          </div>`
        )
        .on("click", () => onSelect(loc.tripId));
      markersRef.current[loc.tripId] = marker;
    });
  }

  // Pan to selected marker
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedId) return;
    const marker = markersRef.current[selectedId];
    if (marker) {
      mapInstanceRef.current.map.panTo(marker.getLatLng(), { animate: true });
      marker.openPopup();
    }
  }, [selectedId]);

  return <div ref={mapRef} className="h-[560px] w-full rounded-lg border border-border" />;
}

function Live() {
  const { locations, error } = Route.useLoaderData();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = search
    ? locations.filter(
        (l) =>
          l.tripCode.toLowerCase().includes(search.toLowerCase()) ||
          l.vehicleNumber.toLowerCase().includes(search.toLowerCase())
      )
    : locations;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Live Tracking" }]}
        title="Trip Live Tracking"
        right={
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
          <div className="relative">
            <LeafletMap
              locations={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {/* Active count badge */}
            <div className="absolute left-3 top-3 z-[1000] rounded-md bg-navy/90 px-3 py-1.5 text-sm font-medium text-white">
              {filtered.length} active vehicle{filtered.length !== 1 ? "s" : ""}
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
          <Card title={`Active Vehicles (${filtered.length})`}>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
                <Truck className="h-10 w-10 opacity-30" />
                <p className="text-sm">No active trips with GPS data right now.</p>
                <p className="text-xs">Locations are uploaded by the mobile app during transport.</p>
              </div>
            ) : (
              <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
                {filtered.map((loc) => (
                  <TripCard
                    key={loc.tripId}
                    loc={loc}
                    selected={selectedId === loc.tripId}
                    onSelect={() => setSelectedId(selectedId === loc.tripId ? null : loc.tripId)}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
