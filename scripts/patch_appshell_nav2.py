from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/components/AppShell.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

old = '  { to: "/my-trips", label: "My Trips" },'
new = '  { to: "/my-trips", label: "My Trips" },\n  { to: "/profile", label: "My Profile" },\n  { to: "/help", label: "Help & FAQ" },'

if '/profile' not in text:
    text = text.replace(old, new)
    print("Added Profile + Help links")
else:
    print("Already present")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
