import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Plus, X, Truck, Calendar, MapPin, User, Phone } from "lucide-react";
import {
  Badge,
  DataTable,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  btn,
} from "@/components/admin/AdminShell";
import {
  getTrips,
  createAdminTrip,
  getDriverProfiles,
  type DriverProfile,
} from "@/lib/admin-queries";
import type { TripStatus, TripStage } from "@/lib/supabase";
import { getAdminSession, type AdminUser } from "@/lib/admin-auth";

export const Route = createFileRoute("/trips")({
  head: () => ({
    meta: [
      { title: "Trips — GrainShield AI" },
      { name: "description", content: "All food grain transport trips with stage and status." },
      { property: "og:title", content: "Trips — GrainShield AI" },
      {
        property: "og:description",
        content: "All food grain transport trips with stage and status.",
      },
    ],
  }),
  loader: async () => {
    const [tripsResult, session] = await Promise.all([
      getTrips({ pageSize: 20, page: 1 }),
      getAdminSession(),
    ]);
    return { ...tripsResult, adminUser: session };
  },
  component: Trips,
});

const tone = (s: TripStatus) =>
  (s === "pass" || s === "completed"
    ? "success"
    : s === "rejected"
      ? "danger"
      : s === "manual_review" || s === "retake"
        ? "warning"
        : "info") as "success";

const stageLabel: Record<string, string> = {
  first_mile: "First Mile",
  mid_mile: "Middle Mile",
  last_mile: "Last Mile",
};

const statusLabel: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  processing: "Processing",
  pass: "Pass",
  retake: "Retake",
  manual_review: "Review",
  rejected: "Rejected",
  completed: "Completed",
};

const STAGE_OPTIONS = ["All Stages", "First Mile", "Middle Mile", "Last Mile"];
const STATUS_OPTIONS = [
  "All Status",
  "Submitted",
  "Processing",
  "Pass",
  "Retake",
  "Review",
  "Rejected",
  "Completed",
];
const GUJARAT_DISTRICTS = [
  "Ahmedabad",
  "Gandhinagar",
  "Vadodara",
  "Surat",
  "Rajkot",
  "Bhavnagar",
  "Jamnagar",
  "Mehsana",
  "Patan",
  "Junagadh",
];

const stageMap: Record<string, TripStage | ""> = {
  "All Stages": "",
  "First Mile": "first_mile",
  "Middle Mile": "mid_mile",
  "Last Mile": "last_mile",
};
const statusMap: Record<string, TripStatus | ""> = {
  "All Status": "",
  Submitted: "submitted",
  Processing: "processing",
  Pass: "pass",
  Retake: "retake",
  Review: "manual_review",
  Rejected: "rejected",
  Completed: "completed",
};

const PAGE_SIZE = 20;

function Trips() {
  const loaderData = Route.useLoaderData();

  const [trips, setTrips] = useState(loaderData.trips);
  const [total, setTotal] = useState(loaderData.total);
  const [error, setError] = useState(loaderData.error);
  const [loading, setLoading] = useState(false);
  const adminUser = loaderData.adminUser;

  const [stageOpt, setStageOpt] = useState("All Stages");
  const [statusOpt, setStatusOpt] = useState("All Status");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Create Trip Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [createVehicle, setCreateVehicle] = useState("GJ");
  const [createDriver, setCreateDriver] = useState("");
  const [createDriverId, setCreateDriverId] = useState<string>("");
  const [driverProfiles, setDriverProfiles] = useState<DriverProfile[]>([]);
  const [driverSearch, setDriverSearch] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createStage, setCreateStage] = useState<TripStage>("first_mile");
  const [createOrigin, setCreateOrigin] = useState("Ahmedabad FCI Godown");
  const [createDest, setCreateDest] = useState("Gandhinagar FPS-01");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchTrips = useCallback(
    async (p: number, s: string, st: string, q: string, from: string, to: string) => {
      setLoading(true);
      const res = await getTrips({
        page: p,
        pageSize: PAGE_SIZE,
        stage: stageMap[s] ?? "",
        status: statusMap[st] ?? "",
        search: q,
        dateFrom: from,
        dateTo: to,
      });
      setTrips(res.trips);
      setTotal(res.total);
      setError(res.error);
      setLoading(false);
    },
    [],
  );

  // Load driver profiles when modal opens
  useEffect(() => {
    if (!showCreateModal) return;
    void getDriverProfiles(driverSearch).then(({ profiles }) => setDriverProfiles(profiles));
  }, [showCreateModal, driverSearch]);

  // Re-fetch whenever filter/search/page changes (debounce search by 300ms)
  useEffect(() => {
    const id = setTimeout(
      () => fetchTrips(page, stageOpt, statusOpt, search, dateFrom, dateTo),
      search ? 300 : 0,
    );
    return () => clearTimeout(id);
  }, [page, stageOpt, statusOpt, search, dateFrom, dateTo, fetchTrips]);

  function handleStage(v: string) {
    setStageOpt(v);
    setPage(1);
  }
  function handleStatus(v: string) {
    setStatusOpt(v);
    setPage(1);
  }
  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  async function handleCreateTrip(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateLoading(true);

    const cleanPlate = createVehicle.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{1,4}$/.test(cleanPlate)) {
      setCreateError("Invalid vehicle registration format (e.g., GJ01AB1234)");
      setCreateLoading(false);
      return;
    }

    if (!adminUser?.id) {
      setCreateError("Authentication session expired. Please sign in again.");
      setCreateLoading(false);
      return;
    }

    const { trip, error: err } = await createAdminTrip({
      trip_code: createCode.trim() || undefined,
      vehicle_number: cleanPlate,
      driver_id: createDriverId || undefined,
      driver_name: createDriver.trim() || undefined,
      driver_phone: createPhone.trim() || undefined,
      stage: createStage,
      origin: createOrigin.trim() || undefined,
      destination: createDest.trim() || undefined,
    });

    if (err || !trip) {
      setCreateError(err ?? "Failed to create transport trip");
      setCreateLoading(false);
      return;
    }

    setShowCreateModal(false);
    setCreateLoading(false);
    setCreateCode("");
    setCreateDriverId("");
    setDriverSearch("");
    setCreateVehicle("GJ");
    setCreateDriver("");
    setCreatePhone("");
    await fetchTrips(1, stageOpt, statusOpt, search, dateFrom, dateTo);
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Trips" }]}
        title="All Trips"
        subtitle={`${total} grain movement${total !== 1 ? "s" : ""} across the district`}
        right={
          <button
            onClick={() => {
              setShowCreateModal(true);
              getDriverProfiles("").then(({ profiles }) => setDriverProfiles(profiles ?? []));
            }}
            className={btn.primary}
          >
            <Plus className="h-4 w-4" />
            Create Trip
          </button>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Select options={STAGE_OPTIONS} value={stageOpt} onChange={handleStage} />
        <Select options={STATUS_OPTIONS} value={statusOpt} onChange={handleStatus} />
        <div className="md:col-span-2">
          <SearchBox
            placeholder="Search Trip ID / Vehicle No."
            value={search}
            onChange={handleSearch}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground flex items-center gap-1">
          <Calendar className="h-4 w-4" /> Date Filter:
        </span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-card px-2.5 text-xs"
          placeholder="From"
        />
        <span className="text-muted-foreground">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-card px-2.5 text-xs"
          placeholder="To"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setPage(1);
            }}
            className="text-xs text-info hover:underline"
          >
            Clear dates
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <div className="mb-3 text-sm text-muted-foreground">Loading…</div>}
      <DataTable
        head={["Trip ID", "Vehicle No.", "Driver", "Stage", "Route", "Status", "Action"]}
        rows={trips.map((t) => [
          <b>{t.trip_code}</b>,
          t.vehicle_number,
          t.driver_name ?? "—",
          stageLabel[t.stage] ?? t.stage,
          `${t.origin ?? "?"} → ${t.destination ?? "?"}`,
          <Badge tone={tone(t.status as TripStatus)}>{statusLabel[t.status] ?? t.status}</Badge>,
          <Link
            to="/verification/$tripId"
            params={{ tripId: t.id }}
            className="text-info hover:underline font-medium"
          >
            View Details
          </Link>,
        ])}
      />
      <Pagination
        page={page}
        last={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
      />

      {/* Create Trip Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold text-navy">Create Transport Movement</h2>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTrip} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground">Trip Code</label>
                  <input
                    type="text"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value)}
                    placeholder="Auto-generated (GS-YYYY-NNNNNN)"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Leave blank to auto-generate a unique trip code.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">
                    Vehicle Number (RC)
                  </label>
                  <input
                    type="text"
                    required
                    value={createVehicle}
                    onChange={(e) => setCreateVehicle(e.target.value.toUpperCase())}
                    placeholder="GJ01AB1234"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground">
                    Driver (Registered Profile)
                  </label>
                  <input
                    type="text"
                    value={driverSearch}
                    onChange={(e) => {
                      setDriverSearch(e.target.value);
                      getDriverProfiles(e.target.value).then(({ profiles }) =>
                        setDriverProfiles(profiles ?? []),
                      );
                    }}
                    placeholder="Search driver by name or email…"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  {driverProfiles.length > 0 && (
                    <select
                      value={createDriverId}
                      onChange={(e) => {
                        const p = driverProfiles.find((d) => d.id === e.target.value);
                        setCreateDriverId(e.target.value);
                        if (p) setCreateDriver(p.full_name ?? p.email ?? "");
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Select registered driver —</option>
                      {driverProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name ?? "Unknown"} ({p.email})
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Or enter name manually below if driver is unregistered.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">
                    Driver Name (Manual Fallback)
                  </label>
                  <input
                    type="text"
                    value={createDriver}
                    onChange={(e) => setCreateDriver(e.target.value)}
                    placeholder="Ramesh Patel"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">Driver Phone</label>
                  <input
                    type="tel"
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value)}
                    placeholder="+91 9876543210"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground">Logistics Stage</label>
                <select
                  value={createStage}
                  onChange={(e) => setCreateStage(e.target.value as TripStage)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="first_mile">First Mile (Mandi / Farm → Storage Godown)</option>
                  <option value="mid_mile">Middle Mile (Inter-District Buffer Transfer)</option>
                  <option value="last_mile">Last Mile (Godown → Fair Price Shop)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground">Origin</label>
                  <input
                    type="text"
                    value={createOrigin}
                    onChange={(e) => setCreateOrigin(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">Destination</label>
                  <input
                    type="text"
                    value={createDest}
                    onChange={(e) => setCreateDest(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>

              {createError && (
                <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-md border border-input px-4 py-2 text-sm text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {createLoading ? "Creating…" : "Register Trip"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
