from pathlib import Path
FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/frontend/src/routes/my-trips.tsx")
text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Fix both AppShell usages to add crumbs prop
text = text.replace('<AppShell title="My Trips">', '<AppShell crumbs={["My Trips"]} title="My Trips">')
print(f"Replacements made; file len = {len(text)}")

final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("Done")
