import { Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type ReactNode } from "react";
import {
  Landmark,
  Menu,
  Wheat,
  UserCircle2,
  X,
  ChevronRight,
  LogOut,
  Loader2,
  AlertTriangle,
  Bell,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-notifications";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getLang, setLang, langToggleLabel, type Lang } from "@/lib/i18n";

const nav = [
  { to: "/", label: "Submit Trip" },
  { to: "/my-trips", label: "My Trips" },
  { to: "/profile", label: "My Profile" },
  { to: "/help", label: "Help & FAQ" },
  { to: "/processing", label: "Verification" },
  { to: "/result", label: "Result (Pass)" },
  { to: "/failed", label: "Result (Failed)" },
  { to: "/trip", label: "Trip Details" },
  { to: "/tracking", label: "Live Tracking" },
] as const;

export function AppShell({
  crumbs,
  title,
  subtitle,
  children,
}: {
  crumbs: string[];
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  // Start with "en" on both SSR and client; sync to localStorage after hydration
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = getLang();
    setLangState(stored);
  }, []);

  function handleLangToggle() {
    const next: Lang = lang === "en" ? "gu" : "en";
    setLang(next);
    setLangState(next);
  }
  const { user, profile, loading, signOut } = useAuth();
  const { notifications, unreadCount, markAllRead, dismiss } = useNotifications(user?.id ?? null);
  const navigate = useNavigate();

  const displayName = profile?.full_name ?? user?.email?.split("@")[0] ?? "Officer";
  const displayDistrict = profile?.district ? `District - ${profile.district}` : "GrainShield AI";

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    void navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Supabase configuration warning */}
      {!isSupabaseConfigured() && (
        <div className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
          .env.
        </div>
      )}

      <header className="sticky top-0 z-30 bg-header text-maroon-foreground shadow-md">
        <div className="flex items-center justify-between px-4 py-1.5 text-[11px] opacity-90">
          <span className="flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5" />
            Government of Gujarat
          </span>
          <button
            onClick={handleLangToggle}
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold opacity-90 hover:bg-white/20 transition-colors"
            title="Switch language / ભાષા બદલો"
          >
            {langToggleLabel()}
          </button>
        </div>
        <div className="flex items-center gap-3 px-4 pb-3">
          <Wheat className="h-8 w-8 text-saffron" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-none tracking-tight">
              GRAINSHIELD <span className="text-saffron">AI</span>
            </p>
            <p className="truncate text-[11px] opacity-80">
              AI-Powered Food Grain Transport Verification
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            {user && (
              <button
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                onClick={() => {
                  setShowNotifs((v) => !v);
                  if (!showNotifs) markAllRead();
                }}
                className="relative rounded-lg p-2 text-maroon-foreground hover:bg-saffron/20"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            )}
            <button
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="rounded-lg bg-saffron p-2 text-saffron-foreground"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 bg-foreground/40" onClick={() => setOpen(false)}>
          <aside
            className="ml-auto flex h-full w-72 flex-col bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* User section */}
            <div className="flex items-center gap-3 bg-header p-4 text-maroon-foreground">
              {loading ? (
                <Loader2 className="h-10 w-10 animate-spin opacity-60" />
              ) : (
                <UserCircle2 className="h-10 w-10" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{loading ? "Loading…" : displayName}</p>
                <p className="truncate text-xs opacity-80">{loading ? "" : displayDistrict}</p>
              </div>
              <button aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col p-2">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-foreground"
                  activeProps={{ className: "bg-saffron/25 text-maroon" }}
                  activeOptions={{ exact: true }}
                >
                  {n.label}
                </Link>
              ))}
            </nav>

            {/* Auth actions */}
            <div className="mt-auto border-t border-border p-4">
              {user ? (
                <button
                  onClick={() => {
                    void handleSignOut();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-danger hover:bg-danger-soft"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-saffron py-2.5 text-sm font-semibold text-saffron-foreground"
                >
                  Sign In
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Notification dropdown panel */}
      {showNotifs && user && (
        <div className="fixed inset-0 z-30" onClick={() => setShowNotifs(false)}>
          <div
            className="absolute right-4 top-[88px] z-40 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              <button
                onClick={() => setShowNotifs(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-md px-4 pt-4">
        <div className="flex flex-wrap items-center gap-1 text-xs text-info">
          {crumbs.map((c, i) => (
            <span key={c} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className={i === crumbs.length - 1 ? "text-foreground" : ""}>{c}</span>
            </span>
          ))}
        </div>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-4 space-y-4">{children}</div>
      </main>

      {/* Global toast container for push notifications */}
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "success" | "danger" | "warning";
}) {
  const c =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${c}`}>{value}</span>
    </div>
  );
}

export const btn = {
  maroon:
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-maroon font-medium text-maroon-foreground",
  saffron:
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-saffron font-semibold text-saffron-foreground",
  success:
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-success font-medium text-maroon-foreground",
  danger:
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-danger font-medium text-maroon-foreground",
  outline:
    "flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card font-medium text-info",
};
