from pathlib import Path
FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/trips.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

old = "onClick={() => setShowCreateModal(true)}"
new = "onClick={() => { setShowCreateModal(true); getDriverProfiles(\"\").then(({ profiles }) => setDriverProfiles(profiles ?? [])); }}"

if old in text:
    text = text.replace(old, new, 1)
    print("Fixed modal open onClick")
else:
    print("Already fixed or pattern not found")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
