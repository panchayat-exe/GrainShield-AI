from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

OLD_LOGOUT_BTN = '''            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className="ml-2 grid h-9 w-9 place-items-center rounded-md border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <LogOut className="h-4 w-4" />
            </button>'''

NEW_LOGOUT_WITH_BELL = '''            {/* Notification Bell */}
            <div className="relative ml-2">
              <button
                onClick={() => { setShowNotifPanel((p) => !p); if (!showNotifPanel) setNotifCount(0); }}
                className="relative grid h-9 w-9 place-items-center rounded-md border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
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
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-card shadow-xl">
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
                          <span className="text-muted-foreground">
                            {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className="ml-1 grid h-9 w-9 place-items-center rounded-md border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <LogOut className="h-4 w-4" />
            </button>'''

if "Notification Bell" not in text:
    if OLD_LOGOUT_BTN in text:
        text = text.replace(OLD_LOGOUT_BTN, NEW_LOGOUT_WITH_BELL)
        print("✓ Injected notification bell before logout button")
    else:
        print("⚠ Exact logout button pattern not found")
        print(repr(text[5100:5500]))
else:
    print("✓ Bell already injected")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print(f"AdminShell.tsx written ({len(final)} bytes)")
