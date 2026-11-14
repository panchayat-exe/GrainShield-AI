from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/audit-logs.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Add date filter inputs between the Select and SearchBox sections
OLD_SEARCH = '''      <div className="mb-5">
        <SearchBox
          placeholder="Search by Trip ID, Actor ID, action, or metadata…"
          value={search}
          onChange={handleSearch}
        />
      </div>'''

NEW_SEARCH = '''      {/* Date range filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Clear Dates
          </button>
        )}
      </div>

      <div className="mb-5">
        <SearchBox
          placeholder="Search by Trip ID, Actor ID, action, or metadata…"
          value={search}
          onChange={handleSearch}
        />
      </div>'''

if "Date From" not in text:
    if OLD_SEARCH in text:
        text = text.replace(OLD_SEARCH, NEW_SEARCH)
        print("✓ Added date filter UI")
    else:
        print("⚠ SearchBox pattern not found exactly")
else:
    print("✓ Date filter already in UI")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
