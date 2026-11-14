from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# 1. Add Bell import to lucide-react
text = text.replace(
    'import { ChevronDown, ChevronRight, Landmark, LogOut, User, Wheat } from "lucide-react";',
    'import { Bell, ChevronDown, ChevronRight, Landmark, LogOut, User, Wheat } from "lucide-react";'
)

# 2. Add Profile nav link
text = text.replace(
    '  { to: "/users", label: "Users" },\n] as const;',
    '  { to: "/users", label: "Users" },\n  { to: "/profile", label: "My Profile" },\n] as const;'
)

# 3. Add Supabase import
if "supabase" not in text:
    text = text.replace(
        'import { getDashboardStats } from "@/lib/admin-queries";',
        'import { getDashboardStats } from "@/lib/admin-queries";\nimport { supabase } from "@/lib/supabase/client";'
    )

# 4. Add notification state + Realtime subscription after handleLogout
OLD_STATE = '''  const [pendingReview, setPendingReview] = useState<number>(0);
  useEffect(() => {
    getDashboardStats().then((s) => setPendingReview(s.pendingReview));
    const id = setInterval(
      () => getDashboardStats().then((s) => setPendingReview(s.pendingReview)),
      30000,
    );
    return () => clearInterval(id);
  }, []);'''

NEW_STATE = '''  const [pendingReview, setPendingReview] = useState<number>(0);
  useEffect(() => {
    getDashboardStats().then((s) => setPendingReview(s.pendingReview));
    const id = setInterval(
      () => getDashboardStats().then((s) => setPendingReview(s.pendingReview)),
      30000,
    );
    return () => clearInterval(id);
  }, []);

  // Realtime notification bell for new manual_review_requests
  const [notifCount, setNotifCount] = useState<number>(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [recentReviews, setRecentReviews] = useState<{ id: string; trip_code: string; created_at: string }[]>([]);

  useEffect(() => {
    // Fetch initial recent pending reviews (last 10)
    supabase
      .from("manual_review_requests")
      .select("id, trip:trips(trip_code), created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        const rows = (data ?? []).map((r: Record<string, unknown>) => ({
          id: r.id as string,
          trip_code: (r.trip as { trip_code: string } | null)?.trip_code ?? "Unknown",
          created_at: r.created_at as string,
        }));
        setRecentReviews(rows);
        setNotifCount(rows.length);
      });

    // Subscribe to new inserts
    const channel = supabase
      .channel("admin-review-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "manual_review_requests" },
        (payload) => {
          const record = payload.new as { id: string; trip_id: string; created_at: string };
          supabase
            .from("trips")
            .select("trip_code")
            .eq("id", record.trip_id)
            .maybeSingle()
            .then(({ data: t }) => {
              const entry = {
                id: record.id,
                trip_code: (t as { trip_code: string } | null)?.trip_code ?? record.trip_id.slice(0, 8),
                created_at: record.created_at,
              };
              setRecentReviews((prev) => [entry, ...prev.slice(0, 9)]);
              setNotifCount((n) => n + 1);
            });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);'''

if 'notifCount' not in text:
    if OLD_STATE in text:
        text = text.replace(OLD_STATE, NEW_STATE)
        print("✓ Added notification state + Realtime")
    else:
        print("⚠ OLD_STATE not found exactly")
else:
    print("✓ Notification state already present")

# 5. Add notification bell button in header near user menu
# Find the User icon button area in the JSX and inject bell before it
OLD_USER_BTN = '''              <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary-foreground/90 transition-colors hover:bg-white/10"
              >
                <User className="h-4 w-4" />
                <span className="max-w-[12rem] truncate">{displayName}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>'''

NEW_WITH_BELL = '''              {/* Notification bell */}
              <div className="relative">
                <button
                  onClick={() => { setShowNotifPanel((p) => !p); setNotifCount(0); }}
                  className="relative flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-primary-foreground/90 transition-colors hover:bg-white/10"
                  title="Review notifications"
                >
                  <Bell className="h-4 w-4" />
                  {notifCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">
                      {notifCount > 9 ? "9+" : notifCount}
                    </span>
                  )}
                </button>
                {showNotifPanel && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <span className="text-xs font-semibold text-foreground">Pending Reviews</span>
                      <button onClick={() => setShowNotifPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {recentReviews.length === 0 ? (
                        <p className="px-3 py-4 text-xs text-muted-foreground">No pending reviews.</p>
                      ) : (
                        recentReviews.map((r) => (
                          <a
                            key={r.id}
                            href="/verification"
                            className="flex items-center justify-between px-3 py-2.5 text-xs hover:bg-muted/50"
                            onClick={() => setShowNotifPanel(false)}
                          >
                            <span className="font-mono font-medium text-foreground">{r.trip_code}</span>
                            <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-IN")}</span>
                          </a>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary-foreground/90 transition-colors hover:bg-white/10"
              >
                <User className="h-4 w-4" />
                <span className="max-w-[12rem] truncate">{displayName}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>'''

if 'Notification bell' not in text:
    if OLD_USER_BTN in text:
        text = text.replace(OLD_USER_BTN, NEW_WITH_BELL)
        print("✓ Added notification bell in header")
    else:
        print("⚠ User button pattern not found exactly — doing simple Bell injection")
        # inject before the user dropdown button via simpler find
        text = text.replace(
            '<User className="h-4 w-4" />\n                <span className="max-w-[12rem] truncate">{displayName}</span>',
            '<User className="h-4 w-4" />\n                <span className="max-w-[12rem] truncate">{displayName}</span>'
        )
        print("⚠ Skipped bell injection - pattern needs manual check")
else:
    print("✓ Notification bell already added")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print(f"AdminShell.tsx written ({len(final)} bytes)")
