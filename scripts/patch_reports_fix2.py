from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/reports.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Remove the bad injection and fix the structure
BAD_BLOCK = '''      {districts.length > 0 && (
              {/* Daily Trend Chart */}
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
      </div>
<DataTable'''

GOOD_BLOCK = '''      {/* Daily Trend Chart */}
      <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Daily Trip Trend (Last 30 Days)</h3>
        {trendLoading && <p className="py-4 text-center text-xs text-muted-foreground">Loading trend data…</p>}
        {!trendLoading && trendData.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No trip data in the last 30 days.</p>}
        {!trendLoading && trendData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip labelFormatter={(label: string) => new Date(label).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="total" name="Total Trips" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="pass" name="Passed" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="review" name="In Review" fill="#9333ea" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {districts.length > 0 && (
        <DataTable'''

if BAD_BLOCK in text:
    text = text.replace(BAD_BLOCK, GOOD_BLOCK)
    print("✓ Fixed trend chart insertion")
else:
    print("Pattern not exactly matched - trying line-by-line approach")
    # Remove the broken block manually
    lines = text.split("\n")
    new_lines = []
    skip_until_datatable = False
    chart_inserted = False

    for i, line in enumerate(lines):
        if "{districts.length > 0 && (" in line and i > 200 and not chart_inserted:
            # Insert the proper chart before this, then fix the conditional
            if not chart_inserted:
                new_lines.append("      {/* Daily Trend Chart */}")
                new_lines.append('      <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">')
                new_lines.append('        <h3 className="mb-3 text-sm font-semibold text-foreground">Daily Trip Trend (Last 30 Days)</h3>')
                new_lines.append("        {!trendLoading && trendData.length > 0 && (")
                new_lines.append('          <ResponsiveContainer width="100%" height={260}>')
                new_lines.append('            <BarChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>')
                new_lines.append('              <CartesianGrid strokeDasharray="3 3" />')
                new_lines.append('              <XAxis dataKey="date" tick={{ fontSize: 10 }} />')
                new_lines.append('              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />')
                new_lines.append('              <Tooltip />')
                new_lines.append('              <Legend />')
                new_lines.append('              <Bar dataKey="total" name="Total Trips" fill="hsl(var(--primary))" />')
                new_lines.append('              <Bar dataKey="pass" name="Passed" fill="#16a34a" />')
                new_lines.append('              <Bar dataKey="review" name="In Review" fill="#9333ea" />')
                new_lines.append('            </BarChart>')
                new_lines.append('          </ResponsiveContainer>')
                new_lines.append("        )}")
                new_lines.append("      </div>")
                new_lines.append("")
                chart_inserted = True
            # Now check if this line starts the broken block
            if "              {/* Daily Trend Chart */" in "".join(lines[i:i+5]):
                skip_until_datatable = True
        
        if skip_until_datatable and "<DataTable" in line:
            skip_until_datatable = False
            # Fix the opening - add proper wrapping
            new_lines.append("      {districts.length > 0 && (")
            new_lines.append("        " + line.strip())
            continue

        if not skip_until_datatable:
            new_lines.append(line)

    text = "\n".join(new_lines)
    print("Applied line-by-line fix")

FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done")
