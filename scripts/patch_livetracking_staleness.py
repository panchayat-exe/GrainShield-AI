from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/live-tracking.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Find the recordedAt display and add staleness warning after it
OLD_SIGNAL = '''        <span className="text-muted-foreground">{formatRelative(loc.recordedAt)}</span>
      </div>
      {loc.accuracyMeters != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          ±{Math.round(loc.accuracyMeters)} m accuracy
        </div>
      )}'''

NEW_SIGNAL = '''        <span className="text-muted-foreground">{formatRelative(loc.recordedAt)}</span>
      </div>
      {/* Staleness warning: signal older than 10 minutes */}
      {new Date().getTime() - new Date(loc.recordedAt).getTime() > 10 * 60 * 1000 && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600">
          <span>⚠</span>
          <span>
            Last signal{" "}
            {Math.round((new Date().getTime() - new Date(loc.recordedAt).getTime()) / 60000)}m
            ago — GPS may be offline
          </span>
        </div>
      )}
      {loc.accuracyMeters != null && (
        <div className="mt-1 text-xs text-muted-foreground">
          ±{Math.round(loc.accuracyMeters)} m accuracy
        </div>
      )}'''

if "GPS may be offline" not in text:
    if OLD_SIGNAL in text:
        text = text.replace(OLD_SIGNAL, NEW_SIGNAL)
        print("✓ Added GPS staleness warning")
    else:
        # simpler insert
        text = text.replace(
            '<span className="text-muted-foreground">{formatRelative(loc.recordedAt)}</span>',
            '<span className="text-muted-foreground">{formatRelative(loc.recordedAt)}</span>\n      {new Date().getTime() - new Date(loc.recordedAt).getTime() > 10 * 60 * 1000 && (<div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600"><span>⚠</span><span>Last signal {Math.round((new Date().getTime() - new Date(loc.recordedAt).getTime()) / 60000)}m ago — GPS may be offline</span></div>)}'
        )
        print("✓ Added GPS staleness warning (inline)")
else:
    print("Already patched")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
