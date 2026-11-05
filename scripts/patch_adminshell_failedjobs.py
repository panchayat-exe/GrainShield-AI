from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/components/admin/AdminShell.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

old = '  { to: "/profile", label: "My Profile" },\n] as const;'
new = '  { to: "/failed-jobs", label: "Failed Jobs" },\n  { to: "/profile", label: "My Profile" },\n] as const;'

if '/failed-jobs' not in text:
    text = text.replace(old, new)
    print("Added Failed Jobs nav link")
else:
    print("Already present")

FILE.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
print("Done")
