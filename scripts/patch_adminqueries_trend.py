from pathlib import Path

AQ_FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/lib/admin-queries.ts")
text = AQ_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Add getDailyTrend export before logReportExport
NEW_FN = '''
/** Returns trip counts per day for the last N days (default 30) for the trend chart. */
export async function getDailyTrend(days = 30): Promise<{ date: string; total: number; pass: number; review: number }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("trips")
    .select("created_at, status")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const dayMap: Record<string, { total: number; pass: number; review: number }> = {};
  for (const trip of data) {
    const day = new Date(trip.created_at).toLocaleDateString("en-CA"); // YYYY-MM-DD
    if (!dayMap[day]) dayMap[day] = { total: 0, pass: 0, review: 0 };
    dayMap[day].total++;
    if (trip.status === "pass" || trip.status === "completed") dayMap[day].pass++;
    else if (trip.status === "manual_review") dayMap[day].review++;
  }

  return Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}

'''

if "getDailyTrend" not in text:
    # Insert before logReportExport
    idx = text.find("/** Logs report export event")
    if idx != -1:
        text = text[:idx] + NEW_FN + text[idx:]
        print("✓ Added getDailyTrend to admin-queries.ts")
    else:
        # Append before the last export
        text = text.rstrip() + "\n" + NEW_FN
        print("✓ Appended getDailyTrend")
else:
    print("✓ getDailyTrend already present")

AQ_FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done admin-queries.ts")
