from pathlib import Path
FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/components/AppShell.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

OLD_NAV = """nav = [
  { to: "/", label: "Upload Photo" },
  { to: "/processing", label: "Verification" },
  { to: "/result", label: "Result (Pass)" },
  { to: "/failed", label: "Result (Failed)" },
  { to: "/trip", label: "Trip Details" },
  { to: "/tracking", label: "Live Tracking" },
] as const;"""

NEW_NAV = """nav = [
  { to: "/", label: "Upload Photo" },
  { to: "/my-trips", label: "My Trips" },
  { to: "/processing", label: "Verification" },
  { to: "/result", label: "Result (Pass)" },
  { to: "/failed", label: "Result (Failed)" },
  { to: "/trip", label: "Trip Details" },
  { to: "/tracking", label: "Live Tracking" },
] as const;"""

if "/my-trips" not in text:
    if OLD_NAV in text:
        text = text.replace(OLD_NAV, NEW_NAV)
        print("Added My Trips nav link")
    else:
        print("Nav pattern not matched exactly, trying inline")
        text = text.replace(
            '{ to: "/", label: "Upload Photo" },',
            '{ to: "/", label: "Upload Photo" },\n  { to: "/my-trips", label: "My Trips" },'
        )
        print("Added via inline replace")
else:
    print("My Trips already in nav")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
