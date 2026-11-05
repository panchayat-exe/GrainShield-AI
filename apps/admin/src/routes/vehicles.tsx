import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { Badge, DataTable, PageHeader, btn } from "@/components/admin/AdminShell";
import { getVehicles, upsertVehicle, toggleVehicleActive, type Vehicle } from "@/lib/admin-queries";
import { getAdminSession, type AdminUser } from "@/lib/admin-auth";

export const Route = createFileRoute("/vehicles")({
  loader: async () => {
    const adminUser = await getAdminSession();
    return { adminUser };
  },
  head: () => ({
    meta: [
      { title: "Vehicle Registry | GrainShield AI Admin" },
      {
        name: "description",
        content: "Register, manage and audit vehicles in the GrainShield logistics network.",
      },
    ],
  }),
  component: VehiclesPage,
});

type VehicleType = Vehicle["vehicle_type"];

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  truck: "Truck",
  mini_truck: "Mini Truck",
  tempo: "Tempo",
  tractor: "Tractor",
  other: "Other",
};

function expiryClass(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return "text-red-600 font-semibold";
  if (diff < 30) return "text-amber-600 font-semibold";
  return "";
}

function expiryLabel(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const formatted = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  if (diff < 0) return `${formatted} \u26a0 Expired`;
  if (diff < 30) return `${formatted} \u26a0 Soon`;
  return formatted;
}

const EMPTY_FORM: Omit<Vehicle, "id" | "created_at" | "updated_at"> = {
  vehicle_number: "",
  vehicle_type: "truck",
  capacity_tonnes: null,
  owner_name: null,
  owner_phone: null,
  registration_expiry: null,
  insurance_expiry: null,
  fitness_expiry: null,
  is_active: true,
  notes: null,
  organization_id: null,
};

function VehicleModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Omit<Vehicle, "id" | "created_at" | "updated_at"> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Omit<Vehicle, "id" | "created_at" | "updated_at">>(
    initial ?? EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const vn = form.vehicle_number.trim().toUpperCase();
    if (!vn) {
      setError("Vehicle number is required.");
      return;
    }
    if (!/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(vn)) {
      setError("Format: GJ01AB1234 (2-letter state + 2 digits + 1-2 letters + 4 digits).");
      return;
    }
    setSaving(true);
    const { error: err } = await upsertVehicle({ ...form, vehicle_number: vn });
    setSaving(false);
    if (err) {
      setError(err);
    } else {
      onSaved();
      onClose();
    }
  }

  const inputCls =
    "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  const labelCls = "block text-xs font-semibold text-navy mb-1 mt-3 first:mt-0";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-navy">
            {initial?.vehicle_number ? "Edit Vehicle" : "Register Vehicle"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-muted text-muted-foreground"
          >
            \u2715
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-x-4">
            <div className="col-span-2">
              <label className={labelCls}>
                Vehicle Number <span className="text-destructive">*</span>
              </label>
              <input
                className={inputCls}
                value={form.vehicle_number}
                onChange={(e) => set("vehicle_number", e.target.value.toUpperCase())}
                placeholder="GJ01AB1234"
                required
              />
            </div>

            <div>
              <label className={labelCls}>Vehicle Type</label>
              <select
                className={inputCls}
                value={form.vehicle_type}
                onChange={(e) => set("vehicle_type", e.target.value as VehicleType)}
              >
                {(Object.entries(VEHICLE_TYPE_LABELS) as [VehicleType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Capacity (Tonnes)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className={inputCls}
                value={form.capacity_tonnes ?? ""}
                onChange={(e) =>
                  set("capacity_tonnes", e.target.value ? Number(e.target.value) : null)
                }
                placeholder="e.g. 10"
              />
            </div>

            <div>
              <label className={labelCls}>Owner Name</label>
              <input
                className={inputCls}
                value={form.owner_name ?? ""}
                onChange={(e) => set("owner_name", e.target.value || null)}
                placeholder="Ramesh Patel"
              />
            </div>

            <div>
              <label className={labelCls}>Owner Phone</label>
              <input
                className={inputCls}
                value={form.owner_phone ?? ""}
                onChange={(e) => set("owner_phone", e.target.value || null)}
                placeholder="+91 98765 43210"
              />
            </div>

            <div>
              <label className={labelCls}>Registration Expiry</label>
              <input
                type="date"
                className={inputCls}
                value={form.registration_expiry ?? ""}
                onChange={(e) => set("registration_expiry", e.target.value || null)}
              />
            </div>

            <div>
              <label className={labelCls}>Insurance Expiry</label>
              <input
                type="date"
                className={inputCls}
                value={form.insurance_expiry ?? ""}
                onChange={(e) => set("insurance_expiry", e.target.value || null)}
              />
            </div>

            <div>
              <label className={labelCls}>Fitness Expiry</label>
              <input
                type="date"
                className={inputCls}
                value={form.fitness_expiry ?? ""}
                onChange={(e) => set("fitness_expiry", e.target.value || null)}
              />
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select
                className={inputCls}
                value={form.is_active ? "active" : "inactive"}
                onChange={(e) => set("is_active", e.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea
                className={inputCls + " h-20 resize-none"}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || null)}
                placeholder="Optional notes..."
              />
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg bg-danger-soft border border-danger/30 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className={btn.outline}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={btn.primary}>
              {saving ? "Saving\u2026" : "Save Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VehiclesPage() {
  const { adminUser } = Route.useLoaderData() as {
    adminUser: AdminUser | null;
  };
  void adminUser;

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [modalOpen, setModalOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Omit<
    Vehicle,
    "id" | "created_at" | "updated_at"
  > | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { vehicles: v, total: t } = await getVehicles({
      page,
      pageSize,
      search,
    });
    setVehicles(v);
    setTotal(t);
    setLoading(false);
  }, [page, pageSize, search]);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  async function handleToggleActive(v: Vehicle) {
    setToggling(v.id);
    await toggleVehicleActive(v.id, !v.is_active);
    setToggling(null);
    load();
  }

  function openCreate() {
    setEditVehicle(null);
    setModalOpen(true);
  }

  function openEdit(v: Vehicle) {
    setEditVehicle({
      vehicle_number: v.vehicle_number,
      vehicle_type: v.vehicle_type,
      capacity_tonnes: v.capacity_tonnes,
      owner_name: v.owner_name,
      owner_phone: v.owner_phone,
      registration_expiry: v.registration_expiry,
      insurance_expiry: v.insurance_expiry,
      fitness_expiry: v.fitness_expiry,
      is_active: v.is_active,
      notes: v.notes,
      organization_id: v.organization_id,
    });
    setModalOpen(true);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const TABLE_HEAD = [
    "Vehicle No.",
    "Type",
    "Capacity",
    "Owner",
    "Reg. Expiry",
    "Insurance",
    "Fitness",
    "Status",
    "Actions",
  ];

  const rows = vehicles.map((v) => [
    <span key="vn" className="font-mono font-semibold text-navy text-sm">
      {v.vehicle_number}
    </span>,
    <Badge key="type" tone="info">
      {VEHICLE_TYPE_LABELS[v.vehicle_type]}
    </Badge>,
    <span key="cap">{v.capacity_tonnes != null ? `${v.capacity_tonnes}T` : "\u2014"}</span>,
    <div key="owner">
      <div className="text-sm">{v.owner_name ?? "\u2014"}</div>
      {v.owner_phone && <div className="text-xs text-muted-foreground">{v.owner_phone}</div>}
    </div>,
    <span key="reg" className={`text-sm ${expiryClass(v.registration_expiry)}`}>
      {expiryLabel(v.registration_expiry)}
    </span>,
    <span key="ins" className={`text-sm ${expiryClass(v.insurance_expiry)}`}>
      {expiryLabel(v.insurance_expiry)}
    </span>,
    <span key="fit" className={`text-sm ${expiryClass(v.fitness_expiry)}`}>
      {expiryLabel(v.fitness_expiry)}
    </span>,
    v.is_active ? (
      <Badge key="status" tone="success">
        Active
      </Badge>
    ) : (
      <Badge key="status" tone="danger">
        Inactive
      </Badge>
    ),
    <div key="actions" className="flex items-center gap-3">
      <button
        onClick={() => openEdit(v)}
        className="text-xs font-semibold text-info hover:underline"
      >
        Edit
      </button>
      <button
        onClick={() => handleToggleActive(v)}
        disabled={toggling === v.id}
        className={
          v.is_active
            ? "text-xs font-semibold text-warning hover:underline disabled:opacity-50"
            : "text-xs font-semibold text-success hover:underline disabled:opacity-50"
        }
      >
        {toggling === v.id ? "\u2026" : v.is_active ? "Deactivate" : "Activate"}
      </button>
    </div>,
  ]);

  return (
    <div className="p-4 md:p-8 max-w-screen-xl mx-auto">
      <PageHeader
        crumbs={[{ label: "Vehicle Registry" }]}
        title="Vehicle Registry"
        subtitle={`${total} vehicle${total === 1 ? "" : "s"} registered`}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search vehicle number\u2026"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-11 w-full max-w-xs rounded-md border border-input bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button onClick={openCreate} className={btn.primary}>
          + Register Vehicle
        </button>
      </div>

      {/* Expiry legend */}
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground bg-muted/40 rounded-lg px-4 py-2">
        <span>
          <span className="text-destructive font-semibold">Red</span> = Expired
        </span>
        <span>
          <span className="text-warning font-semibold">Amber</span> = Expiring within 30 days
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Loading vehicles\u2026
        </div>
      ) : (
        <DataTable head={TABLE_HEAD} rows={rows} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className={btn.outline}
            >
              \u2190 Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className={btn.outline}
            >
              Next \u2192
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <VehicleModal initial={editVehicle} onClose={() => setModalOpen(false)} onSaved={load} />
      )}
    </div>
  );
}
