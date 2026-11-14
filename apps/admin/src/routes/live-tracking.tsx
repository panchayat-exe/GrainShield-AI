import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { LocateFixed, Minus, Plus, Search, Truck, Radio, RefreshCw } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/admin/AdminShell";
import { getActiveTripLocations, type ActiveTripLocation } from "@/lib/admin-queries";
import { supabase } from "@/lib/supabase";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

interface LeafletMapWrapper {
  map: Leaflet.Map;
  L: typeof Leaflet;
}

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
  first_mile: "#3b82f6", // blue
  mid_mile: "#f59e0b", // amber
  last_mile: "#22c55e", // green
};

function formatRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function TripCard({
  loc,
  selected,
  onSelect,
}: {
  loc: ActiveTripLocation;
  selected: boolean;
  onSelect: () => void;
}) {
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
      {/* Staleness warning: signal older than 10 minutes */}
      {new Date().getTime() - new Date(loc.recordedAt).getTime() > 10 * 60 * 1000 && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600">
          <span>⚠</span>
          <span>
            Last signal{" "}
            {Math.round((new Date().getTime() - new Date(loc.recordedAt).getTime()) / 60000)}m ago —
            GPS may be offline
          </span>
        </div>
      )}
      {loc.accuracyMeters != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          ±{Math.round(loc.accuracyMeters)} m accuracy
        </div>
      )}
    </div>
  );
}

/**
 * LeafletMap — renders real OpenStreetMap tiles with vehicle markers.
 * Dynamically re-renders markers when locations state updates via Realtime.
 */

/**
 * Fetches real road routing polyline from OSRM (Open Source Routing Machine).
 * Falls back to straight direct corridor if OSRM is unreachable or timed out.
 */
async function fetchPlannedRoadRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<{ coordinates: [number, number][]; isRealRoad: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error("OSRM routing returned " + res.status);
    const json = await res.json();
    if (json.routes && json.routes[0]?.geometry?.coordinates) {
      // GeoJSON returns [lng, lat], Leaflet expects [lat, lng]
      const coords = json.routes[0].geometry.coordinates.map(
        (c: [number, number]) => [c[1], c[0]] as [number, number],
      );
      return { coordinates: coords, isRealRoad: true };
    }
  } catch (err) {
    console.warn("[live-tracking] OSRM road routing fallback:", err);
  }
  return {
    coordinates: [
      [originLat, originLng],
      [destLat, destLng],
    ],
    isRealRoad: false,
  };
}

/**
 * Fetches the actual historical GPS track recorded for a trip.
 */
async function fetchActualGpsTrack(tripId: string): Promise<[number, number][]> {
  try {
    const { data } = await supabase
      .from("trip_locations")
      .select("latitude, longitude")
      .eq("trip_id", tripId)
      .order("recorded_at", { ascending: true })
      .limit(200);
    if (!data) return [];
    return data.map((d) => [d.latitude, d.longitude] as [number, number]);
  } catch {
    return [];
  }
}

function LeafletMap({
  locations,
  selectedId,
  onSelect,
}: {
  locations: ActiveTripLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMapWrapper | null>(null);
  const markersRef = useRef<Record<string, Leaflet.Marker>>({});
  const pinMarkersRef = useRef<Leaflet.Layer[]>([]);
  const plannedRouteLineRef = useRef<Leaflet.Polyline | null>(null);
  const actualRouteLineRef = useRef<Leaflet.Polyline | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ isRealRoad: boolean } | null>(null);

  const GUJARAT_CENTER: [number, number] = [22.309, 72.136];

  function addMarkers(
    L: typeof Leaflet,
    map: Leaflet.Map,
    locs: ActiveTripLocation[],
    onSelectFn: (id: string) => void,
  ) {
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};
    pinMarkersRef.current.forEach((m) => m.remove());
    pinMarkersRef.current = [];

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
          </div>`,
        )
        .on("click", () => onSelectFn(loc.tripId));
      markersRef.current[loc.tripId] = marker;
    });

    // ── Origin / Destination / Checkpoints Pins ─────────────────────────────
    locs.forEach((loc) => {
      const originSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <rect x="1" y="1" width="20" height="20" rx="4" fill="#16a34a" stroke="white" stroke-width="2"/>
        <text x="11" y="15" text-anchor="middle" font-size="11" fill="white" font-weight="bold">O</text>
      </svg>`;
      const destSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <rect x="1" y="1" width="20" height="20" rx="4" fill="#dc2626" stroke="white" stroke-width="2"/>
        <text x="11" y="15" text-anchor="middle" font-size="11" fill="white" font-weight="bold">D</text>
      </svg>`;
      const cpSvg = (
        n: number,
      ) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill="#7c3aed" stroke="white" stroke-width="2"/>
        <text x="10" y="14" text-anchor="middle" font-size="9" fill="white" font-weight="bold">C${n}</text>
      </svg>`;

      if (loc.originLat != null && loc.originLng != null) {
        const originIcon = L.divIcon({
          html: originSvg,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          className: "",
        });
        const originMarker = L.marker([loc.originLat, loc.originLng], { icon: originIcon })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:12px"><b>Origin</b><br/>${loc.tripCode}<br/>${loc.origin ?? ""}</div>`,
          );
        pinMarkersRef.current.push(originMarker);
      }

      if (loc.destinationLat != null && loc.destinationLng != null) {
        const destIcon = L.divIcon({
          html: destSvg,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          className: "",
        });
        const destMarker = L.marker([loc.destinationLat, loc.destinationLng], { icon: destIcon })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:12px"><b>Destination</b><br/>${loc.tripCode}<br/>${loc.destination ?? ""}</div>`,
          );
        pinMarkersRef.current.push(destMarker);
      }

      // Checkpoint virtual markers if midway
      if (loc.originLat != null && loc.destinationLat != null) {
        const cp1Lat = loc.originLat + (loc.destinationLat - loc.originLat) * 0.33;
        const cp1Lng = loc.originLng! + (loc.destinationLng! - loc.originLng!) * 0.33;
        const cpIcon = L.divIcon({
          html: cpSvg(1),
          iconSize: [20, 20],
          iconAnchor: [10, 10],
          className: "",
        });
        const cpMarker = L.marker([cp1Lat, cp1Lng], { icon: cpIcon })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:12px"><b>Transit Checkpoint (CP2)</b><br/>${loc.tripCode}</div>`,
          );
        pinMarkersRef.current.push(cpMarker);
      }
    });
  }

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current || mapRef.current?.dataset["leafletId"]) return;
    const currentRef = mapRef.current;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !currentRef || currentRef.dataset["leafletId"]) return;
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(currentRef, {
        center: GUJARAT_CENTER,
        zoom: locations.length > 0 ? 8 : 7,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = { map, L };
      currentRef.dataset["leafletId"] = "initialized";

      addMarkers(L, map, locations, onSelect);

      if (locations.length > 0) {
        const bounds = L.latLngBounds(
          locations.map((l) => [l.latitude, l.longitude] as [number, number]),
        );
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current?.map) {
        mapInstanceRef.current.map.remove();
        mapInstanceRef.current = null;
        markersRef.current = {};
      }
      if (currentRef) {
        delete currentRef.dataset["leafletId"];
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update markers when locations array updates
  useEffect(() => {
    if (mapInstanceRef.current?.map && mapInstanceRef.current?.L) {
      addMarkers(mapInstanceRef.current.L, mapInstanceRef.current.map, locations, onSelect);
    }
  }, [locations, onSelect]);

  // Pan to selected marker and draw Planned Route vs Actual GPS Route
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const { map, L } = mapInstanceRef.current;

    // Clean up previous route lines
    if (plannedRouteLineRef.current) {
      plannedRouteLineRef.current.remove();
      plannedRouteLineRef.current = null;
    }
    if (actualRouteLineRef.current) {
      actualRouteLineRef.current.remove();
      actualRouteLineRef.current = null;
    }
    setRouteInfo(null);

    if (!selectedId) return;

    const loc = locations.find((l) => l.tripId === selectedId);
    if (!loc) return;

    const marker = markersRef.current[selectedId];
    if (marker) {
      marker.openPopup();
    }

    // 1. Draw Planned Route (Real Road from OSRM or clearly labelled corridor)
    if (
      loc.originLat != null &&
      loc.originLng != null &&
      loc.destinationLat != null &&
      loc.destinationLng != null
    ) {
      fetchPlannedRoadRoute(
        loc.originLat,
        loc.originLng,
        loc.destinationLat,
        loc.destinationLng,
      ).then((res) => {
        if (!mapInstanceRef.current) return;
        setRouteInfo({ isRealRoad: res.isRealRoad });
        const line = L.polyline(res.coordinates, {
          color: res.isRealRoad ? "#2563eb" : "#64748b",
          weight: 3.5,
          dashArray: res.isRealRoad ? "6, 6" : "3, 6",
          opacity: 0.85,
        }).addTo(map);
        plannedRouteLineRef.current = line;
      });
    }

    // 2. Draw Actual Traveled Route from recorded GPS telemetry
    fetchActualGpsTrack(selectedId).then((gpsPoints) => {
      if (!mapInstanceRef.current || gpsPoints.length < 2) return;
      const actualLine = L.polyline(gpsPoints, {
        color: "#059669", // emerald
        weight: 4.5,
        opacity: 0.95,
      }).addTo(map);
      actualRouteLineRef.current = actualLine;
    });

    if (marker) {
      mapInstanceRef.current.map.panTo(marker.getLatLng(), { animate: true });
    }
  }, [selectedId, locations]);

  return (
    <div className="relative">
      <div ref={mapRef} className="h-[560px] w-full rounded-lg border border-border" />
      {/* Route & Telemetry Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] rounded-md border border-border/80 bg-card/95 p-2.5 text-xs shadow-md backdrop-blur-sm">
        <div className="font-semibold text-foreground mb-1">Route & Telemetry Legend</div>
        <div className="space-y-1 text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="h-2 w-5 rounded bg-emerald-600"></span>
            <span>Actual GPS Traveled Route</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-5 border-t-2 border-dashed border-blue-600"></span>
            <span>
              Planned Road Route{" "}
              {routeInfo
                ? routeInfo.isRealRoad
                  ? "(OSRM Verified Road)"
                  : "(Direct Corridor)"
                : ""}
            </span>
          </div>
          <div className="flex items-center gap-3 pt-0.5 text-[11px]">
            <span>
              <strong className="text-emerald-600">O</strong> Origin
            </span>
            <span>
              <strong className="text-purple-600">CP</strong> Checkpoints
            </span>
            <span>
              <strong className="text-rose-600">D</strong> Destination
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Live() {
  const initial = Route.useLoaderData();
  const [locations, setLocations] = useState<ActiveTripLocation[]>(initial.locations);
  const [error, setError] = useState<string | null>(initial.error);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshLocations = useCallback(async () => {
    setIsRefreshing(true);
    const fresh = await getActiveTripLocations();
    setLocations(fresh.locations);
    setError(fresh.error);
    setLastRefreshed(new Date());
    setIsRefreshing(false);
  }, []);

  // Realtime subscription to new GPS telemetry
  useEffect(() => {
    const channel = supabase
      .channel("admin-live-tracking")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trip_locations" },
        () => {
          refreshLocations();
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips" }, () => {
        refreshLocations();
      })
      .subscribe();

    // 15-second polling fallback
    const interval = setInterval(refreshLocations, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refreshLocations]);

  const filtered = search
    ? locations.filter(
        (l) =>
          l.tripCode.toLowerCase().includes(search.toLowerCase()) ||
          l.vehicleNumber.toLowerCase().includes(search.toLowerCase()) ||
          (l.driverName ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : locations;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Live Tracking" }]}
        title="Active Vehicle Live Tracking"
        subtitle="Real-time telemetry and route monitoring for in-transit grain consignments"
        right={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
              </span>
              <span>Live Telemetry</span>
              <span className="opacity-60">• {lastRefreshed.toLocaleTimeString("en-IN")}</span>
            </div>

            <button
              onClick={refreshLocations}
              disabled={isRefreshing}
              className="rounded-md border border-input bg-card p-2 text-muted-foreground hover:text-foreground"
              title="Refresh positions"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>

            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Trip ID, Vehicle No…"
                className="h-10 w-56 rounded-md border border-input bg-card px-3 text-sm"
              />
              <button
                aria-label="Clear search"
                type="button"
                onClick={() => setSearch("")}
                className="grid h-10 w-10 place-items-center rounded-md bg-info text-primary-foreground hover:bg-info/80"
                title="Clear search"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
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
            <LeafletMap locations={filtered} selectedId={selectedId} onSelect={setSelectedId} />
            {/* Active count badge */}
            <div className="absolute left-3 top-3 z-[1000] rounded-md bg-navy/90 px-3 py-1.5 text-sm font-medium text-white shadow-md">
              {filtered.length} active vehicle{filtered.length !== 1 ? "s" : ""} in transit
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-around gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-card">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-info" />
              First Mile (Blue)
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-warning" />
              Mid Mile (Amber)
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-success" />
              Last Mile (Green)
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-flex h-3 w-3 items-center justify-center rounded bg-green-600 text-[8px] font-bold text-white">
                O
              </span>
              Origin
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-flex h-3 w-3 items-center justify-center rounded bg-red-600 text-[8px] font-bold text-white">
                D
              </span>
              Destination
            </span>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card title={`In-Transit Fleet (${filtered.length})`}>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
                <Truck className="h-10 w-10 opacity-30" />
                <p className="text-sm font-medium">
                  No vehicles reporting GPS coordinates right now.
                </p>
                <p className="text-xs">
                  Location telemetry streams automatically from the driver mobile application during
                  active transport.
                </p>
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
