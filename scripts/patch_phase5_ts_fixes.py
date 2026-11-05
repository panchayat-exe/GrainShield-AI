from pathlib import Path

# Fix AdminShell.tsx: wrong supabase import + type issues
AS_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = AS_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Fix import path
text = text.replace(
    'import { supabase } from "@/lib/supabase/client";',
    'import { supabase } from "@/lib/supabase";'
)

# Fix type issues in Realtime section - add proper types
OLD_FETCH = '''    supabase
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
        }));'''

NEW_FETCH = '''    supabase
      .from("manual_review_requests")
      .select("id, trip:trips(trip_code), created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        const rows = ((data as Array<{ id: string; trip: { trip_code: string } | null; created_at: string }>) ?? []).map((r) => ({
          id: r.id,
          trip_code: r.trip?.trip_code ?? "Unknown",
          created_at: r.created_at,
        }));'''

text = text.replace(OLD_FETCH, NEW_FETCH)

# Fix Realtime payload type
OLD_PAYLOAD = '''        (payload) => {
          const record = payload.new as { id: string; trip_id: string; created_at: string };'''
NEW_PAYLOAD = '''        (payload: { new: Record<string, unknown> }) => {
          const record = payload.new as { id: string; trip_id: string; created_at: string };'''
text = text.replace(OLD_PAYLOAD, NEW_PAYLOAD)

# Fix trip lookup type
OLD_TRIP = '''.then(({ data: t }) => {
              const entry = {
                id: record.id,
                trip_code: (t as { trip_code: string } | null)?.trip_code ?? record.trip_id.slice(0, 8),'''
NEW_TRIP = '''.then(({ data: t }) => {
              const trip = t as { trip_code: string } | null;
              const entry = {
                id: record.id,
                trip_code: trip?.trip_code ?? record.trip_id.slice(0, 8),'''
text = text.replace(OLD_TRIP, NEW_TRIP)

AS_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed AdminShell.tsx")

# Fix profile.tsx: wrong supabase import + type issues
PR_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/profile.tsx")
text = PR_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")
text = text.replace(
    'import { supabase } from "@/lib/supabase/client";',
    'import { supabase } from "@/lib/supabase";'
)
# Fix type for profile data destructure
text = text.replace(
    ".then(({ data: p }) => {\n          if (p) {\n            setPhone((p as { phone: string | null }).phone ?? \"\");\n            setDistrict((p as { district: string | null }).district ?? \"\");",
    '.then(({ data: p }) => {\n          if (p) {\n            const pData = p as { phone: string | null; district: string | null };\n            setPhone(pData.phone ?? "");\n            setDistrict(pData.district ?? "");'
)
# Fix auth data destructure type
text = text.replace(
    ".then(({ data }) => {\n      if (!data.user) return;",
    '.then(({ data: authRes }) => {\n      if (!authRes.user) return;\n      const userId = authRes.user.id;'
)
text = text.replace(
    'supabase\n        .from("profiles")\n        .select("phone,district")\n        .eq("id", data.user.id)',
    'supabase\n        .from("profiles")\n        .select("phone,district")\n        .eq("id", userId)'
)
PR_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed admin profile.tsx")

# Fix reports.tsx: Tooltip labelFormatter type
RP_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = RP_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")
text = text.replace(
    'labelFormatter={(label: string) => new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}',
    'labelFormatter={(label) => typeof label === "string" ? new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : String(label)}'
)
RP_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Fixed reports.tsx Tooltip type")
