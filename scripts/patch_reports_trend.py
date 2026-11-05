from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# 1. Add getDailyTrend import
OLD_IMPORT = 'import { getReportStats, logReportExport } from "@/lib/admin-queries";'
NEW_IMPORT = 'import { getReportStats, logReportExport, getDailyTrend } from "@/lib/admin-queries";'

if "getDailyTrend" not in text:
    text = text.replace(OLD_IMPORT, NEW_IMPORT)
    print("✓ Added getDailyTrend import")

# 2. Add recharts imports at top (after existing imports)
RECHARTS_IMPORT = '''import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";'''

if "recharts" not in text:
    # Insert before first import or at top
    first_import_pos = text.find('import {')
    if first_import_pos == -1:
        first_import_pos = text.find('import ')
    text = text[:first_import_pos] + RECHARTS_IMPORT + "\n" + text[first_import_pos:]
    print("✓ Added recharts imports")

# 3. Add trendData state inside Reports function
# Find the function component
OLD_FILTER_STATE = 'const [filterPeriod, setFilterPeriod] = useState("All Time");'
NEW_FILTER_STATE = '''const [filterPeriod, setFilterPeriod] = useState("All Time");
  const [trendData, setTrendData] = useState<{ date: string; total: number; pass: number; review: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);

  // Load daily trend on mount
  useEffect(() => {
    setTrendLoading(true);
    getDailyTrend(30).then((data) => {
      setTrendData(data);
      setTrendLoading(false);
    });
  }, []);'''

if "trendData" not in text:
    if OLD_FILTER_STATE in text:
        text = text.replace(OLD_FILTER_STATE, NEW_FILTER_STATE)
        print("✓ Added trendData state")
    else:
        # Try simpler — just find useState("All Time") pattern
        text = text.replace(
            'useState("All Time")',
            'useState("All Time");\n  const [trendData, setTrendData] = useState<{ date: string; total: number; pass: number; review: number }[]>([]);\n  const [trendLoading, setTrendLoading] = useState(true);\n  useEffect(() => {\n    getDailyTrend(30).then((d) => { setTrendData(d); setTrendLoading(false); });\n  }, []'
        )
        print("✓ Added trendData state (partial)")

# 4. Add the trend chart section before the district table
# Find the PageHeader JSX in return() - look for the district stats heading
OLD_DISTRICT_SECTION = '''      {/* District Compliance Table */}'''
NEW_TREND_AND_DISTRICT = '''      {/* Daily Trend Chart */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Daily Trip Trend (Last 30 Days)</h3>
          {trendLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
        </div>
        {!trendLoading && trendData.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">No trip data in the last 30 days.</p>
        )}
        {!trendLoading && trendData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
              />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(label: string) => new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="total" name="Total Trips" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="pass" name="Passed" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="review" name="Manual Review" fill="#9333ea" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* District Compliance Table */}'''

if "Daily Trend Chart" not in text:
    if OLD_DISTRICT_SECTION in text:
        text = text.replace(OLD_DISTRICT_SECTION, NEW_TREND_AND_DISTRICT)
        print("✓ Added daily trend chart section")
    else:
        # Try finding DataTable in reports
        idx = text.find("<DataTable")
        if idx != -1:
            # Insert before DataTable
            text = text[:idx] + '''      {/* Daily Trend Chart */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Daily Trip Trend (Last 30 Days)</h3>
        {!trendLoading && trendData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => { const d = new Date(v); return d.getDate() + "/" + (d.getMonth()+1); }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" name="Total" fill="hsl(var(--primary))" />
              <Bar dataKey="pass" name="Passed" fill="#16a34a" />
              <Bar dataKey="review" name="Review" fill="#9333ea" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>\n''' + text[idx:]
            print("✓ Added trend chart before DataTable")
        else:
            print("⚠ Could not find insertion point")
else:
    print("✓ Trend chart already added")

FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done reports.tsx")
