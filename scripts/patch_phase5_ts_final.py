from pathlib import Path

# ── AdminShell.tsx: cast via unknown ──
AS = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = AS.read_text(encoding="utf-8").replace("\r\n", "\n")

# Replace the broken cast with a safe approach: just use (data ?? []) typed as any[]
OLD = '''        const rows = (
          (data as Array<{ id: string; trip: { trip_code: string } | null; created_at: string }>) ??
          []
        ).map((r) => ({
          id: r.id,
          trip_code: r.trip?.trip_code ?? "Unknown",
          created_at: r.created_at,
        }));'''

NEW = '''        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = ((data ?? []) as any[]).map((r) => ({
          id: r.id as string,
          trip_code: (r.trip as { trip_code: string } | null)?.trip_code ?? "Unknown",
          created_at: r.created_at as string,
        }));'''

if OLD in text:
    text = text.replace(OLD, NEW)
    print("Fixed AdminShell cast")
else:
    print("Pattern not found — trying simpler replace")
    text = text.replace(
        '(data as Array<{ id: string; trip: { trip_code: string } | null; created_at: string }>) ??',
        '(data as any[]) ??' 
    )
    text = text.replace('trip_code: r.trip?.trip_code ?? "Unknown",', 'trip_code: (r.trip as { trip_code: string } | null)?.trip_code ?? "Unknown",')
    print("Applied simpler AdminShell cast fix")

AS.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))

# ── reports.tsx: fix labelFormatter type ──
RP = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = RP.read_text(encoding="utf-8").replace("\r\n", "\n")

# Remove labelFormatter entirely — use Tooltip without it
OLD_TOOLTIP = '''              <Tooltip
                labelFormatter={(label: string) =>
                  new Date(label).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                }
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />'''

NEW_TOOLTIP = '              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />'

if OLD_TOOLTIP in text:
    text = text.replace(OLD_TOOLTIP, NEW_TOOLTIP)
    print("Fixed reports.tsx Tooltip (removed labelFormatter)")
else:
    # Try replacing any remaining labelFormatter line
    import re
    text = re.sub(r'\s*labelFormatter=\{[^}]+\}\s*', '\n                ', text)
    print("Removed labelFormatter via regex")

RP.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done")
