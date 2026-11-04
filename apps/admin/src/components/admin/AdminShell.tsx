import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Landmark, LogOut, User, Wheat } from "lucide-react";
import { useState, useEffect, type ChangeEvent, type ReactNode } from "react";
import { adminSignOut, type AdminUser } from "@/lib/admin-auth";
import { getDashboardStats } from "@/lib/admin-queries";

const nav = [
  { to: "/", label: "Home" },
  { to: "/trips", label: "Trips", caret: true },
  { to: "/verification", label: "Verification" },
  { to: "/live-tracking", label: "Live Tracking" },
  { to: "/reports", label: "Reports" },
  { to: "/audit-logs", label: "Audit Logs" },
  { to: "/users", label: "Users" },
] as const;

export function AdminShell({
  children,
  adminUser,
}: {
  children: ReactNode;
  adminUser: AdminUser | null;
}) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));

  async function handleLogout() {
    await adminSignOut();
    navigate({ to: "/login" });
  }

  const [pendingReview, setPendingReview] = useState<number>(0);
  useEffect(() => {
    getDashboardStats().then((s) => setPendingReview(s.pendingReview));
    const id = setInterval(() => getDashboardStats().then((s) => setPendingReview(s.pendingReview)), 30000);
    return () => clearInterval(id);
  }, []);

  const displayName = adminUser?.full_name ?? adminUser?.email?.split("@")[0] ?? "Admin";
  const roleLabel =
    adminUser?.role === "super_admin"
      ? "Super Admin"
      : adminUser?.role === "officer"
        ? "Officer"
        : "Admin";

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to main content
      </a>
      <header className="bg-header text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            Government of Gujarat
          </div>
          <div className="hidden items-center gap-3 opacity-90 md:flex">
            <span className="flex items-center gap-1">
              English <ChevronDown className="h-3 w-3" />
            </span>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pb-4 pt-1">
          <Link to="/" className="flex items-center gap-3">
            <Wheat className="h-11 w-11 text-secondary" />
            <div>
              <div className="font-display text-2xl font-bold tracking-wide md:text-3xl">
                GRAINSHIELD <span className="text-secondary">AI</span>
              </div>
              <div className="text-sm opacity-90">AI-Powered Food Grain Transport Verification</div>
            </div>
          </Link>
          <div className="hidden items-center gap-3 sm:flex">
            <div className="grid h-11 w-11 place-items-center rounded-full border-2 border-primary-foreground/40 bg-primary-foreground/10">
              <User className="h-5 w-5" />
            </div>
            <div className="text-sm leading-tight">
              <div className="font-medium">{displayName}</div>
              <div className="text-secondary">{roleLabel}</div>
            </div>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className="ml-2 grid h-9 w-9 place-items-center rounded-md border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <nav className="bg-nav text-secondary-foreground shadow-card">
        <div className="mx-auto flex max-w-7xl overflow-x-auto px-2">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`flex shrink-0 items-center gap-1 px-4 py-3 text-[15px] font-medium transition-colors hover:bg-accent/60 ${
                isActive(n.to) ? "bg-accent font-semibold" : ""
              }`}
            >
              {n.label}
              {"caret" in n && <ChevronDown className="h-4 w-4" />}
              {n.to === "/verification" && pendingReview > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white">
                  {pendingReview > 99 ? "99+" : pendingReview}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © 2026 Food, Civil Supplies &amp; Consumer Affairs Department, Government of Gujarat
      </footer>
    </div>
  );
}

export function PageHeader({
  crumbs,
  title,
  subtitle,
  right,
}: {
  crumbs: { label: string; to?: string }[];
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link to="/" className="text-info hover:underline">
          Home
        </Link>
        {crumbs.map((c) => (
          <span key={c.label} className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            {c.to ? (
              <Link to={c.to} className="text-info hover:underline">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-navy">{title}</h1>
          {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card shadow-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "muted";
const tones: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  info: "bg-info-soft text-info",
  muted: "bg-muted text-muted-foreground",
};
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Select({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <select
      className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function SearchBox({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <input
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
      className="h-11 w-full rounded-md border border-input bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (rows.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-info-soft text-left text-navy">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        </table>
        <div className="py-12 text-center text-muted-foreground text-sm">No records found.</div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-info-soft text-left text-navy">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/60">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  last,
  onPageChange,
}: {
  page: number;
  last: number;
  onPageChange: (p: number) => void;
}) {
  if (last <= 1) return null;

  // Build compact page list: always show first, last, current ±1
  const pages = new Set<number>(
    [1, last, page, page - 1, page + 1].filter((p) => p >= 1 && p <= last),
  );
  const sorted = [...pages].sort((a, b) => a - b);

  return (
    <div className="mt-5 flex items-center justify-end gap-2 text-sm">
      <button
        className="px-2 text-muted-foreground disabled:opacity-40"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>
      {sorted.map((n, i) => {
        const prev = sorted[i - 1];
        return (
          <>
            {prev && n - prev > 1 && (
              <span key={`gap-${n}`} className="px-1 text-muted-foreground">
                …
              </span>
            )}
            <button
              key={n}
              onClick={() => onPageChange(n)}
              className={`h-9 w-9 rounded-md border ${
                n === page
                  ? "border-primary bg-primary text-primary-foreground font-semibold"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {n}
            </button>
          </>
        );
      })}
      <button
        className="px-2 disabled:opacity-40"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= last}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

export const btn = {
  primary:
    "inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90",
  outline:
    "inline-flex items-center gap-2 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-info hover:bg-muted",
  review:
    "rounded-md bg-warning-soft px-4 py-1.5 text-sm font-medium text-warning hover:bg-secondary/40",
};
