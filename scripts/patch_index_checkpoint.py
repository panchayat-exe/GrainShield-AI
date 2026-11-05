from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/routes/index.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Add checkpoint guidance card after the stage select card
# Find the closing of the stage card
STAGE_CARD_END = '''            {fieldErrors.stage && <p className="mt-1 text-xs text-danger">{fieldErrors.stage}</p>}
          </label>
        </div>
      </Card>

      <Card title="Upload Photograph">'''

STAGE_CARD_WITH_GUIDE = '''            {fieldErrors.stage && <p className="mt-1 text-xs text-danger">{fieldErrors.stage}</p>}
          </label>
        </div>
      </Card>

      {/* Checkpoint guidance — shown when stage is selected */}
      {stage && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          {stage === "first_mile" ? (
            <div className="space-y-1">
              <p className="font-semibold text-primary">First Mile — 2 Checkpoints</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP1 — Departure:</span> Photograph
                the vehicle at the FCI Mandi / warehouse before it departs.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP2 — Arrival:</span> Photograph the
                vehicle at the godown / storage depot upon arrival.
              </p>
            </div>
          ) : stage === "last_mile" ? (
            <div className="space-y-1">
              <p className="font-semibold text-primary">Last Mile — 2 Checkpoints</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP3 — Departure:</span> Photograph
                the vehicle at the godown before it leaves for the Fair Price Shop.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">CP4 — Delivery:</span> Photograph the
                vehicle at the Fair Price Shop upon final delivery.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <Card title="Upload Photograph">'''

if "Checkpoint guidance" not in text:
    if STAGE_CARD_END in text:
        text = text.replace(STAGE_CARD_END, STAGE_CARD_WITH_GUIDE)
        print("✓ Added checkpoint guidance card")
    else:
        print("⚠ STAGE_CARD_END not found exactly - trying simpler approach")
        # Simpler: just find </Card>\n\n      <Card title="Upload Photograph">
        old = '</Card>\n\n      <Card title="Upload Photograph">'
        new = '</Card>\n\n      {stage && (\n        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">\n          <p className="font-semibold text-primary">{stage === "first_mile" ? "First Mile — CP1 (Departure) & CP2 (Arrival)" : "Last Mile — CP3 (Departure) & CP4 (Delivery)"}</p>\n          <p className="mt-1 text-xs text-muted-foreground">Submit one photograph per checkpoint. AI will verify the vehicle number plate automatically.</p>\n        </div>\n      )}\n\n      <Card title="Upload Photograph">'
        text = text.replace(old, new, 1)
        print("✓ Added checkpoint guidance (simple approach)")
else:
    print("Already has checkpoint guidance")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
