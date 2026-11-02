import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  Search,
  Loader2,
  AlertTriangle,
  Navigation,
  NavigationOff,
  CheckCircle2,
} from "lucide-react";
import { AppShell, Card, Row } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useGpsTracking } from "@/hooks/use-gps-tracking";
import { getLatestLocation, getEvidenceForTrip, subscribeToLocations } from "@/lib/services";
import { getSignedUrl } from "@/lib/services/evidence";
import { formatTimestamp } from "@/lib/services/audit";
import type { Trip, TripLocation, TripEvidence } from "@/lib/supabase/types";
import { supabase } from "@/lib/supabase/client";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";

export const Route = createFileRoute("/tracking")({
  head: () => ({
    meta: [
      { title: "Trip Live Tracking | GrainShield AI" },
      {
        name: "description",
        content: "Track food grain transport trips live on the map.",
      },
    ],
  }),
  component: Tracking,
});

// Gujarat center
const GUJARAT_CENTER: [number, number] = [22.309, 72.136];

interface LeafletMapWrapper {
  map: L.Map;
  L: typeof L;
  vehicleMarker?: L.Marker | null;
}

/** Real Leaflet map showing trip origin → vehicle location → destination */
function TripMap({ trip, location }: { trip: Trip | null; location: TripLocation | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMapWrapper | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, {
        center: GUJARAT_CENTER,
        zoom: 7,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = { map, L };
    });

    return () => {
      mapInstanceRef.current?.map?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update marker when location changes
  useEffect(() => {
    if (!mapInstanceRef.current || !location) return;
    const { map, L } = mapInstanceRef.current;

    // Remove previous vehicle marker
    if (mapInstanceRef.current.vehicleMarker) {
      mapInstanceRef.current.vehicleMarker.remove();
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.33 14 22 14 22S28 23.33 28 14C28 6.27 21.73 0 14 0z" fill="#3b82f6" stroke="white" stroke-width="2"/>
      <circle cx="14" cy="14" r="6" fill="white"/>
    </svg>`;

    const icon = L.divIcon({ html: svg, iconSize: [28, 36], iconAnchor: [14, 36], className: "" });
    const marker = L.marker([location.latitude, location.longitude], { icon })
      .addTo(map)
      .bindPopup(`<b>${trip?.trip_code ?? "Vehicle"}</b><br/>${trip?.vehicle_number ?? ""}`);

    mapInstanceRef.current.vehicleMarker = marker;
    map.setView([location.latitude, location.longitude], 12, { animate: true });
  }, [location, trip]);

  // Reset to Gujarat center when no trip
  useEffect(() => {
    if (!mapInstanceRef.current || trip) return;
    const { map } = mapInstanceRef.current;
    if (mapInstanceRef.current.vehicleMarker) {
      mapInstanceRef.current.vehicleMarker.remove();
      mapInstanceRef.current.vehicleMarker = null;
    }
    map.setView(GUJARAT_CENTER, 7, { animate: true });
  }, [trip]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border">
      <div ref={mapRef} style={{ height: "320px", width: "100%" }} />
      {!trip && (
        <div className="absolute inset-0 flex items-center justify-center bg-foreground/5 pointer-events-none">
          <p className="rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground shadow">
            Search for a trip to see its location
          </p>
        </div>
      )}
    </div>
  );
}

function Tracking() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [latestLocation, setLatestLocation] = useState<TripLocation | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // GPS tracking for the current field user
  const { tracking, gpsStatus, lastError, startTracking, stopTracking } = useGpsTracking(
    trip?.id ?? null,
    user?.id ?? null,
  );

  async function handleSearch() {
    if (!search.trim() || !user) return;
    setLoading(true);
    setNotFound(false);
    setTrip(null);
    setLatestLocation(null);
    setEvidence(null);
    setPhotoUrl(null);
    setSearched(true);

    // Clean up previous subscription
    unsubRef.current?.();
    unsubRef.current = null;

    const { data } = await supabase
      .from("trips")
      .select("*")
      .ilike("trip_code", search.trim().toUpperCase())
      .maybeSingle();

    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const t = data as Trip;
    setTrip(t);

    const [loc, evArr] = await Promise.all([getLatestLocation(t.id), getEvidenceForTrip(t.id)]);
    setLatestLocation(loc);
    const ev = evArr[0] ?? null;
    setEvidence(ev);
    if (ev?.storage_path) {
      const url = await getSignedUrl(ev.storage_path);
      setPhotoUrl(url);
    }

    // Subscribe to live location updates
    unsubRef.current = subscribeToLocations(t.id, (newLoc) => {
      setLatestLocation(newLoc);
    });

    setLoading(false);
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.();
      stopTracking();
    };
  }, [stopTracking]);

  const tripStatus =
    trip?.status === "pass" || trip?.status === "completed" ? "Completed" : "On Route";

  // Determine GPS status badge
  const gpsLabel: Record<typeof gpsStatus, string> = {
    idle: "GPS Off",
    requesting: "Requesting…",
    active: "Sharing Live",
    paused: "Paused",
    error_permission: "Permission Denied",
    error_unavailable: "GPS Unavailable",
  };

  const gpsColor: Record<typeof gpsStatus, string> = {
    idle: "text-muted-foreground",
    requesting: "text-info",
    active: "text-success",
    paused: "text-warning",
    error_permission: "text-danger",
    error_unavailable: "text-danger",
  };

  return (
    <AppShell crumbs={["Home", "Live Tracking"]} title="Trip Live Tracking">
      {!user && (
        <div className="rounded-2xl border border-info/30 bg-info-soft p-4 text-center text-sm">
          Please sign in to track trips.
        </div>
      )}

      {user && (
        <>
          {/* Search bar */}
          <div className="flex gap-2">
            <input
              placeholder="Trip ID, Vehicle No…"
              className="h-11 flex-1 rounded-xl border border-input bg-card px-3 text-sm outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSearch();
              }}
            />
            <button
              aria-label="Search"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-info text-maroon-foreground"
              onClick={() => void handleSearch()}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>
          </div>

          {searched && notFound && (
            <div className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />
              Trip not found. Check the Trip ID and try again.
            </div>
          )}
        </>
      )}

      {/* Real Leaflet Map */}
      <TripMap trip={trip} location={latestLocation} />

      {trip ? (
        <>
          {/* GPS Share Location Panel */}
          <Card title="Share My Location">
            <p className="mb-3 text-xs text-muted-foreground">
              Field officers can share their live GPS position for this trip. Location is pushed
              every 30 seconds while active.
            </p>

            {/* Status badge */}
            <div
              className={`mb-3 flex items-center gap-2 text-sm font-medium ${gpsColor[gpsStatus]}`}
            >
              {gpsStatus === "active" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : gpsStatus === "requesting" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
              {gpsLabel[gpsStatus]}
            </div>

            {lastError && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {lastError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={startTracking}
                disabled={
                  tracking || gpsStatus === "requesting" || gpsStatus === "error_permission"
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-success text-sm font-medium text-maroon-foreground disabled:opacity-50"
              >
                <Navigation className="h-4 w-4" />
                Start Sharing
              </button>
              <button
                onClick={stopTracking}
                disabled={!tracking && gpsStatus !== "requesting"}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground disabled:opacity-50"
              >
                <NavigationOff className="h-4 w-4" />
                Stop
              </button>
            </div>
          </Card>

          {/* Trip Details */}
          <Card
            title={
              <span className="flex items-center justify-between">
                Trip Details
                <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs text-success">
                  ● {tripStatus}
                </span>
              </span>
            }
          >
            <Row label="Trip ID" value={trip.trip_code} />
            <Row label="Vehicle No." value={trip.vehicle_number} />
            {trip.driver_name && <Row label="Driver" value={trip.driver_name} />}
            <Row
              label="Current Location"
              value={
                latestLocation
                  ? `${latestLocation.latitude.toFixed(5)}, ${latestLocation.longitude.toFixed(5)}`
                  : "No location data available"
              }
            />
            {latestLocation && (
              <>
                <Row label="Last Updated" value={formatTimestamp(latestLocation.recorded_at)} />
                {latestLocation.accuracy_meters !== null && (
                  <Row
                    label="GPS Accuracy"
                    value={`±${Math.round(latestLocation.accuracy_meters ?? 0)}m`}
                  />
                )}
                <Row label="Source" value={latestLocation.source} />
              </>
            )}
          </Card>

          {/* Live Feed */}
          {evidence && photoUrl && (
            <Card title="Live Feed">
              <div className="flex gap-3">
                <img
                  src={photoUrl}
                  alt="Feed photo"
                  loading="lazy"
                  width={1024}
                  height={768}
                  className="h-20 w-28 rounded-lg object-cover"
                />
                <p className="text-sm">
                  Photo uploaded at {trip.origin ?? "origin"}
                  <br />
                  <span className="text-muted-foreground">
                    {formatTimestamp(evidence.uploaded_at)}
                  </span>
                </p>
              </div>
            </Card>
          )}

          {/* No location data */}
          {!latestLocation && (
            <div className="flex items-center gap-2 rounded-xl border border-saffron/50 bg-warning-soft p-3 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              No live location data yet. Tap &quot;Start Sharing&quot; above to share your GPS
              position, or wait for location updates from the field device.
            </div>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
