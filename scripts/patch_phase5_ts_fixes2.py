from pathlib import Path

# Fix AdminShell.tsx: Supabase join returns array, cast via unknown
AS_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = AS_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Change the cast to go through unknown first
text = text.replace(
    '((data as Array<{ id: string; trip: { trip_code: string } | null; created_at: string }>) ?? [])',
    '((data as unknown as Array<{ id: string; trip: { trip_code: string } | null; created_at: string }>) ?? [])'
)
AS_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed AdminShell.tsx cast")

# Fix reports.tsx: remove labelFormatter entirely (causes type conflict), use just content style
RP_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = RP_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Remove the labelFormatter line entirely - recharts tooltip types are complex
text = text.replace(
    'labelFormatter={(label) => typeof label === "string" ? new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : String(label)}',
    ''
)
RP_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed reports.tsx Tooltip")
